# 🗺️ Roadmap & Estado do Desenvolvimento — Hammer Price

> **Este é o arquivo-fonte do estado de desenvolvimento do projeto.**
> Sempre que quiser saber *o que já foi feito*, *o que está em andamento* e *o que
> falta*, comece por aqui. Agentes de IA e pessoas do time devem manter este arquivo
> sincronizado com a realidade do código.

- **Disciplina:** Software Concorrente e Distribuído (SCD) — UFG, 2026.1
- **Entrega:** 28/06/2026
- **Última atualização deste arquivo:** 2026-06-25
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
