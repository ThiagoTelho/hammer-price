# 🗺️ Roadmap & Estado do Desenvolvimento — Hammer Price

> **Este é o arquivo-fonte do estado de desenvolvimento do projeto.**
> Sempre que quiser saber *o que já foi feito*, *o que está em andamento* e *o que
> falta*, comece por aqui. Agentes de IA e pessoas do time devem manter este arquivo
> sincronizado com a realidade do código.

- **Disciplina:** Software Concorrente e Distribuído (SCD) — UFG, 2026.1
- **Entrega:** 28/06/2026
- **Última atualização deste arquivo:** 2026-06-15
- **Marco atual:** Fase 2 em andamento (ciclo de vida + abertura/RNG concluídos; falta particionamento por vault)

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
| R1 | Acessível a múltiplos clientes na Internet | 🟡 parcial | Local (WS+REST) → AWS EC2 (Fase 8) |
| R2 | Vários componentes distribuídos coordenados | 🟢 ok | frontend/gateway/auction/wallet; + worker (Fase 5) |
| R3 | Acessos concorrentes a recursos compartilhados | 🟢 ok | Lock por caixa + wallet `synchronized`; → Redlock+SQL (Fase 3) |
| R4 | Processamento servidor concorrente com clientes | 🟡 parcial | Lances concorrentes; → timers/RNG/mercado (Fases 2,5) |
| R5 | Interação síncrona **e** assíncrona | 🟡 parcial | gRPC síncrono + broadcast em processo; → Pub/Sub+MQ (Fases 4,5) |
| R6 | Replicação **e** particionamento | 🔴 falta | → vault/jogador + Postgres réplica + Redis (Fases 2,3,7) |
| R7 | Consistência **e** disponibilidade | 🟡 parcial | Saldo nunca negativo (em memória); → forte (Fase 3) + failover (Fase 7) |
| R8 | >1 linguagem **e** >1 paradigma | 🟡 parcial | TS+Java; cliente-servidor+pub-sub; → +Python +messaging (Fase 5) |
| R9 | Demonstração em AWS EC2 | 🔴 falta | → Fase 8 |

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
> **Increments 1 (ciclo de vida) e 2 (abertura/RNG) concluídos.** Falta particionamento
> por vault (increment 3). A publicação de eventos em Redis/RabbitMQ é da Fase 4/5; por
> ora o gateway expõe fechamento/abertura por polling + broadcast.

- [x] Timer por caixa com **fechamento automático** ao zerar (`ScheduledExecutorService` + guarda contra disparo obsoleto) *(R4)*
- [x] **Anti-sniping:** lance nos últimos 5 s estende o cronômetro (volta a 8 s) *(R4)*
- [x] Fechamento da caixa: **debita** o vencedor (`Settle`) e **devolve** aos perdedores (release no outbid) *(R3,R7)*
- [x] Desempate do vencedor por **timestamp do servidor**: lock por caixa serializa; último lance válido vence *(R3)*
- [x] **Reposição** de oferta: nova caixa (novo id) entra no mesmo slot ao arrematar
- [x] Tipos de caixa + **odds do `balance.yaml`** dirigem o sorteio (`BoxOpener`); exibição pública das odds no frontend fica como polish
- [x] **RNG de abertura** server-side com **seed injetável** (`RNG_SEED`); `OpenBox` RPC + fluxo do vencedor *(R4)*
- [x] Afinidade somada às odds + **renormalização** (Σ P = 1, P ≥ 0) — mecanismo + teste; valores virão do *burn* (Fase 3)
- [ ] **Particionamento por vault:** cada instância dona de um subconjunto — increment 3 *(R6)*
- [ ] Publicação de eventos `bid.placed`/`box.sold`/`box.opened` (Redis Pub/Sub + RabbitMQ) — **Fase 4/5** *(R5)*
- [x] **Teste de concorrência:** corrida de lances na mesma caixa (`BoxStoreTest`, 8×200 lances) *(R3)*

## 📍 Fase 3 — Carteira/Inventário com consistência forte (Java · wallet)

> Guardião do dinheiro: migra do estado em memória para Postgres + lock distribuído.
> Ver invariantes em [doc 03 §9](../docs/03-regras-de-negocio.md) e [doc 09](../docs/09-modelo-de-dados.md).

- [ ] Persistência em **Postgres** (saldo, reservas, inventário) com **transações SQL** *(R7)*
- [ ] **Ledger append-only:** toda alteração de dinheiro registrada (base da reconciliação) *(R7)*
- [ ] **Redlock** (lock distribuído via Redis) para reserva atômica entre instâncias *(R3,R7)*
- [ ] **Particionamento por `playerId`** (shard) *(R6)*
- [ ] Invariante de inventário: item em **exatamente um** estado (livre / reservado-coleção / consumido)
- [ ] Operações de inventário: **guardar**, **vender** (mercado), **queimar** (afinidade)
- [ ] **Teste de concorrência:** lances simultâneos em vaults diferentes nunca deixam saldo negativo *(R3,R7)*

## 📍 Fase 4 — Tempo real distribuído (gateway + Redis Pub/Sub + REST)

> Substitui o broadcast em processo por fan-out distribuído e formaliza o REST.

- [ ] **Redis Pub/Sub** para fan-out de eventos (substitui o broadcast em processo) *(R5)*
- [ ] Gateway **stateless** e **replicável** (várias instâncias assinam os canais) *(R1,R6,R7)*
- [ ] Endpoints **REST** para ações pontuais — **criar sala** (retorna `code`), **entrar por código**, iniciar, snapshot, ranking — ver [doc 07](../docs/07-contratos-api.md) *(R1,R5)*
- [ ] Auction publica em Redis; gateway assina e empurra aos clientes certos *(R5)*
- [ ] Reconexão de cliente recebe **snapshot** atualizado do estado

## 📍 Fase 5 — Mensageria + Worker de background (Python)

> Acrescenta a 3ª linguagem, o paradigma **messaging** e o processamento concorrente
> de fundo. Ver [doc 04](../docs/04-arquitetura.md).

- [ ] **RabbitMQ:** filas de eventos/trabalho (paradigma messaging) *(R5,R8)*
- [ ] Auction publica eventos **duráveis** no RabbitMQ *(R5)*
- [ ] **Worker (Python)** consome as filas — esqueleto + conexão *(R4,R8)*
- [ ] **Engine de mercado:** recalcula preços periodicamente por escassez relativa *(R4)*
- [ ] **Avaliação de coleções:** detecta sets formados e aplica bônus
- [ ] **Reconciliação:** confere ledger × saldos e corrige divergências (consistência eventual) *(R7)*
- [ ] Manutenção das regras: expiração de caixas, reposição, efeitos do Mímico

## 📍 Fase 6 — Ciclo de partida + Patrimônio + Ranking

> Fecha o loop de jogo: sala com tempo fixo, coleções e cálculo de vencedor.
> Ver [doc 02](../docs/02-regras-do-jogo.md) e [doc 03](../docs/03-regras-de-negocio.md).

- [ ] **Criar sala:** qualquer jogador cria a partida e vira *host*; servidor gera um **código de sala** curto (ex.: `4F2K9`)
- [ ] **Entrar por código:** os demais jogadores entram digitando o código (lobby de espera)
- [ ] **Lobby:** todos veem quem já entrou; exige **mínimo 2 jogadores** (máx. 6) para iniciar
- [ ] **Iniciar partida:** o host dá a largada (`WAITING` → `RUNNING`, ≥ 2 jogadores); cronômetro de tempo fixo (15 min) começa
- [ ] **Coleções** (Liga Comum → Cofre Lendário) com itens travados e bônus
- [ ] **Patrimônio final:** devolve reservas, avalia coleções e itens pelo preço de mercado final
- [ ] **Ranking** e condição de vitória com desempates (coleções → patrimônio em itens)
- [ ] **Frontend:** inventário, mercado, coleções, ranking, cronômetro da partida

## 📍 Fase 7 — Replicação, disponibilidade e failover

> Demonstra explicitamente os mecanismos de tolerância a falha (R6/R7).

- [ ] **Postgres primary + read replica;** leituras de ranking/histórico vão à réplica *(R6)*
- [ ] **Redis replicado** (estado quente + Pub/Sub) *(R6)*
- [ ] Cenário de falha: queda de uma instância de **vault** isola só aquele grupo de caixas *(R7)*
- [ ] **Failover** demonstrável (estado autoritativo sobrevive em Redis/Postgres) *(R7)*

## 📍 Fase 8 — Deploy AWS EC2

> A demonstração avaliada **roda na nuvem**. Ver [doc 08](../docs/08-deploy-aws.md).

- [ ] Provisionamento das instâncias **EC2** (2–3) *(R9)*
- [ ] Deploy dos serviços via Docker/Compose nas instâncias *(R9)*
- [ ] **Acessível na Internet** a múltiplos clientes (frontend + API públicos) *(R1,R9)*
- [ ] Scripts de deploy versionados em [`infra/`](../infra/) *(R9)*
- [ ] "Hello world" em EC2 **cedo** (mitigação de risco do doc 06) *(R9)*

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
