# 09 — Modelo de Dados

> Divisão entre **estado durável** (PostgreSQL) e **estado quente/efêmero** (Redis).
> A fonte da verdade para dinheiro/inventário é o Postgres (com ledger); o Redis acelera
> leituras e coordena locks/broadcast.

## PostgreSQL (durável — primary + read replica)

### `players`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `player-...` |
| `room_id` | text FK → rooms | partição lógica |
| `display_name` | text | |
| `balance` | bigint | dinheiro disponível (≥ 0) |
| `reserved` | bigint | soma das reservas ativas em leilões |
| `created_at` | timestamptz | |

**Invariante:** `balance >= 0` e `reserved >= 0`. Saldo "gastável" = `balance - reserved`.

### `rooms`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `room-...` (id interno) |
| `code` | text UNIQUE | código curto de entrada (ex.: `4F2K9`); é por ele que os jogadores entram |
| `host_id` | text FK → players | jogador que criou a sala |
| `status` | text | `WAITING` (lobby) \| `RUNNING` \| `ENDED` |
| `started_at` / `ends_at` | timestamptz | partida com tempo fixo |
| `current_round` | int | rodada atual (modelo round-based; uma caixa por rodada) |
| `seed` | bigint | seed base do RNG (reprodutibilidade) |

**Invariante:** sai de `WAITING` para `RUNNING` apenas com **≥ 2 jogadores** na sala
(mín. para iniciar). `code` é único entre salas ativas.

### `inventory_items`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `itm-...` |
| `player_id` | text FK | |
| `type` | text | `COPPER` \| `SILVER` \| `GOLD` \| `DIAMOND` |
| `state` | text | `FREE` \| `LOCKED_COLLECTION` \| `CONSUMED` |
| `acquired_at` | timestamptz | |

**Invariante:** um item está em **exatamente um** `state`. Vender/queimar só se `FREE`.

### `affinities`
| Coluna | Tipo | Notas |
|---|---|---|
| `player_id` | text | PK composta com `type` |
| `type` | text | tipo de item |
| `points` | int | 0..teto (ex.: 15) |

### `collections`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `player_id` | text FK | |
| `kind` | text | `COMMON_ALLOY` \| `NOBLE_PAIR` \| `RAINBOW` \| `ROYAL_TRIO` \| `LEGENDARY_VAULT` |
| `bonus` | bigint | snapshot do bônus aplicado |
| `formed_at` | timestamptz | |

### `ledger` (auditoria — base da reconciliação)
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `player_id` | text | |
| `delta` | bigint | + crédito / − débito |
| `reason` | text | `BID_SETTLE` \| `RESERVE_RELEASE` \| `ITEM_SELL` \| `MIMIC_PENALTY` \| ... |
| `ref` | text | id da caixa/item relacionado |
| `ts` | timestamptz | |

**Invariante:** `balance` de um jogador = soma dos `delta` do seu ledger (a reconciliação
do worker valida isso).

### `boxes` (histórico/resultados; estado vivo fica no Redis)
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `box-...` |
| `room_id` | text FK | **partição**: a instância de Leilão dona da sala cuida das suas rodadas |
| `round_no` | int | número da rodada em que a caixa foi ofertada |
| `box_type` | text | `WOODEN` \| `IRON` \| `ROYAL` \| `VAULT` (sorteado; define as odds) |
| `winner_id` | text | preenchido ao arrematar (nulo se a rodada expirou sem lances) |
| `final_price` | bigint | |
| `opened_item` | text | resultado do sorteio |

## Redis (estado quente / coordenação)

### Estado vivo da caixa (hash) — `box:{boxId}`
```
current_bid      : 65
leader           : player-3
timer_expires_at : <epoch ms>   # fonte da verdade do cronômetro
box_type         : WOODEN
room_id          : room-1
round_no         : 7
version          : 7            # optimistic concurrency
```

### Locks distribuídos (Redlock)
- `lock:wallet:{playerId}` — serializa Reserve/Release/Settle/Sell/Burn do jogador.
- `lock:box:{boxId}` — serializa lances/abertura da caixa (alternativa ao mutex em processo
  quando a sala tem réplicas de Leilão).

### Cache de mercado — `market:{roomId}` (hash)
```
COPPER : 11
SILVER : 48
GOLD   : 176
DIAMOND: 2040
```
Leitura **eventual** (replicada); a verdade do recálculo vem do worker e é persistida.

### Pub/Sub (não é armazenamento, é canal)
- `room:{id}:events`, `market:updates` — ver [07 — Contratos de API](07-contratos-api.md).

## Particionamento (resumo)

| Dado | Chave de partição | Dono |
|---|---|---|
| Caixas / leilões / rodadas | `room_id` | instância de Leilão dona da sala |
| Jogador / carteira / inventário | `player_id` (shard) | instância de Carteira correspondente |
| Mercado | por `room_id` | worker |

## Replicação (resumo)

| Dado | Mecanismo | Leitura |
|---|---|---|
| `ledger`, `inventory_items`, `boxes`, `collections` | Postgres streaming replication | ranking/histórico na **réplica** |
| `box:*`, `market:*` | Redis | caches replicados |

## Consistência (resumo)

- **Forte:** `players.balance/reserved`, `inventory_items.state`, `ledger` — sob
  **Redlock + transação Postgres**. É onde mora a corretude do jogo.
- **Eventual:** `market:*`, ranking, inventário parcial dos adversários — caches/réplica,
  corrigidos pela reconciliação do worker.
