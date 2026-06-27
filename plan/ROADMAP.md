# 🗺️ Roadmap & Estado do Desenvolvimento — Hammer Price

> **Este é o arquivo-fonte do estado de desenvolvimento do projeto.**
> Sempre que quiser saber *o que já foi feito*, *o que está em andamento* e *o que
> falta*, comece por aqui. Agentes de IA e pessoas do time devem manter este arquivo
> sincronizado com a realidade do código.

- **Disciplina:** Software Concorrente e Distribuído (SCD) — UFG, 2026.1
- **Entrega:** 28/06/2026
- **Última atualização deste arquivo:** 2026-06-26
- **Marco atual:** **Reta final (entrega 28/06)** — **os 9 requisitos estão cobertos**
  (R1–R6, R8, R9 🟢; **R7 🟡**: invariante de saldo + isolamento de partição demonstrados,
  consistência forte/Postgres pendente). Núcleo distribuído completo: AWS, rodadas+odds,
  async/messaging, **partição por sala + replicação Redis**, e o **ciclo de jogo completo**:
  inventário (vender/queimar/guardar) + coleções + **ciclo de partida** (lobby por código →
  partida com tempo → patrimônio + ranking). A seguir: **demo gravada (Fase 10)** + polish
  da UI. Stretch: Postgres streaming (R6 durável), desempates de ranking, REST formal.

---

## 📌 Como usar este arquivo (protocolo obrigatório)

1. **Fonte única da verdade.** Este arquivo descreve o estado real do desenvolvimento.
   Antes de implementar qualquer coisa, leia a **fase relevante** aqui **e** o documento
   correspondente em [`../docs/`](../docs/).
2. **Atualize na mesma mudança.** Ao mexer no código de uma tarefa, atualize o checkbox
   dela **no mesmo commit/PR** — nunca deixe o roadmap defasado.
3. **Marcação de status** (ver legenda abaixo): ao **começar**, marque `[~]`; ao
   **concluir**, marque `[x]` e registre uma linha no [Registro de progresso](#-registro-de-progresso)
   ao final (data + commit/PR + resumo).
4. **Definition of Done.** Uma tarefa só vira `[x]` se cumprir a DoD do
   [doc 06](../docs/06-planejamento.md#definição-de-pronto-definition-of-done):
   contrato (proto/evento/REST) atualizado em [doc 07](../docs/07-contratos-api.md),
   serviço dono implementado e exposto, eventos emitidos onde aplicável, **teste de
   concorrência** quando há recurso compartilhado, sobe via `docker compose up` sem
   passos manuais, e documentação afetada atualizada.
5. **Não quebrar requisitos obrigatórios.** Veja a [Matriz de requisitos](#-matriz-de-requisitos-obrigatórios).
   Se uma mudança conveniente violar qualquer requisito, **pare e sinalize** (regra do
   [`../CLAUDE.md`](../CLAUDE.md)) em vez de prosseguir. Mantenha a matriz atualizada
   conforme as fases avançam.
6. **Bloqueios.** Se uma tarefa travar (dependência, decisão pendente), marque `[!]` e
   escreva o motivo na própria linha.
7. **Tarefas novas.** Surgiu trabalho não previsto? Adicione-o à fase apropriada (ou ao
   [Backlog / Extras](#fase-9--extras-opcionais)). Não pule fases nem invente uma nova
   fora de ordem sem sinalizar no registro.

### Legenda de status

| Marca | Significado |
|---|---|
| `[ ]` | A fazer |
| `[~]` | Em andamento |
| `[x]` | Concluída (DoD cumprida) |
| `[!]` | Bloqueada / precisa de decisão |
| `[-]` | Adiada / fora do escopo atual (opcional) |

Cada tarefa traça os requisitos da disciplina que ajuda a satisfazer com a etiqueta
`(R1…R9)` — ver [Matriz de requisitos](#-matriz-de-requisitos-obrigatórios).

---

## 🎯 Estratégia de escopo

Conforme [doc 06](../docs/06-planejamento.md): primeiro um **núcleo demonstrável** que já
satisfaz **todos** os requisitos obrigatórios (Fases 0–8); só depois as **mecânicas ricas**
(mercado, mímico, seguro) como extras (Fase 9). O núcleo **congela cedo**; extras só
entram se não quebrarem o núcleo.

**Ordem-mestra:** contratos → núcleo consistente → distribuição/AWS → extras → demo.

---

## ✅ Matriz de requisitos obrigatórios

Os 9 requisitos da disciplina (ver [doc 05](../docs/05-requisitos-distribuidos.md)) e onde
cada um é satisfeito. Atualize a coluna **Status** conforme as fases avançam.

| # | Requisito | Status | Onde (atual → planejado) |
|---|---|---|---|
| R1 | Acessível a múltiplos clientes na Internet | 🟢 ok | Deploy em **AWS EC2** (smoke test 25/06) + **lobby multijogador** (criar/entrar por código, ≥2 por sala); demo multi-cliente remoto = Fase 10 |
| R2 | Vários componentes distribuídos coordenados | 🟢 ok | frontend, gateway, auction (×2), wallet (×2 shards), worker — coordenados; + Redis/RabbitMQ/Postgres de apoio |
| R3 | Acessos concorrentes a recursos compartilhados | 🟢 ok | Sala inteira disputa a caixa (lock por caixa, teste 8×200) + reservas concorrentes nos shards de Carteira; → Redlock+SQL durável (Fase 3) |
| R4 | Processamento servidor concorrente com clientes | 🟢 ok | Lances/RNG/rodadas + **worker de mercado** (Python) recalculando durante a partida |
| R5 | Interação síncrona **e** assíncrona | 🟢 ok | gRPC síncrono (lance/abertura) + **Redis Pub/Sub** + **RabbitMQ** assíncronos |
| R6 | Replicação **e** particionamento | 🟢 ok | **Partição ✓** (2 instâncias de Leilão por sala + 2 wallet shards) + **Replicação ✓** (Redis primary→réplica; gateway lê o mercado da réplica). Postgres streaming = stretch opcional |
| R7 | Consistência **e** disponibilidade | 🟡 parcial | Consistência ✓: saldo nunca negativo, item em estado único, item travado não vende (em memória). Disponibilidade ✓: isolamento de partição + fail-fast (deadline gRPC). Stretch: consistência durável (Postgres+Redlock) + failover |
| R8 | >1 linguagem **e** >1 paradigma | 🟢 ok | TS+Java+**Python**; cliente-servidor (REST/gRPC) + **pub-sub** (Redis) + **messaging** (RabbitMQ) |
| R9 | Demonstração em AWS EC2 | 🟢 ok | Stack roda numa EC2 (smoke test verde 25/06); pendente: **demo gravada** (Fase 10). Topologia 2–3 máquinas = polish opcional (R6 já demonstrado localmente) |

Legenda: 🟢 satisfeito · 🟡 parcial · 🔴 ainda não.

---

## 📍 Fase 0 — Fundação / Fatia vertical · **CONCLUÍDA**

> Caminho ponta a ponta de um lance: `frontend → gateway → auction → wallet`, tudo em
> memória. Sem Postgres/Redis/RabbitMQ. Ver [`../RUNNING.md`](../RUNNING.md).

- [x] Estrutura de repositório, docs (`docs/01`–`09`) e `CLAUDE.md` *(R2)*
- [x] Contratos gRPC iniciais: [`proto/auction.proto`](../proto/auction.proto), [`proto/wallet.proto`](../proto/wallet.proto) *(R2,R5)*
- [x] **Auction (Java):** lance atômico por caixa com `ReentrantLock`, em memória — [`BoxStore.java`](../services/auction/src/main/java/br/ufg/hammerprice/auction/BoxStore.java) *(R3,R4)*
- [x] **Wallet (Java):** reserva/release `synchronized`, garante saldo gastável ≥ 0 — [`WalletStore.java`](../services/wallet/src/main/java/br/ufg/hammerprice/wallet/WalletStore.java) *(R3,R7)*
- [x] Auction é **cliente gRPC síncrono** da Wallet (reserva antes de aceitar) *(R5)*
- [x] **Gateway (Node):** mantém WS, traduz `PLACE_BID` em gRPC síncrono, broadcast em processo — [`gateway/src/index.ts`](../services/gateway/src/index.ts) *(R1,R5,R8)*
- [x] **Frontend (React):** mesa de leilão, conexão WS, dar lance — [`frontend/src/App.tsx`](../services/frontend/src/App.tsx) *(R1)*
- [x] Teste da fatia: lance válido, outbid+devolução, saldo insuficiente, reservas somando o orçamento — [`gateway/test-slice.mjs`](../services/gateway/test-slice.mjs) *(R3)*

---

## 📍 Fase 1 — Infraestrutura local (data stores + compose) · **CONCLUÍDA**

> Objetivo: `cd infra && docker compose --profile local up --build` sobe **todos** os
> serviços e dependências, sem passos manuais. Ver [`../RUNNING.md`](../RUNNING.md).

- [x] `docker-compose.yml` com Postgres, Redis e RabbitMQ — profiles `local`/`node-a`/`node-b` — [infra/docker-compose.yml](../infra/docker-compose.yml) *(R2,R6,R7)*
- [x] Dockerfile para cada serviço (frontend, gateway, auction, wallet, worker); contexto = raiz do repo (para os `proto/`), com [`.dockerignore`](../.dockerignore) *(R2)*
- [x] Carregamento de [`infra/config/balance.yaml`](../infra/config/balance.yaml) em runtime via `BalanceConfig` (Java) e `yaml` (Python) — timers, incrementos, orçamento
- [x] Wiring de `.env` a partir de [`../.env.example`](../.env.example) (compose com defaults; nenhum segredo no repo)
- [x] Healthchecks (redis/rabbitmq/postgres) e ordem de subida via `depends_on: condition`
- [x] Migrações iniciais do schema Postgres em [`infra/db/init`](../infra/db/init/) (ver [doc 09](../docs/09-modelo-de-dados.md))

## 📍 Fase 2 — Núcleo do Leilão completo (Java · auction) · **EM ANDAMENTO**

> Transforma o cronômetro informativo da fatia em leilão de verdade, com fechamento,
> sorteio e particionamento. Ver [doc 03](../docs/03-regras-de-negocio.md) e [doc 04](../docs/04-arquitetura.md).
>
> **Increments 1 (ciclo de vida), 2 (abertura/RNG) e 3 (modelo de rodadas + odds públicas)
> concluídos.** Increment 4 (**particionamento por sala**) também concluído: 2 instâncias
> de Leilão, gateway roteando por sala, isolamento verificado. A publicação de eventos é via
> Redis Pub/Sub + RabbitMQ (Fases 4/5). Falta só a **replicação** (R6, Fase 7) para fechar R6.

- [x] Timer por caixa com **fechamento automático** ao zerar (`ScheduledExecutorService` + guarda contra disparo obsoleto) *(R4)*
- [x] **Anti-sniping:** lance nos últimos 5 s estende o cronômetro (volta a 8 s) *(R4)*
- [x] Fechamento da caixa: **debita** o vencedor (`Settle`) e **devolve** aos perdedores (release no outbid) *(R3,R7)*
- [x] Desempate do vencedor por **timestamp do servidor**: lock por caixa serializa; último lance válido vence *(R3)*
- [x] ~~**Reposição** de oferta: nova caixa entra no mesmo slot ao arrematar~~ — substituída pelo **ciclo de rodadas** (increment 3)
- [x] Tipos de caixa + **odds do `balance.yaml`** dirigem o sorteio (`BoxOpener`)
- [x] **RNG de abertura** server-side com **seed injetável** (`RNG_SEED`); `OpenBox` RPC + fluxo do vencedor *(R4)*
- [x] Afinidade somada às odds + **renormalização** (Σ P = 1, P ≥ 0) — mecanismo + teste; valores virão do *burn* (Fase 3)
- [x] **Modelo de rodadas (increment 3):** uma caixa por rodada, **tipo sorteado** (pesos `balance.yaml`, seed reproduzível); ciclo rodada → arremate/expiração → pausa → próxima rodada *(R4)*
- [x] **Odds públicas:** probabilidades no estado da caixa (`Box.odds` no proto/`GetRoomState`) e **exibidas no frontend** (uma caixa por rodada + contador)
- [x] Eventos `ROUND_STARTED`/`ROUND_ENDED`/`BOX_SOLD` (agora via **Redis Pub/Sub** publicado pelo Leilão — Fase 4)
- [x] **Particionamento por sala (room) (increment 4):** 2 instâncias de Leilão (vault1=room-1, vault2=room-2) + 2 wallet shards; gateway roteia ações/eventos por sala. Verificado: salas isoladas + **queda de uma instância só afeta a sua sala** *(R6,R7)*
- [x] Publicação de eventos via **Redis Pub/Sub** (broadcast) + **RabbitMQ** (durável) — Fases 4/5 *(R5)*
- [x] **Teste de concorrência:** corrida de lances na mesma caixa (`BoxStoreTest`, 8×200 lances) *(R3)*

## 📍 Fase 3 — Carteira/Inventário com consistência forte (Java · wallet)

> Guardião do dinheiro: migra do estado em memória para Postgres + lock distribuído.
> Ver invariantes em [doc 03 §9](../docs/03-regras-de-negocio.md) e [doc 09](../docs/09-modelo-de-dados.md).

- [~] **Inventário (em memória) + HUD do jogador:** o item sorteado é creditado ao vencedor (`AddItem`); `GetPlayer` retorna o inventário; gateway emite `WALLET_UPDATED` privado (saldo+reservas+inventário) e o frontend mostra o HUD. Verificado: lance reserva → arremate debita → abertura credita o item. _MIMIC não vira item (penalidade futura)._
- [ ] Persistência em **Postgres** (saldo, reservas, inventário) com **transações SQL** *(R7)*
- [ ] **Ledger append-only:** toda alteração de dinheiro registrada (base da reconciliação) *(R7)*
- [ ] **Redlock** (lock distribuído via Redis) para reserva atômica entre instâncias *(R3,R7)*
- [ ] **Particionamento por `playerId`** (shard) *(R6)*
- [ ] Invariante de inventário: item em **exatamente um** estado (livre / reservado-coleção / consumido)
- [x] Operações de inventário: **vender** (preço de mercado), **queimar** (+afinidade, alimenta o RNG) e **guardar** (formar coleção trava os itens — ver Fase 6)
- [ ] **Teste de concorrência:** lances simultâneos em vaults diferentes nunca deixam saldo negativo *(R3,R7)*

## 📍 Fase 4 — Tempo real distribuído (gateway + Redis Pub/Sub + REST) · **EM ANDAMENTO**

> Substitui o broadcast em processo por fan-out distribuído e formaliza o REST.

- [x] **Redis Pub/Sub** para fan-out de eventos (substitui o polling em processo) *(R5)*
- [x] Gateway **stateless**: assina o canal Redis e difunde; sem estado de jogo (replicável) *(R1,R6,R7)*
- [~] Ações de sala (criar/retorna `code`, entrar por código, iniciar) — feitas via **WebSocket** (`CREATE_ROOM`/`JOIN_ROOM`/`START_MATCH`) no gateway; REST formal fica opcional *(R1,R5)*
- [x] Auction publica em Redis (`room:{id}:events`); gateway assina e empurra aos clientes *(R5)*
- [x] Reconexão de cliente recebe **snapshot** atualizado (WELCOME via `GetRoomState`)

## 📍 Fase 5 — Mensageria + Worker de background (Python) · **EM ANDAMENTO**

> Acrescenta a 3ª linguagem, o paradigma **messaging** e o processamento concorrente
> de fundo. Ver [doc 04](../docs/04-arquitetura.md).

- [x] **RabbitMQ:** exchange `hammerprice` (topic) + fila `worker.events` (paradigma messaging) *(R5,R8)*
- [x] Auction publica eventos **duráveis** no RabbitMQ (`box.opened`, `round.started`) *(R5)*
- [x] **Worker (Python)** consome as filas e processa eventos *(R4,R8)*
- [x] **Engine de mercado:** recalcula preços por escassez relativa em `box.opened` → `MARKET_UPDATED` *(R4)*
- [~] **Coleções:** formação **player-initiated** na Carteira (`FormCollection` trava os itens + registra o bônus); a contagem do bônus no **patrimônio final** vem na Fase 6
- [ ] **Reconciliação:** confere ledger × saldos e corrige divergências (consistência eventual) *(R7)*
- [ ] Manutenção das regras: expiração de caixas, reposição, efeitos do Mímico

## 📍 Fase 6 — Ciclo de partida + Patrimônio + Ranking

> Fecha o loop de jogo: sala com tempo fixo, coleções e cálculo de vencedor.
> Ver [doc 02](../docs/02-regras-do-jogo.md) e [doc 03](../docs/03-regras-de-negocio.md).

- [x] **Criar sala:** o jogador cria a partida, vira *host* e recebe um **código** curto (slot livre = instância de Leilão livre) — via WS no gateway
- [x] **Entrar por código:** os demais entram digitando o código (lobby de espera)
- [x] **Lobby:** todos veem quem entrou (`ROOM_STATE`); exige **mínimo 2 jogadores** para iniciar
- [x] **Iniciar partida:** o host dá a largada (`WAITING` → `RUNNING`, ≥ 2 jogadores); cronômetro de tempo fixo (`MATCH_DURATION_SECONDS`); o host pode encerrar antes
- [x] **Coleções** (Liga Comum → Cofre Lendário): **formar trava os itens** (`LOCKED_COLLECTION`) e registra o **bônus**, que entra no **patrimônio final** ✓
- [x] **Patrimônio final:** ao encerrar, patrimônio = dinheiro + itens LIVRES a preço de mercado + bônus de coleções (doc 03 §8)
- [x] **Ranking** por patrimônio (maior vence) difundido em `MATCH_ENDED`; desempates finos (coleções → itens) ficam como polish
- [x] **Frontend:** menu (criar/entrar por código) → lobby → partida (HUD, inventário, mercado, coleções, cronômetro) → tela de ranking

## 📍 Fase 7 — Replicação, disponibilidade e failover

> Demonstra explicitamente os mecanismos de tolerância a falha (R6/R7).

- [x] **Redis replicado** (primary→réplica): worker escreve `market:prices` no primário, gateway lê o snapshot da **réplica** no WELCOME (read/write split). Verificado: `master_link_status:up` + propagação primário→réplica *(R6)*
- [x] Cenário de falha: queda de uma instância de **Leilão** isola só aquela sala (room-1 segue quando vault2 cai) *(R7)*
- [ ] **Postgres primary + read replica** (streaming) — leituras de ranking/histórico na réplica — *stretch opcional (variante durável mais forte)* *(R6)*
- [ ] **Failover** demonstrável (estado autoritativo sobrevive em Redis/Postgres) *(R7)*

## 📍 Fase 8 — Deploy AWS EC2

> A demonstração avaliada **roda na nuvem**. Ver [doc 08](../docs/08-deploy-aws.md).

- [~] Provisionamento das instâncias **EC2** (2–3) *(R9)* — 1 instância no ar (smoke test verde via console + EC2 Instance Connect); faltam as 2–3 p/ particionamento entre máquinas (R6)
- [x] Deploy dos serviços via Docker/Compose nas instâncias *(R9)* — `infra/deploy/start.sh` subiu o stack completo numa EC2 (AL2023, t3.medium) e o jogo roda
- [~] **Acessível na Internet** a múltiplos clientes (frontend + API públicos) *(R1,R9)* — endpoints públicos (`:5173`/`:8080`) no ar; falta validar com 2+ jogadores remotos simultâneos
- [x] Scripts de deploy versionados em [`infra/`](../infra/) *(R9)* — `infra/deploy/` (`provision.sh`, `user-data.sh`, `start.sh`, `DEPLOY.md`); inclui install do buildx no bootstrap
- [x] "Hello world" em EC2 **cedo** (mitigação de risco do doc 06) *(R9)* — smoke test verde em 2026-06-25 (maior risco do projeto retirado)

## 📍 Fase 9 — Extras (opcionais)

> Só entram se não quebrarem o núcleo. Ligam mecânicas ricas de jogo.

- [-] **Seguro** antes de abrir caixa de alto risco (mitiga penalidade do Mímico)
- [-] **Mímico** completo: as 3 penalidades (roubar dinheiro / item / anular coleção)
- [-] **Inventário parcial** visível dos adversários (leitura de pôquer)
- [-] **Histórico de lances** público
- [-] **Dashboard de administração** com métricas em tempo real
- [-] Mercado dinâmico refinado (curvas, suavização)

## 📍 Fase 10 — Qualidade, dados de teste e demo

> Fecha a entrega (28/06). Ver [doc 06](../docs/06-planejamento.md) e [doc 05](../docs/05-requisitos-distribuidos.md).

- [ ] **Seeds de RNG fixas** para aberturas reproduzíveis
- [ ] **Scripts de carga** em `infra/loadtest/`: N jogadores dando lances concorrentes
- [ ] **Cenários roteirizados:** corrida de lances, saldo compartilhado estourando, queda de vault
- [ ] **Roteiro + gravação do vídeo** de demonstração (participação de todos)
- [ ] Revisão final da documentação (`docs/` e este roadmap coerentes com o código)

---

## 🧭 Mapa fase → marco de cronograma

Relaciona as fases acima aos marcos semanais sugeridos no [doc 06](../docs/06-planejamento.md).
As **fases** são por escopo; os **marcos**, por tempo — ajuste conforme a data real.

| Marco (doc 06) | Fases |
|---|---|
| Fundação | 0, 1 |
| Leilão + Carteira | 2, 3 |
| Abertura + Inventário + Tempo real | 4, 5, 6 (parcial) |
| Distribuição | 6, 7, 8 |
| Extras + Polimento | 9, 10 |
| Fechamento | 10 |

---

## 📝 Registro de progresso

> Uma linha por marco/tarefa concluída. Formato: `AAAA-MM-DD — <commit/PR> — <resumo>`.

- 2026-06-14 — `f753eaa` — Documentação e estrutura inicial do projeto.
- 2026-06-14 — `e32c29e` — Fatia vertical: lance ponta a ponta (React → Node → Go → Go).
- 2026-06-14 — `95f8798` — Migração da stack de Go para Java (auction e wallet). **Fase 0 concluída.**
- 2026-06-14 — _(este commit)_ — Criação do roadmap/estado de desenvolvimento (`plan/ROADMAP.md`).
- 2026-06-14 — _(este commit)_ — Especificada a entrada por sala: criar sala + **código**, entrar por código e **mínimo 2 jogadores** para iniciar (docs 02/03/07/09 + roadmap Fases 4 e 6).
- 2026-06-14 — _(este commit)_ — **Fase 1 concluída.** Dockerfiles dos 5 serviços + `.dockerignore`; compose `--profile local` com healthchecks e ordem de subida; schema Postgres em `infra/db/init`; `balance.yaml` lido em runtime (Java `BalanceConfig` + worker Python); `PG_PORT` configurável. Verificado: `up --build` sobe os 8 containers (Redis/RabbitMQ/Postgres healthy) e o `test-slice.mjs` passa ponta a ponta dentro dos containers.
- 2026-06-15 — _(este commit)_ — **Fase 2, increment 1 (ciclo de vida da caixa).** Auto-close por cronômetro + anti-sniping; `Settle` na carteira (debita o vencedor) + release dos perdedores; reposição por slot; desempate por lock/timestamp do servidor. Gateway expõe fechamento por polling (`BOX_SOLD`); frontend com contagem regressiva. Teste de concorrência `BoxStoreTest` (4 testes, 8×200 lances). Verificado: `mvn test` verde; no stack, lance → auto-close → `arrematada` → `BOX_SOLD`; regressão do `test-slice` ok.
- 2026-06-15 — _(este commit)_ — **Fase 2, increment 2 (abertura/RNG).** `OpenBox` RPC; `BoxOpener` com RNG de seed injetável (`RNG_SEED`), odds do `balance.yaml`, afinidade somada + renormalização (Σ P = 1). Caixas arrematadas ficam disponíveis para o vencedor abrir; gateway trata `OPEN_BOX` (reply síncrono + broadcast `BOX_OPENED`); frontend abre a caixa e mostra o item. Testes: `BoxOpenerTest` (determinismo/renormalização/afinidade) + `openBox` no `BoxStore` (10 testes no total). Verificado: `mvn test` verde; no stack, lance → auto-close → `OPEN_BOX` → item sorteado (COPPER) → `BOX_OPENED`.
- 2026-06-25 — _(este commit)_ — **Fase 8 (de-risk R9): smoke test em AWS EC2 verde.** Scripts versionados em `infra/deploy/` (`provision.sh`, `user-data.sh`, `start.sh` + `DEPLOY.md`) sobem o stack completo numa EC2 (AL2023, t3.medium) via Docker Compose; correção do `VITE_GATEWAY_URL` para o DNS público e install do buildx no bootstrap (compose `--build` exige buildx ≥ 0.17). Verificado: jogo acessível em `http://<dns-público>:5173`. Pendentes: validar multi-cliente (R1), topologia 2–3 instâncias (R6) e demo gravada (Fase 10).
- 2026-06-25 — _(este commit)_ — **Fases 4/5 (async/messaging real).** O Leilão passa a **publicar eventos** em vez de o gateway fazer polling: `EventPublisher` (Java) emite em **Redis Pub/Sub** (`room:{id}:events`: ROUND_STARTED/BID_PLACED/BOX_SOLD/ROUND_ENDED/BOX_OPENED) e em **RabbitMQ** (durável: `box.opened`, `round.started`). `BoxStore` ganhou um `RoundListener` (chamado fora do lock). O **gateway** virou relay stateless: assina o canal Redis (ioredis) e difunde; o sync continua via gRPC (lance/abertura). O **worker (Python)** consome `box.opened`, recalcula o **mercado** por escassez relativa e publica `MARKET_UPDATED` (gateway → clientes); frontend mostra os preços. Deps novas: jedis+amqp-client+jackson (auction), ioredis (gateway). Verificado: `mvn test` 12 verde + fat jar empacota; `tsc` limpo (gateway+frontend); `py_compile` ok + curva de preço conferida. Resultado: **R4/R5/R8 → 🟢**. Live (Redis/RabbitMQ) exige subir o stack (`./dev.sh up`). Falta R6 (partição/replicação).
- 2026-06-25 — _(este commit)_ — **Fase 2, increment 3 (modelo de rodadas + odds públicas).** `BoxStore` reescrito para o ciclo round-based: **uma caixa por rodada** com tipo **sorteado** (pesos do `balance.yaml`, seed reproduzível), cronômetro armado no início (a rodada fecha mesmo sem lances) + anti-sniping, pausa entre rodadas e abertura pelo vencedor. Contrato: `GetVaultState`→`GetRoomState`, `Box.odds`, `RoomState{round,active,box,ends_at}` (proto regenera; `AuctionServer` atualizado). Gateway deriva `ROUND_STARTED`/`ROUND_ENDED`/`BOX_SOLD` por polling e repassa as odds; frontend mostra **uma caixa por rodada com odds públicas** + contador de rodada. Testes: `BoxStoreTest` reescrito (8 testes — corrida 8×200, ciclo de rodada, rodada sem lances, anti-snipe, sorteio determinístico) → `mvn test` verde (12 no total); `tsc --noEmit` limpo no gateway e no frontend; `test-slice.mjs` adaptado. Falta o **increment 4 (partição por sala)**.
- 2026-06-25 — _(este commit)_ — **Decisão de modelo: jogo round-based + partição por sala.** O leilão deixa de ser "várias caixas simultâneas em vaults" e passa a **rodadas sequenciais com UMA caixa por rodada** (tipo sorteado, odds públicas exibidas). Confirmado contra a especificação oficial (`docs/SCD-2026-1-…pdf`) que isso **atende a todos os requisitos** (R3 vira contenção de toda a sala numa caixa; R6 passa a particionar o Leilão **por sala** + Carteira por jogador). Docs sincronizados: 02, 03, 04, 05, 07, 09 + `balance.yaml` (bloco `round`) + `schema.sql` (`rooms.current_round`, `boxes.round_no`). Implementação (rodadas/odds no auction + frontend) é a próxima tarefa (Fase 2, increments 3/4).
- 2026-06-26 — _(este commit)_ — **Fase 2, increment 4 (particionamento por sala).** Duas instâncias de Leilão (`auction-vault1`=room-1, `auction-vault2`=room-2) no profile `local`, cada uma com sua wallet shard; o **gateway** roteia ações (gRPC) e fan-out (Redis) por sala via `ROOM_ROUTES`, assinando o canal de cada sala e difundindo só aos clientes dela; frontend ganhou seletor de sala. Correção: `EventPublisher` agora **re-tenta** a conexão RabbitMQ (corrige corrida de boot que desativava o messaging). Verificado no stack: salas **isoladas** (lance da room-1 não vaza p/ room-2), loop de mercado intacto, e **queda da `auction-vault2` derruba só a room-2** (room-1 segue: `WELCOME`), restaurando depois. **R6 → 🟡** (partição ✓; falta replicação — Postgres réplica, Fase 7).
- 2026-06-26 — _(este commit)_ — **Fase 7 (replicação Redis): primary→réplica.** Compose ganhou `redis-replica` (`--replicaof redis 6379`). O **worker** escreve `market:prices` no **primário** a cada recálculo; o Redis replica para a réplica; o **gateway** lê o snapshot de mercado da **réplica** no `WELCOME` (read/write split — escrita no primário, leitura na réplica). Verificado no stack: réplica `role:slave` + `master_link_status:up`; `market:prices` idêntico em primário e réplica; propagação ao vivo (`SET` no primário → `GET` na réplica); `WELCOME` traz o mercado vindo da réplica. **R6 → 🟢** (partição + replicação demonstradas). Postgres streaming replication fica como stretch (variante durável). `tsc` limpo + `py_compile` ok.
- 2026-06-26 — _(este commit)_ — **Ciclo de partida: lobby + tempo + patrimônio + ranking (Fase 6).** O gateway ganhou uma **máquina de estados de partida** (em memória) sobre os 2 slots de sala (preserva a partição → até 2 partidas simultâneas): `CREATE_ROOM` (vira host + **código**), `JOIN_ROOM {code}`, lobby (`ROOM_STATE` com a lista de jogadores), `START_MATCH` (host, ≥2 → `RUNNING` + cronômetro `MATCH_DURATION_SECONDS`; host pode `END_MATCH`). Ações de jogo são **gated** em `RUNNING`. No fim: `endMatch` calcula o **patrimônio** (dinheiro + itens LIVRES a preço de mercado + bônus de coleções) e difunde o **ranking** (`MATCH_ENDED`). Conexão agora é **lobby-first** (HELLO → criar/entrar → lobby → partida → ranking). **Frontend** reescrito em fases: menu, lobby (código + jogadores + iniciar), partida (cronômetro + HUD/inventário/mercado/coleções) e tela de ranking. Verificado por WS (13/13): criar→entrar→gating→iniciar→lance→encerrar→ranking ordenado por patrimônio; `tsc` limpo. Próximo: **polish da UI** e demo.
- 2026-06-26 — _(este commit)_ — **Coleções (player-initiated).** `wallet.proto`: `FormCollection` + `Collection` + `PlayerState.collections`. A Carteira forma uma coleção se o jogador tem os itens LIVRES exigidos: **trava-os** (`FREE → LOCKED_COLLECTION`) e registra o bônus (receitas/bônus do `balance.yaml` via `BalanceConfig`). Itens travados não podem ser vendidos/queimados. Gateway: handler `FORM_COLLECTION` + `WALLET_UPDATED` com coleções; **frontend**: painel de coleções (receita, formável, formadas, bônus total) + botão "formar", e marca itens travados (🔒) no inventário. Verificado direto na Carteira (gRPC): 5 COPPER → forma `COMMON_ALLOY` (bônus 150) → 5 itens travados → 2ª formação `NOT_ENOUGH` → vender item travado `ITEM_LOCKED` (6/6). `mvn`/`tsc` limpos. Próximo: **ciclo de partida (lobby + tempo + fim → patrimônio + ranking)**, onde o bônus entra no patrimônio.
- 2026-06-26 — _(este commit)_ — **Operações de inventário: vender + queimar (Fase 3).** `wallet.proto`: `SellItem` (preço de mercado, passado pelo gateway que lê a réplica; a Carteira escolhe pelo tipo REAL do item e cai no valor base se faltar), `BurnItem` (+afinidade pelo tipo, com teto) e `PlayerState.affinities`. `WalletStore` ganhou venda/queima/afinidade; `WalletServer` os RPCs. O **Leilão** agora lê a afinidade da Carteira na abertura (`AffinitySource = gw::getAffinity`), então **queimar realmente enviesa o RNG** (mecanismo já testado em `BoxOpenerTest`). Gateway: handlers `SELL_ITEM`/`BURN_ITEM` + `WALLET_UPDATED` com afinidades; **frontend**: inventário acionável (botões vender/queimar por tipo) + linha de afinidade. Verificado no stack: ganhou COPPER+GOLD → vendeu COPPER por 12 (mercado) → saldo subiu → queimou GOLD → afinidade GOLD +2. `mvn` auction 12 verde + wallet empacota; `tsc` limpo. Próximo: **coleções**.
- 2026-06-26 — _(este commit)_ — **Inventário: a espinha da economia (Fase 3, parcial).** `wallet.proto` ganhou `AddItem` + `PlayerState.inventory` (`Item{id,type,state}`); `WalletStore` guarda itens por jogador; `WalletServer` implementa `AddItem` e `GetPlayer` com inventário. O **Leilão** credita o item ao vencedor na abertura (`OpenBox` → `AddItem`; MIMIC não vira item). O **gateway** virou cliente de leitura da Carteira (`WALLET_ROUTES` por sala) e envia `WALLET_UPDATED` **privado** (saldo+reservas+inventário) no WELCOME, após lance/abertura e em eventos de dinheiro; **frontend** mostra o **HUD** (saldo/reservado/gastável/inventário) + seletor de sala já existente. Verificado no stack: lance reserva 60 → arremate debita (940→880) → abrir credita o item (`inv=[SILVER]`). `mvn test` auction 12 verde; wallet empacota; `tsc` limpo. Próximo: operações de inventário (vender/guardar/queimar) + coleções; depois Postgres/ledger/Redlock.
- 2026-06-26 — `f083629` — **Melhorias de UX (Grupo A): nome obrigatório + opções de lance.** O menu bloqueia criar/entrar sem nome; os controles de lance ganharam presets (Mín/+10/+50/+100) e campo de valor custom (antes só um incremento fixo).
- 2026-06-26 — `3a5bd6b` — **Partida por N rodadas + intervalo com "pronto" (Grupo B1+B2).** O host escolhe o nº de rodadas ao criar a sala; a partida **encerra após N**. O intervalo entre rodadas virou um **teto** (`intermission_max_seconds`, 120s) com hook `AdvanceRound` (RPC): o gateway conta as rodadas, emite `ROUND_INTERMISSION`+`READY_STATE` e **adianta** a rodada quando todos ficam prontos; `START_MATCH` força uma rodada ativa já no início. Frontend: seletor de rodadas, tela de intervalo (contagem + "Estou pronto" + X/Y prontos), cabeçalho "Rodada X/N". Verificado no stack (5/5); `mvn` 12 verde, `tsc` limpo.
- 2026-06-26 — `0100275` — **Jogar novamente na mesma sala (Grupo B3).** `wallet.ResetPlayer` (zera o jogador: orçamento inicial, sem itens/afinidade/coleções); gateway `PLAY_AGAIN` (host, partida encerrada) zera as carteiras de todos, reabre o código e volta ao lobby; frontend com botão "Jogar novamente" no ranking. Verificado (5/5).
- 2026-06-26 — _(este commit)_ — **Penalidade do Mímico (extra de jogabilidade).** Abrir uma caixa 💀 agora **pune de verdade**: `wallet.ApplyMimic` sorteia UMA penalidade entre as possíveis — roubar % do dinheiro (`mimic.steal_money_pct`, 10%), roubar um item LIVRE ou anular o bônus de uma coleção formada. O Leilão aplica a penalidade na abertura (antes de responder, para o saldo já refletir quando o gateway reler a carteira) e difunde o efeito no `BOX_OPENED`; o frontend narra "💀 X abriu um MÍMICO — perdeu …". Verificado direto na Carteira (4/4: jogador novo 1000 → MONEY 10% → 900); `mvn` 12 verde, `tsc` limpo.
- 2026-06-26 — _(este commit)_ — **Painel de jogadores / "leitura da mesa" (extra estilo pôquer).** O gateway passou a difundir `PLAYERS_PANEL` (patrimônio VIVO de cada jogador da sala: dinheiro, nº de itens livres e net = dinheiro+itens a mercado+bônus), recalculado nos eventos que mexem no patrimônio/rodada (`BOX_SOLD`/`BOX_OPENED`/`ROUND_STARTED`/`ROUND_ENDED`) e no início da partida. O **frontend** mostra a "Mesa" (rivais ordenados por net, com 💰 dinheiro, 🎒 itens e 🔨 último lance — este lido dos próprios `BID_PLACED`). Verificado no stack (5/5): painel no início (2× 1000/0 itens), rival vê o lance, e após arrematar o dinheiro de quem ganhou cai no painel. `tsc` limpo.
- 2026-06-26 — _(este commit)_ — **Reformulação visual (Grupo C): casa de leilão.** Frontend reorganizado em **3 colunas** (esq.: "Você" + "Mesa"/leitura dos rivais; centro: **palco** com cortinas de veludo, holofote, pedestal e a caixa flutuando; dir.: mercado + inventário + coleções + eventos), substituindo a barra superior por painéis laterais. **Animações** com Framer Motion: entrada da caixa por rodada (mola), pulso no valor do lance, banner de destaque (vitória/abertura) e **tremor vermelho** no Mímico. **Efeitos sonoros** sintetizados via Web Audio (sem arquivos): martelo no lance/arremate, moeda na venda, fanfarra na coleção/abertura, baque no Mímico, "cortina" na nova rodada — com botão de mudo no cabeçalho. Dep nova: `framer-motion`. `npm run build` (tsc + vite) verde; o container serve 200 com framer-motion resolvido.
- 2026-06-26 — _(este commit)_ — **Cronômetro só após o 1º lance + renome dos baús.** O cronômetro de leilão (20s) agora **inicia apenas no 1º lance** — antes disso o lote fica aberto numa janela de abertura (`match.no_bid_timeout_seconds`=45s); sem nenhum lance até lá, o lote fecha **sem vencedor** e a partida segue (não trava). `BoxStore.armTimer` foi refatorado em `armOpening`/`armBid` (+ campo `Settings.noBidTimeoutMs`). Baús **renomeados** para não colidir com os materiais (Cobre/Prata/Ouro/Diamante): BRONZE/SILVER/GOLD/VAULT → **WOODEN/IRON/ROYAL/VAULT** (Madeira/Ferro/Real/Cofre) em `balance.yaml` (pesos + odds), fallbacks do `BoxStore` e docs (02/03/07/09). `mvn test` 13 verde (+1 novo: "cronômetro só após o 1º lance").
- 2026-06-26 — _(este commit)_ — **Baús, `$` e palco animado (melhorias visuais rodada 2).** **Baús por nível** (`Chest.tsx`, SVG com paleta Madeira/Ferro/Real/Cofre) substituem as medalhas; **`$`** em todo número monetário (mercado, coleções, carteira, Mesa, lances, ranking) via helper `money()`; **botões de lance movidos para um painel abaixo do palco** (largura cheia, sem o aperto das cortinas). Extras: **abertura animada do baú** (tampa abre + item voa), **drama do pregão** (anel de contagem + "dou-lhe uma/duas/três" + carimbo ARREMATADO), **confete** na vitória/coleção, **iluminação por raridade** (holofote/joia na cor do tier) e som (rangido na abertura + tique nos segundos finais). `advanceRound` reinicia a rodada no início da partida p/ janela cheia. `npm run build` verde; verificado no stack (rename + cronômetro só após o 1º lance: rodada fica aberta >25s sem lances e fecha ~20s após o lance).
- 2026-06-26 — _(este commit)_ — **Rodada 3: economia + capacidade + fold + desistir.** (1) **Economia rebalanceada** (`balance.yaml`): valores 10/30/100/300 (diamante acessível dentro do orçamento de 1000), **probabilidade igual** dos baús (25/25/25/25) e **9 coleções** calibradas em ~2–3× o valor dos itens consumidos (5 usando prata) — espelhadas no frontend e em `docs/03`. (2) **Limite de 15 jogadores/sala** (gateway `MAX_PLAYERS`, `JOIN_ROOM`→`ROOM_FULL`) e **rodadas** padrão **16** / mínimo **8** (opções 8/12/16/20/24/32). (3) **Fold/passar** (item 4): RPC `ForceClose` (auction; `BoxStore.forceClose` público) + o gateway acompanha o líder e, quando todos os bidders (menos o líder) passam, fecha a rodada já (o líder vence; sem líder = lote pulado); botão "Passar" + contador no frontend. (4) **Desistir → assistir** (item 7): ação `GIVE_UP` (espectador sai do cálculo de fold/pronto e das ações de jogo, mas **permanece no ranking**); botão "Desistir" + aviso "Assistindo" + marca na Mesa. Verificado no stack (8/8: cap, clamp de rodadas, fold fecha já, espectador barrado/no ranking) + mercado novo ao vivo (GOLD 150 / DIAMOND 450). `mvn` 13 verde, `npm run build` + `tsc` limpos.
- 2026-06-26 — _(este commit)_ — **Abertura rende 1–4 itens (camada de sorte).** Ao abrir, o baú agora sorteia o tipo (como antes) e **quantos** (`open.min_items`..`max_items`, padrão 1–4) DAQUELE tipo — ex.: `3× Diamante` — elevando o teto de valor de um baú muito além de 450. `BoxOpener.drawQuantity` (mesmo RNG com seed); `BoxStore.OpenResult.quantity` + `Settings.min/maxItems`; protos `OpenBoxReply.quantity` e `AddItemRequest.quantity` (a Carteira credita N itens); `box.opened` carrega `quantity` e o **worker soma N à oferta** do mercado; frontend mostra "N× item" (log + abertura animada com os emojis repetidos). Mímico segue penalidade única (sem itens). Verificado no stack (11/11): aberturas 1× / 3× / 4× creditadas certo, incl. **3× Diamante = 900**. `mvn` 13 verde, `tsc`/`build` limpos.
- 2026-06-26 — _(este commit)_ — **Chat por sala (Redis Pub/Sub).** Cada sala tem um chat: o gateway publica `CHAT_SEND` no canal `room:{id}:chat` (conexão `pub` dedicada) e o próprio gateway, assinante, faz fan-out de `CHAT {player,text,ts}` a todos da sala — em **qualquer estado** (lobby/partida/fim) e inclusive espectadores. Remetente **autoritativo** (ignora spoof), texto ≤ 300 chars, anti-spam leve (400 ms). Frontend: componente `ChatPanel` (lista que auto-rola + envio por Enter) no lobby, na partida (coluna direita) e no fim. Reaproveita o padrão pub-sub (objetivo R8). Verificado no stack (6/6: difunde ao remetente e aos demais, remetente autoritativo, cap de 300, vazio ignorado, funciona no lobby e em jogo). `tsc`/`build` limpos. Docs 07 atualizado.
- 2026-06-26 — _(este commit)_ — **Removido o "queimar" (burn) por inteiro.** Como o burn era a única fonte de **afinidade** (queimar item → +afinidade → enviesa as odds de abertura), a cadeia inteira saiu: protos (`BurnItem`/`BurnReply`/`BurnItemRequest`/`Affinity` + `PlayerState.affinities`), Carteira (`burnItem`, campo afinidade, `BurnResult`, `affinityLong`, afinidades no `GetPlayer`), Leilão (`AffinitySource`/`getAffinity`/`setAffinitySource`; `BoxOpener.draw` agora sorteia só pelas **odds públicas** — exibidas = aplicadas), gateway (`BURN_ITEM`, cliente `burnItem`, `affinities` no `WALLET_UPDATED`), frontend (botão "queimar", `BURN_RESULT`, linha de afinidade, passo "Como jogar"), `balance.yaml` (bloco `affinity`), worker (`item.burned`) e docs (01/02/03/04/05/06/07/09 + CLAUDE.md). Auction 12 testes verdes (BoxOpenerTest reescrito sem afinidade); `tsc`/`build` limpos. Verificado no stack (4/4): arremate + abertura (item+quantidade) seguem; carteira sem `affinities`; `BURN_ITEM` ignorado.
- 2026-06-26 — _(este commit)_ — **Sistema de cartas — Fase 1 (pipeline + 4 cartas).** Cartas de habilidade compradas com dinheiro (sorteadas, **preço crescente** `base+step×compras`), guardadas na mão e jogadas **no intervalo** (efeito na próxima rodada), **reveladas ao jogar**. Carteira: `cards`/`cardsBought`, RPCs `BuyCard`/`ConsumeCard`/`Transfer`, `PlayerState.cards`+`next_card_price`. Leilão: `SetRoundEffects` (efeitos pendentes→rodada no `startRound`; resolvidos por jogador no fechamento→`PendingOpen`) aplicando **Dobro** (abertura ×2) e **Seguro** (pula `applyMimic`). Gateway: `BUY_CARD`/`PLAY_CARD`, `pendingCards`/`blocked`, resolução no `ROUND_STARTED` (**Imposto** via `transfer`, **Bloqueio** barra o lance) + `CARD_PLAYED`/`CARD_EFFECTS`. Frontend: `Card.tsx` (arte por tipo), painel "Cartas" (comprar + mão + usar com alvo), selos de efeito. Cartas: **Bloqueio, Dobro, Imposto, Seguro**. Verificado no stack (12/12): preço crescente, mão, jogar/consumir, BLOCK barra o rival, TAX drena rivais, DOUBLE/INSURANCE registrados. `mvn` 12 verde, `tsc`/`build` limpos. Faltam 6 cartas (Fase 2).
- 2026-06-26 — _(este commit)_ — **Salvaguardas de recursos (salas ociosas/fantasma).** (1) **Heartbeat** no gateway (`ping`/`pong` a cada 30s, `HEARTBEAT_SECONDS`): conexões mortas (queda de rede sem `close` limpo) são `terminate()`adas → liberam o slot escasso da sala. (2) **Reaper de inatividade** (`ROOM_IDLE_MINUTES`=15): libera salas sem nenhuma mensagem de cliente há X min (lobby/partida abandonados) — difunde `ROOM_CLOSED` e os clientes voltam ao menu; salas em uso (qualquer atividade) são preservadas via `Match.lastActivity`. (3) **Auction `ResetOpens`**: o gateway limpa `pendingOpens`/`opened` no início de cada partida → sem acúmulo de estado entre jogos (corrige vazamento lento). Já existia: contagem de salas LIMITADA (slots fixos) e liberação imediata de sala vazia na desconexão. Verificado no stack (4/4): heartbeat mantém vivo + pinga; reaper encerra ociosa mas NÃO a ativa; smoke do jogo normal ok. `mvn` 12 verde, `tsc` limpo.
- 2026-06-27 — _(este commit)_ — **Fix: coleção credita o bônus no saldo NA HORA.** Com os itens
  agora consumidos ao formar, o bônus (que antes só contava no ranking final) ficava invisível —
  parecia que o jogador perdia os itens à toa. Agora `formCollection` faz `balance += bonus` (vira
  dinheiro usável já). Para não contar em dobro: o ranking/painel passam a `net = saldo + itens
  livres` (o bônus já está no saldo) e a coluna 🏅 some do ranking; o Mímico que **anula** uma coleção
  agora desconta o bônus do saldo. Patrimônio total inalterado. Verificado (WS): formar credita +70
  (saldo sobe, itens consumidos) e o ranking não soma o bônus duas vezes (net = money + items).
- 2026-06-27 — _(estes commits)_ — **+3 ajustes.** (1) **Revelação da Maldição:** quando o alvo abre o
  Mímico forçado, ele descobre que foi amaldiçoado ("🪤 Você foi amaldiçoado!") — esclarece sem dar
  vantagem (já perdeu). Chain: `OpenResult.cursed` → `OpenBoxReply.cursed` (proto) → `OPEN_RESULT` →
  frontend (`openCursedRef` + sub/log). (2) **Botão "Comprar carta"** vira **"Mão cheia (n/4)"** e
  desabilita ao atingir o teto da mão. (3) **Confirmações estilizadas:** os `confirm()` nativos
  (Desistir/Sair) viram um **modal no tema do jogo** (`confirmDialog`). Verificado: WS 3/3 (open
  amaldiçoado → `cursed=true`); navegador 5/5 (modal abre/cancela/confirma) + botão "Mão cheia"
  desabilitado. `mvn` 17 verde, `tsc`/`build` limpos.
- 2026-06-27 — _(estes commits)_ — **6 ajustes de gameplay/UX.** (1) **Maldição invisível ao alvo:**
  `CARD_SCOPE.CURSE` vira `self` e o `cursed` sai do `CARD_EFFECTS` — o alvo não é avisado (senão só
  evitaria dar lance), descobrindo só ao abrir o Mímico; o efeito segue pelo auction. Selo `🪤
  Amaldiçoado` removido. (2) **Coleção CONSOME os itens** (`WalletStore.formCollection`: remove em vez
  de `LOCKED_COLLECTION`) — saem do inventário; patrimônio inalterado. (3) **Mesa** só nome + dinheiro.
  (4) **Mobile:** botões Encerrar/Desistir vão para o **rodapé** (evita toque acidental); desktop
  mantém no card "Você". (5) **Anel de contagem** usa `box.timerMs` real (não o fixo 20s) → começa
  cheio. (6) **Log de Eventos** escondido por padrão, só com **`?logs=1`** (recurso de demo).
  Verificado: WS 7/7 (Maldição não vaza, efeito aplica) + 6/6 (coleção consome, saldo igual);
  navegador 8/8 (Mesa, `?logs`, botões no rodapé, desktop ok). `mvn`/`tsc`/`build` limpos.
- 2026-06-27 — _(este commit)_ — **Deploy com domínio próprio + HTTPS (Caddy).** Novo perfil `prod`
  no compose: serviço **`web`** = imagem multi-stage (build estático do Vite + **Caddy**) que serve o
  frontend e faz **proxy do WebSocket** (`/ws` → `gateway:8080`), com **HTTPS automático** (Let's
  Encrypt) pelo `{$DOMAIN}`. `start.sh` ganhou o modo **`DOMAIN=…`**: injeta `VITE_GATEWAY_URL=
  wss://<dom>/ws` + `VITE_PUBLIC_URL=https://<dom>` e sobe `--profile prod` (sem o frontend Vite); sem
  `DOMAIN` segue o caminho IP/`http` de antes. Arquivos: `infra/deploy/Caddyfile`,
  `services/frontend/Dockerfile.prod`, `web` + volumes `caddy_data/config` no compose, doc em
  `DEPLOY.md`. Verificado: `compose config` válido nos 2 perfis (local intocado, sem `DOMAIN`),
  imagem `web` builda, bundle com `wss://…/ws` + `og:image` no domínio, `caddy validate` → "Valid
  configuration" (HTTP→HTTPS + TLS automático). R9 evolui para domínio/HTTPS reais.
- 2026-06-27 — _(este commit)_ — **UI responsiva (mobile-friendly).** Sem mexer no desktop (tudo via
  breakpoints `sm:`): **cabeçalho** compacto no mobile (título menor + gavel menor, subtítulo e "Sala"
  ocultos, "Rodada X/Y" vira só "X/Y", "Cartas"→🃏) — antes o título estourava/cortava; **padding** do
  app reduzido; **log de Eventos OCULTO no mobile** (`hidden sm:block`, não essencial); tabela do
  ranking final com **scroll horizontal** + código da sala no lobby em `text-4xl` com `flex-wrap`. O
  grid da partida já empilhava em coluna única abaixo de `lg` (ordem main→carteira→mercado/chat).
  Verificado em navegador real (puppeteer, viewport 390×844): menu/lobby/jogo cabem e rolam,
  Eventos oculto, painéis (Mercado/Coleções/Chat) presentes; **desktop idêntico ao baseline**.
- 2026-06-27 — _(este commit)_ — **Sair da sala (após desistir).** Quem desiste (espectador) ganha
  um botão **"🚪 Sair da sala"** que sai da partida de vez e volta ao menu. Novo `LEAVE_ROOM` no
  gateway: remove o jogador de todos os conjuntos da partida (sem guardar assento p/ reconexão),
  reatribui o host se preciso, libera a sala se ficou vazia, e responde `LEFT_ROOM` (o frontend limpa
  a sessão e volta ao menu). Diferente de desistir (que continua no ranking assistindo), sair tira o
  jogador do ranking. Verificado: WS 6/6 (sai do estado/painel dos demais, vira "roomless", a partida
  segue) e navegador 6/6 (desiste → vê o botão → sai → menu com sessão limpa, enquanto o outro segue).
- 2026-06-27 — _(este commit)_ — **Fix: reconexão travava no "Reconectando…".** Causa raiz: o
  `useEffect(() => () => wsRef.current?.close(), [])` fechava o socket de reconexão recém-criado
  durante o ciclo monta→desmonta→remonta do **StrictMode** (DEV), e o guard `autoResumed` impedia
  nova tentativa — socket fechava "antes de estabelecer", preso eternamente (criar sala funcionava
  por ser clique, não efeito de montagem). Removido esse cleanup. Reforços: sessão em
  **`sessionStorage`** (por aba — duas abas no mesmo navegador não colidem mais a sessão; ainda
  sobrevive a refresh), **timeout de 8s** que desiste sozinho (nunca trava) e **botão "Cancelar"**
  no overlay. Verificado em navegador real (puppeteer, 6/6): refresh no lobby volta ao lobby, refresh
  no meio do jogo volta ao jogo; aba nova começa no menu.
- 2026-06-27 — _(estes commits)_ — **Marca + UI + notificações direcionadas.** (1) Ícone trocado de
  🔨 por um **martelo de leilão** em SVG (`Gavel.tsx`) no cabeçalho; **favicon.svg** (mesma arte) e
  **imagem Open Graph** (`public/og.png` 1200×630) + meta OG/Twitter no `index.html` p/ preview ao
  compartilhar (WhatsApp) — base absoluta via `VITE_PUBLIC_URL` (default no Dockerfile/compose,
  injetado no `start.sh` com o DNS da EC2). (2) **Cartas mais largas** (nome em 1 linha), **Eventos
  recolhível**, **copiar código da sala**. (3) **Notificações de carta direcionadas** (`CARD_SCOPE`):
  `self` (Dobro/Seguro/Desconto/Visão/Escudo → só o autor), `target` (Bloqueio/Maldição → autor+alvo),
  `group` (Imposto/Martelo/Reforço → toda a sala) — o `CARD_PLAYED` (flash/log) deixa de incomodar
  quem a carta não afeta. Verificado: escopo 12/12 no stack; favicon/og servidos; gavel + nomes das
  cartas por screenshot; `tsc`/`build` limpos.
- 2026-06-26 — _(este commit)_ — **Homepage refeita (redesign ousado).** Menu reescrito em seções
  full-bleed centradas: hero ("Arremate. Abra. Enriqueça."), tira dos 4 **baús com dica de prêmio**
  (`TIER_HINT`, qualitativa p/ não divergir do `balance.yaml`), **como jogar em 4 passos**, **vitrine
  das 10 cartas** (componente `Card`) e CTA "Entre na mesa" (mesma lógica `connect()`). Regras antigas
  removidas; copy atualizada (cartas, coleções, fold, mímico, 1 carta/intervalo). Entrada animada
  (framer-motion). Conferido por screenshot do stack; `build` limpo.
- 2026-06-26 — _(este commit)_ — **Lote de UX (4 itens).** (1) **Overlay de bloqueio** — quem está
  bloqueado vê os botões de lance substituídos por um painel vermelho "Você está BLOQUEADO" + tinta no
  palco (antes era só um selo). (2) **Uma carta por intervalo** — guard no gateway (`Match.playedThisInterval`,
  zera a cada intervalo; 2ª jogada → `ALREADY_PLAYED_CARD`) + UI desabilita "Usar" após jogar. (3)
  **Cores de nome no chat** — `colorOf(playerId)` mapeia para 1 de 9 cores estáveis por jogador. (4)
  **Fila de overlays** — `flash`/`opening` viram uma fila única (`overlayQueue` + driver que mostra a
  cabeça pelo seu tempo e avança; teto 6); abrir caixa + ser bloqueado, p.ex., aparecem **em sequência**
  sem sobrepor. Verificado: guard 4/4 no stack (`ALREADY_PLAYED_CARD`); `tsc`/`build` limpos; itens
  visuais conferidos por build + revisão.
- 2026-06-26 — _(este commit)_ — **Reconexão à sessão (sobrevive a refresh/queda).** O `playerId`
  vira token de sessão: o frontend o persiste (+ sala/código/nome) em `localStorage` e, ao abrir/
  recarregar, **auto-reconecta** (`?resume=<id>&room=<slot>`). No gateway, `ws.on("close")` durante a
  partida **guarda o assento** em `Match.disconnected` (não libera a sala na hora); a conexão com
  `resume` religa o cliente ao mesmo `playerId` (carteira/cartas/host/posição na rodada preservados),
  envia `RESUMED` + snapshot (`WELCOME` + carteira + intervalo + `CARD_EFFECTS`) e avisa os demais.
  Um sweep descarta assentos após `RECONNECT_GRACE_MINUTES` (3) e libera salas sem ninguém vivo;
  `resume` inválido/expirado → `RESUME_FAILED` (limpa storage, volta ao menu). Verificado no stack
  (8/9; o 1 vermelho é timing do harness): sala segue aberta na queda, `RESUMED` com mesmo id +
  carteira + líder da rodada restaurados, resume inválido e pós-graça → `RESUME_FAILED`. `tsc`/`build`
  limpos.
- 2026-06-26 — _(este commit)_ — **Sistema de cartas — Fase 2 (as outras 6).** Completa o baralho de 10. **Desconto** (`settle` aceita `discount_pct` → débito menor na Carteira), **Maldição** (vitória do alvo abre Mímico), **Reforço** (`box_tier_boost` sobe o nível do baú no `startRound`), **Escudo** (gateway anula Bloqueio/Maldição/Imposto sobre o portador), **Martelo** (incremento mínimo dobrado p/ rivais no `placeBid`; UI dobra o mínimo exibido), **Visão** (drop **pré-sorteado** no `startRound` + RPC `PeekDrop` → o gateway revela em privado a quem tem a carta). `RoomEffects`/`SetRoundEffects` carregam `gavel`/`insight`/`discounts`/`box_tier_boost`; `CARD_EFFECTS` ganha `cursed`/`shielded`/`gavel`. As 6 cartas entram nos `cards.weights`. Verificado: **`mvn` 17 verde** (+5 testes de efeito: Reforço→VAULT, Martelo 2× incremento, Desconto repassa %, Maldição→Mímico, `PeekDrop`==item aberto); live no stack — mão jogada ponta a ponta sem erro de proto, Visão entrega o drop, Imposto drena rival (1000→975), **Escudo anula o Bloqueio** (`blocked` vazio, `shielded` populado). `tsc`/`build` limpos. **Baralho de 10 cartas completo.**
