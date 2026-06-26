# 07 — Contratos de API

> **Defina/atualize estes contratos ANTES de implementar.** São a fronteira entre as
> linguagens (TS ↔ Java ↔ Python) e entre os paradigmas. Os exemplos abaixo são um ponto
> de partida; versione mudanças.

## 1. Cliente ↔ Gateway

### REST (ações pontuais — cliente-servidor síncrono)
| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/rooms` | Cria uma sala; o criador vira **host**. Retorna `roomId`, **`code`** e `playerId` + token |
| `POST` | `/api/rooms/join` | Entra **pelo código** (`{ code, displayName }`); retorna `roomId` + `playerId` + token |
| `POST` | `/api/rooms/{id}/start` | **Host** inicia a partida (exige ≥ **2** jogadores; `WAITING` → `RUNNING`) |
| `GET` | `/api/rooms/{id}/state` | Snapshot inicial do estado (depois vem por WS) |
| `GET` | `/api/rooms/{id}/leaderboard` | Ranking (lido da **réplica** Postgres) |

> O **`code`** é o identificador curto e digitável da sala (ex.: `4F2K9`), distinto do
> `roomId` interno (`room-...`). É por ele que os demais jogadores entram.

### WebSocket (tempo real)
Conexão: `wss://<gateway>/ws?room={id}&token=...`

**Cliente → Servidor** (ações; o gateway traduz para gRPC síncrono):
```jsonc
{ "type": "PLACE_BID", "boxId": "box-12", "amount": 65 }
{ "type": "OPEN_BOX", "boxId": "box-12" }
{ "type": "SELL_ITEM", "itemId": "itm-9" }
{ "type": "BURN_ITEM", "itemId": "itm-9", "affinity": "DIAMOND" }
{ "type": "BUY_INSURANCE", "boxId": "box-12" }
```

**Servidor → Cliente** (eventos difundidos via Pub/Sub):
```jsonc
{ "type": "ROOM_STATE", "status": "WAITING", "code": "4F2K9", "host": "player-1", "players": [ /* ... */ ] }
{ "type": "PLAYER_JOINED", "player": "player-2", "displayName": "bob", "count": 2 }
{ "type": "MATCH_STARTED", "endsAt": 1750000000000 }
// Início de rodada: UMA caixa, tipo sorteado, com as ODDS PÚBLICAS (= as aplicadas na abertura).
{ "type": "ROUND_STARTED", "round": 7, "box": { "boxId": "box-12", "boxType": "ROYAL",
  "odds": { "COPPER": 15, "SILVER": 30, "GOLD": 40, "DIAMOND": 12, "MIMIC": 3 }, "endsAt": 1750000000000 } }
{ "type": "BID_PLACED", "boxId": "box-12", "amount": 65, "leader": "player-3", "timerMs": 8000 }
{ "type": "BOX_SOLD", "boxId": "box-12", "winner": "player-3", "price": 65 }
{ "type": "BOX_OPENED", "boxId": "box-12", "player": "player-3", "item": "GOLD" }
// Fim de rodada (winner null quando ninguém deu lance); a próxima ROUND_STARTED vem após a pausa.
{ "type": "ROUND_ENDED", "round": 7, "boxId": "box-12", "winner": "player-3", "price": 65 }
{ "type": "MARKET_UPDATED", "prices": { "COPPER": 11, "GOLD": 176, "DIAMOND": 2040 } }
// WALLET_UPDATED é PRIVADO: enviado só ao próprio jogador (saldo + reservas + inventário).
{ "type": "WALLET_UPDATED", "balance": 870, "reserved": 65, "inventory": [ { "id": "itm-9", "type": "GOLD", "state": "FREE" } ] }
{ "type": "COLLECTION_FORMED", "player": "player-3", "collection": "ROYAL_TRIO", "bonus": 3000 }
{ "type": "MATCH_ENDED", "ranking": [ /* ... */ ] }
{ "type": "BID_REJECTED", "boxId": "box-12", "reason": "INSUFFICIENT_BALANCE" }
```

## 2. Gateway ↔ Serviços (gRPC — síncrono/bloqueante)

### `auction.proto`
```proto
syntax = "proto3";
package hammerprice.auction;

service Auction {
  rpc PlaceBid     (PlaceBidRequest) returns (PlaceBidReply);   // bloqueante
  rpc OpenBox      (OpenBoxRequest)  returns (OpenBoxReply);     // bloqueante (sorteio)
  rpc GetRoomState (RoomQuery)       returns (RoomState);        // rodada atual + caixa + odds
}

message PlaceBidRequest {
  string room_id = 1;
  string box_id  = 2;
  string player_id = 3;
  int64  amount  = 4;
}
message PlaceBidReply {
  bool   accepted = 1;
  string reason   = 2;   // INSUFFICIENT_BALANCE | OUTBID | OK
  int64  current_bid = 3;
  string leader   = 4;
  int64  timer_ms = 5;
}

message OpenBoxRequest { string room_id = 1; string box_id = 2; string player_id = 3; }
message OpenBoxReply   {
  bool   ok       = 1;
  string reason   = 2;   // OK | NOT_WINNER | UNKNOWN_BOX | ALREADY_OPENED
  string item     = 3;   // COPPER | SILVER | GOLD | DIAMOND | MIMIC
  bool   is_mimic = 4;   // penalidade do Mímico é aplicada numa etapa posterior (Fase 9)
}

// Estado da sala = rodada atual + a caixa em leilão, com as ODDS públicas.
message RoomQuery { string room_id = 1; }
message RoomState {
  int32  round   = 1;
  Box    box     = 2;     // a caixa da rodada (ausente na pausa entre rodadas)
  int64  ends_at = 3;     // epoch ms em que o cronômetro da caixa zera
}
message Box {
  string box_id      = 1;
  string box_type    = 2;            // WOODEN | IRON | ROYAL | VAULT
  int64  current_bid = 3;
  string leader      = 4;
  int64  timer_ms    = 5;
  map<string, int32> odds = 6;       // P pública por item (= a aplicada na abertura); soma 100
}
```

### `wallet.proto`
```proto
syntax = "proto3";
package hammerprice.wallet;

service Wallet {
  rpc Reserve  (ReserveRequest)  returns (ReserveReply);   // síncrono, sob Redlock+tx
  rpc Release  (ReleaseRequest)  returns (Ack);            // devolve reserva
  rpc Settle   (SettleRequest)   returns (Ack);            // debita de fato (arremate)
  rpc AddItem  (AddItemRequest)  returns (Ack);
  rpc SellItem (SellItemRequest) returns (SellReply);
  rpc BurnItem (BurnItemRequest) returns (BurnReply);
  rpc GetPlayer(PlayerQuery)     returns (PlayerState);
}

message ReserveRequest { string player_id = 1; string box_id = 2; int64 amount = 3; }
message ReserveReply   { bool ok = 1; int64 balance = 2; int64 reserved = 3; string reason = 4; }
// ... demais mensagens análogas
```

> **Invariante na Carteira:** `Reserve` só sucede se `balance - reserved >= amount`.
> Operação serializada por `Redlock(player_id)` + transação Postgres.

## 3. Eventos assíncronos (RabbitMQ — messaging)

**Exchange:** `hammerprice` (tipo `topic`). Eventos publicados pelo Leilão/Carteira e
consumidos pelo Worker.

| Routing key | Payload | Consumidor |
|---|---|---|
| `round.started` | `{ roomId, round, boxId, boxType, odds }` | Worker: métricas/manutenção da partida |
| `box.opened` | `{ roomId, boxId, player, item, isMimic }` | Worker: avaliação de coleções, efeito do mímico |
| `item.sold` | `{ roomId, player, item, price }` | Worker: atualiza oferta → recálculo de mercado |
| `item.burned` | `{ roomId, player, item, affinity }` | Worker: oferta + afinidade |
| `ledger.entry` | `{ player, delta, reason, ts }` | Worker: reconciliação |
| `match.tick` | `{ roomId, remainingMs }` | Worker: manutenção periódica |

**Saída do worker** (volta como Pub/Sub para os clientes): `MARKET_UPDATED`,
`COLLECTION_FORMED`, etc.

## 4. Canais Redis Pub/Sub (publish-subscribe — broadcast)

| Canal | Quem publica | Quem assina |
|---|---|---|
| `room:{id}:events` | Leilão, Carteira, Worker | Gateway (faz fan-out aos clientes WS) |
| `market:updates` | Worker | Gateway |

## 5. Convenções

- **IDs:** strings com prefixo (`player-`, `box-`, `itm-`, `room-`).
- **Dinheiro:** inteiros (centavos do jogo), nunca float.
- **Tempo:** o **servidor** é a fonte da verdade para timestamps de lance (desempate).
- **Idempotência:** `OpenBox`, `Settle` e efeitos do mímico devem ser idempotentes
  (chave de idempotência por `boxId`/operação) para sobreviver a *retries*.
- **Versionamento:** mudanças de contrato incrementam um campo `version`/comentário e são
  registradas neste arquivo.
