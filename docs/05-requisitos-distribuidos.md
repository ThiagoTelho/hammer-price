# 05 — Mapeamento dos Requisitos da Disciplina

> Este é o documento que **conecta o jogo à nota**. Cada característica obrigatória do
> enunciado é mapeada para uma parte concreta e demonstrável do Hammer Price. Use-o como
> roteiro do vídeo e como checklist de avaliação.

## Tabela-resumo

| # | Requisito (enunciado) | Onde aparece no Hammer Price | Como demonstrar |
|---|---|---|---|
| 1 | Serviço acessível a múltiplos clientes na Internet | Cliente React acessa o gateway (WebSocket/REST) hospedado em EC2 | Vários navegadores em máquinas diferentes na mesma partida |
| 2 | Vários componentes distribuídos integrados/coordenados | Gateway, Leilão, Carteira, Worker, Redis, RabbitMQ, Postgres — todos nossos | Diagrama + containers rodando em EC2 distintas |
| 3 | Acessos concorrentes a recursos compartilhados | Caixas, **saldo**, **inventário**, **preços de mercado**, ranking | Dois jogadores dando lance na mesma caixa ao mesmo tempo |
| 4 | Processamento server-side concorrente com os acessos | RNG de abertura, engine de mercado, avaliação de sets rodando enquanto há lances | Logs do worker recalculando mercado durante a partida |
| 5 | Interação remota síncrona **e** assíncrona | Síncr.: gRPC do lance (aceito/rejeitado). Assíncr.: broadcast Pub/Sub + filas | Mostrar a confirmação bloqueante vs. o broadcast a todos |
| 6 | Replicação **e** particionamento | Replic.: Postgres primary+réplica, Redis. Partic.: vaults (Leilão) e jogador (Carteira) | Derrubar uma instância de vault; partida segue |
| 7 | Consistência **e** disponibilidade | Forte (Redlock+tx) no dinheiro; eventual no mercado/ranking; failover | Teste de corrida sem saldo negativo; queda de réplica |
| 8 | Múltiplas linguagens e paradigmas | TS + Go + Python; cliente-servidor + pub-sub + messaging | Apontar cada serviço e seu paradigma |
| 9 | Demonstração em AWS EC2 | Deploy via Docker Compose em 2–3 EC2 | Vídeo gravado contra os endpoints da AWS |

## Detalhamento por requisito

### 1. Múltiplos clientes na Internet
O cliente é uma SPA React servida por CloudFront/S3 (ou pelo próprio gateway). Conecta-se
ao gateway por WebSocket. Para a demo, **cada integrante entra de uma máquina/rede
diferente** na mesma sala — prova de acesso concorrente remoto real.

### 2. Componentes distribuídos próprios
Nenhum componente de jogo é "caixa-preta de terceiros": gateway, Leilão, Carteira e Worker
são implementados por nós. Redis/RabbitMQ/Postgres são infraestrutura de apoio (permitido),
mas a **coordenação** (reservas, locks, particionamento, eventos) é código nosso.

### 3. Concorrência sobre recursos compartilhados
Recursos disputados:
- **Caixa** (lance atual / último lance) — vários jogadores simultâneos.
- **Saldo** do jogador — disputado por **múltiplas caixas em vaults diferentes** ao mesmo
  tempo (o caso mais interessante: contenção distribuída).
- **Inventário** — vender vs. usar em coleção vs. queimar.
- **Mercado** — leituras/atualizações concorrentes.
Mecanismos: `sync.Mutex`/ator por caixa; **Redlock + transação** por jogador.

### 4. Processamento server-side concorrente
Enquanto os clientes interagem, o servidor executa **em paralelo**:
- Sorteio RNG das aberturas (Leilão).
- Recalculo de preços de mercado (Worker, periódico).
- Avaliação de coleções e efeitos do Mímico (Worker).
- Expiração de caixas e reposição de oferta.
Demonstra-se com logs/painel mostrando essas tarefas ativas durante os lances.

### 5. Síncrono (bloqueante) e assíncrono
- **Síncrono:** `placeBid` e `openBox` são RPCs gRPC que **bloqueiam** até aceito/rejeitado
  (precisam de resposta determinística para o jogador).
- **Assíncrono:** eventos de jogo (`bid.placed`, `box.opened`, `market.updated`) são
  **publicados** (Pub/Sub) e **enfileirados** (RabbitMQ) sem o emissor aguardar.

### 6. Replicação e particionamento
- **Particionamento de funcionalidade:** Leilão dividido por **vault**; Carteira por
  **jogador** (sharding). Cada instância é dona de sua fatia.
- **Replicação de dados:** PostgreSQL **primary + read replica** (leituras de
  ranking/histórico na réplica); estado quente replicado no Redis.

### 7. Consistência e disponibilidade
- **Consistência forte** (linearizável o suficiente) onde há dinheiro: reserva, débito,
  crédito e mudança de inventário sob **Redlock + transação Postgres**. Invariantes:
  saldo ≥ 0, item em estado único, último lance válido vence.
- **Consistência eventual** onde latência importa: preços de mercado e ranking são lidos
  de caches/réplicas; o **worker de reconciliação** corrige divergências contra o ledger.
- **Disponibilidade:** componentes *stateless* (gateway, Leilão) são replicáveis; falha de
  um vault isola-se àquele grupo de caixas; estado autoritativo sobrevive em Redis/Postgres.

### 8. Linguagens e paradigmas
- **Linguagens:** TypeScript (frontend + gateway), Go (Leilão + Carteira), Python (worker).
- **Paradigmas:** cliente-servidor (REST/gRPC), publish-subscribe (Redis Pub/Sub),
  messaging (RabbitMQ).

### 9. AWS EC2
Topologia e passo a passo em [08 — Deploy AWS](08-deploy-aws.md). A demonstração avaliada
**roda na AWS** — o vídeo é gravado contra os endpoints da nuvem.

## Roteiro de demonstração sugerido (para o vídeo)

1. **Abrir** 3–4 navegadores em máquinas/redes diferentes → mesma sala (req. 1).
2. **Corrida de lances:** dois jogadores dão lance na mesma caixa quase ao mesmo tempo →
   mostrar que só um vence, sem inconsistência, e o outro tem o saldo devolvido (req. 3, 5, 7).
3. **Saldo compartilhado:** um jogador tenta reservar em duas caixas além do saldo →
   segunda reserva é rejeitada (req. 3, 7).
4. **Background ativo:** abrir um painel de logs mostrando o worker recalculando o mercado
   e avaliando coleções durante a partida (req. 4).
5. **Pub/Sub:** um lance feito por um jogador aparece instantaneamente para todos (req. 5, 8).
6. **Tolerância a falha:** derrubar uma instância de vault (ou a réplica do Postgres) e
   mostrar que a partida continua (req. 6, 7).
7. **Fim da partida:** cálculo de patrimônio com coleções e mercado final → ranking (regra
   de negócio + req. 4).

Cada integrante conduz parte da demo (exigência de participação efetiva de todos).
