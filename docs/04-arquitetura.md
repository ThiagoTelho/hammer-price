# 04 — Arquitetura

## Visão de componentes

```
                         ┌──────────────────────────────┐
                         │         Cliente Web           │
                         │      React + TS + Canvas      │
                         └───────┬───────────────┬───────┘
                   WebSocket     │               │   REST (ações pontuais:
              (estado/eventos)   │               │   entrar na sala, etc.)
                                 ▼               ▼
                         ┌──────────────────────────────┐
                         │     Gateway de Tempo-Real     │
                         │        Node.js + TS           │
                         │  - mantém conexões WS         │
                         │  - fan-out (Redis Pub/Sub)    │
                         │  - traduz ação → gRPC         │
                         └───┬───────────────┬───────────┘
                gRPC (síncrono)              │ assina broadcast
                             │               ▼
              ┌──────────────▼─────┐   ┌─────────────────────┐
              │  Serviço de Leilão │   │   Redis (Pub/Sub +   │
              │      (Java)        │◄─▶│  estado quente +     │
              │  - lances atômicos │   │  Redlock)            │
              │  - timers/caixas   │   └─────────┬───────────┘
              │  - RNG de abertura │             │
              │  PARTICIONADO      │             │
              │  por vault         │             │
              └───┬────────┬───────┘             │
       gRPC (síncr)│        │ publica eventos     │
                   │        ▼ (RabbitMQ)          │
       ┌───────────▼──────┐ │   ┌─────────────────▼────────┐
       │ Serviço Carteira │ │   │   RabbitMQ (messaging)    │
       │     (Java)       │ │   │  filas de eventos/trabalho│
       │ - saldo/inventár.│ │   └───────────┬───────────────┘
       │ - consistência   │ │               │ consome
       │   FORTE (Redlock │ │               ▼
       │   + tx Postgres) │ │     ┌──────────────────────┐
       │ PARTICIONADO     │ │     │   Worker (Python)     │
       │ por jogador      │ │     │ - engine de mercado   │
       └────────┬─────────┘ │     │ - avaliação de sets   │
                │           │     │ - reconciliação       │
                ▼           ▼     └──────────┬───────────┘
       ┌──────────────────────────────────────▼──────────┐
       │            PostgreSQL (primary + read replica)   │
       │   ledger, inventário, partidas, resultados       │
       └──────────────────────────────────────────────────┘
```

## Responsabilidade de cada componente

### Cliente Web — React + TypeScript
Renderiza o estado compartilhado (caixas, lances, cronômetros, inventário, mercado,
ranking). Recebe atualizações em tempo real por **WebSocket**; envia ações como dar lance,
abrir caixa, vender/queimar item via mensagens que o gateway encaminha.

### Gateway de Tempo-Real — Node.js + TypeScript
- Mantém milhares de conexões WebSocket (I/O assíncrono é o forte do Node).
- **Fan-out assíncrono:** assina os canais Redis Pub/Sub e empurra eventos aos clientes.
- **Tradução de paradigma:** uma ação do cliente vira uma chamada **gRPC síncrona** ao
  serviço dono (Leilão ou Carteira) e a confirmação volta ao cliente que pediu.
- Não guarda estado de jogo autoritativo (é *stateless*; pode ter réplicas atrás de um LB).

### Serviço de Leilão (core) — Java (Maven + gRPC)
Coração concorrente do jogo:
- **Lances atômicos:** cada caixa é protegida por um `ReentrantLock` (lock por caixa) que
  serializa lances concorrentes e valida contra o lance atual.
- **Timers por caixa** com anti-sniping (thread agendada por caixa ou roda de timers).
- **RNG de abertura** server-side, com seed injetável.
- **Particionado por vault:** cada instância é dona de um subconjunto de caixas. Isso
  distribui a carga e demonstra particionamento de funcionalidade.
- Reserva saldo chamando a **Carteira** (gRPC síncrono) antes de aceitar um lance.
- Publica eventos (`bid.placed`, `box.sold`, `box.opened`) em Redis Pub/Sub (broadcast) e
  RabbitMQ (processamento durável).

### Serviço de Carteira / Inventário — Java (Maven + gRPC)
Guardião da **consistência forte**:
- Saldo, reservas e inventário de cada jogador.
- **Reserva atômica** de saldo: garante `saldo ≥ 0` mesmo com lances simultâneos em vaults
  diferentes (lock distribuído via **Redlock** + transação Postgres).
- **Particionado por jogador** (shard por `playerId`).
- Registra tudo no **ledger** (auditoria e reconciliação).

### Worker de Background — Python
Processamento que roda **concorrentemente** com os clientes, consumindo filas RabbitMQ:
- **Engine de mercado:** recalcula preços periodicamente conforme oferta/demanda.
- **Avaliação de coleções:** detecta sets formados, aplica bônus.
- **Reconciliação:** confere o ledger contra os saldos (consistência eventual → corrige
  divergências).
- **Manutenção das regras:** expira caixas, repõe oferta, processa efeitos do Mímico.

### Infraestrutura de dados
- **Redis:** estado quente (lance atual, cronômetros), **Pub/Sub** (broadcast) e
  **Redlock** (lock distribuído). Replicado.
- **RabbitMQ:** mensageria durável (eventos e filas de trabalho) — paradigma *messaging*.
- **PostgreSQL:** verdade durável (ledger, inventário, resultados), com **primary + read
  replica** (replicação; leituras de ranking/histórico vão à réplica).

## Paradigmas de interação (exigência da disciplina)

| Paradigma | Onde |
|---|---|
| **Cliente-servidor** | REST cliente↔gateway; gRPC gateway↔serviços e entre serviços |
| **Publish-subscribe** | Redis Pub/Sub: eventos de jogo difundidos a todos os clientes |
| **Messaging** | RabbitMQ: filas de eventos/trabalho consumidas pelo worker |

## Síncrono × Assíncrono

A mesma ação "dar lance" exercita os dois modos:

- **Síncrono / bloqueante:** o cliente envia o lance; o gateway faz gRPC ao Leilão, que
  faz gRPC à Carteira para reservar saldo, e **só então** responde *aceito/rejeitado*. O
  jogador espera a confirmação.
- **Assíncrono:** o evento `bid.placed` é publicado e **difundido** a todos os outros
  jogadores via Pub/Sub, e enfileirado no RabbitMQ para o worker — sem o emissor esperar.

## Particionamento

| Dado/Função | Critério de partição |
|---|---|
| Caixas / leilões | por **vault** (cada instância de Leilão cuida de um grupo) |
| Carteira / inventário | por **jogador** (shard por `playerId`) |
| Mercado | serviço/worker dedicado (partição funcional) |

## Replicação

| Dado | Estratégia |
|---|---|
| Estado quente (lance atual, timers) | Redis replicado |
| Ledger / inventário / resultados | PostgreSQL **primary + read replica** |
| Preços de mercado / ranking | cache replicado para leitura (eventual) |

## Consistência e disponibilidade

- **Forte** onde dinheiro está em jogo: reserva/débito de saldo e mudança de inventário
  usam **lock distribuído (Redlock) + transação Postgres**. Nunca permite saldo negativo
  nem item em dois estados.
- **Eventual** onde latência importa mais que exatidão instantânea: preços de mercado,
  ranking e inventário "parcial" dos adversários são lidos de caches/réplicas; a
  reconciliação do worker corrige divergências.
- **Disponibilidade:** gateway e Leilão são replicáveis; a queda de uma instância de vault
  afeta só aquele grupo de caixas, não a partida inteira (isolamento por partição). O
  estado autoritativo persiste em Redis/Postgres, permitindo *failover*.

## Sequência: ciclo de vida de um lance

```
Cliente        Gateway        Leilão(Java)     Carteira(Java)   Redis/RabbitMQ
  │  placeBid     │                │                 │                 │
  ├──WS──────────►│                │                 │                 │
  │               ├──gRPC(síncr)──►│                 │                 │
  │               │                ├──reserve(gRPC)─►│                 │
  │               │                │                 ├─Redlock+tx──────┤
  │               │                │◄──ok────────────┤                 │
  │               │                ├──publica bid.placed────────────►  │ (Pub/Sub+MQ)
  │               │◄──aceito───────┤                 │                 │
  │◄──confirmação─┤                │                 │                 │
  │               │   broadcast a TODOS os clientes ◄─── assina ───────┤
  │◄══════════════╪════════════════════════════════════════════════════
```

> Contratos detalhados (proto, eventos, REST) em [07 — Contratos de API](07-contratos-api.md).
> Esquemas de dados em [09 — Modelo de Dados](09-modelo-de-dados.md).
