# 06 — Planejamento

> Entrega: **28/06/2026**. O planejamento prioriza ter, cedo, um **núcleo
> demonstrável** que já satisfaz todos os requisitos obrigatórios, deixando
> mecânicas ricas (mercado, mímico, seguro) como incrementos opcionais.

> 📍 **Estado vivo das tarefas:** este documento descreve a *estratégia*. O
> acompanhamento concreto (o que está feito / em andamento / a fazer, por fase) fica em
> [`../plan/ROADMAP.md`](../plan/ROADMAP.md) — a fonte única do estado de desenvolvimento.

## Estratégia de escopo: núcleo vs. extras

### Núcleo (essencial — cobre TODOS os requisitos)
- Sala/partida com tempo fixo e múltiplos jogadores.
- Leilão de caixas com odds públicas, lances síncronos e cronômetro/anti-sniping.
- Reserva e débito de saldo com consistência forte (sem saldo negativo).
- Abertura de caixa com RNG server-side + afinidade.
- Inventário + coleções + cálculo de patrimônio final.
- Broadcast em tempo real (Pub/Sub) + uma fila de eventos (messaging).
- Particionamento (sala/jogador) + replicação (Postgres réplica) demonstráveis.
- Deploy em AWS EC2.

### Extras (ligam se sobrar tempo, sem quebrar o núcleo)
- Mercado dinâmico (engine de preços no worker).
- Mímico (penalidades) + seguro.
- Inventário parcial visível dos adversários ("leitura de pôquer").
- Dashboard de administração com métricas em tempo real.
- Failover automático mais elaborado.

## Marcos (sugestão de cronograma)

| Semana | Marco | Entregáveis |
|---|---|---|
| 1 | **Fundação** | Repos, contratos (proto/eventos), modelo de dados, docker-compose local subindo "esqueletos" que se comunicam |
| 2 | **Leilão + Carteira** | Lance síncrono ponta a ponta; reserva/débito consistente; teste de corrida de lances |
| 3 | **Abertura + Inventário + Tempo real** | RNG+afinidade; coleções; broadcast Pub/Sub; frontend jogável |
| 4 | **Distribuição** | Particionamento por sala/jogador; réplica Postgres; deploy em AWS EC2; cenário de falha |
| 5 | **Extras + Polimento** | Mercado/mímico/seguro (se der); dados de teste; ensaiar demo |
| 6 | **Fechamento** | Gravar vídeo, finalizar documentação, revisar, entregar (28/06) |

> Ajustar à data real de início. O importante é a **ordem**: contratos → núcleo
> consistente → distribuição/AWS → extras.

## Divisão de tarefas (4 integrantes)

| Frente | Responsável | Escopo |
|---|---|---|
| **Core/Leilão (Java)** | _a definir_ | Serviço de Leilão, rodadas, lances atômicos, timers, RNG, particionamento por sala (room) |
| **Carteira/Worker (Java/Python)** | _a definir_ | Carteira, Redlock+tx, ledger, worker de mercado/sets/reconciliação |
| **Gateway/Frontend (Node/React)** | _a definir_ | Gateway WS, tradução gRPC, SPA React, UX do leilão |
| **Infra/AWS/Docs** | _a definir_ | Docker, RabbitMQ/Redis/Postgres, deploy EC2, documentação, dados de teste |

As frentes têm dependências cruzadas (contratos), então a **Semana 1 é colaborativa**:
definam juntos os `.proto` e eventos antes de cada um seguir.

## Definição de pronto (Definition of Done)

Uma feature está pronta quando:
- [ ] Contrato (proto/evento/REST) atualizado em `docs/07-contratos-api.md`.
- [ ] Serviço dono do dado implementado e exposto.
- [ ] Eventos emitidos onde aplicável.
- [ ] Teste de concorrência quando há recurso compartilhado (ex.: corrida de lances).
- [ ] Sobe via `docker compose up` sem passos manuais.
- [ ] Documentação afetada atualizada.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Consistência distribuída é a parte mais difícil | Atacar a reserva de saldo **primeiro** (semana 2); é o coração do trabalho |
| Deploy AWS atrasar no fim | Subir um "hello world" em EC2 já na semana 1; deploy contínuo |
| Escopo inflar (mercado, mímico...) | Tratar como extras; núcleo congela cedo |
| Integração entre linguagens | Contratos gRPC/eventos definidos e versionados na semana 1 |
| Vídeo no fim do prazo | Roteiro pronto na semana 4 (ver doc 05); ensaiar na semana 5 |

## Dados de teste

- **Seeds de RNG fixas** para aberturas reproduzíveis.
- **Scripts de carga**: simular N jogadores dando lances concorrentes (validar invariantes
  de saldo). Ficam em `infra/loadtest/`.
- **Cenários roteirizados**: corrida de lances, saldo compartilhado estourando, queda de
  uma instância de Leilão (um grupo de salas) — todos automatizáveis para o vídeo.

## Ferramentas de apoio

- **Claude Code** para desenvolvimento assistido — instruções em [`../CLAUDE.md`](../CLAUDE.md).
- **GitHub** para versionamento; entrega final também via **GitHub Classroom**.
- **Plataforma Turing** para documentação e vídeo.
