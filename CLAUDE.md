# Instruções para o Claude Code — Hammer Price

Este arquivo orienta agentes de IA (Claude Code) que trabalharem neste repositório.
Leia também os documentos em `docs/` antes de implementar qualquer coisa.

## ⭐ Estado do desenvolvimento — comece aqui

[`plan/ROADMAP.md`](plan/ROADMAP.md) é a **fonte única da verdade do estado de
desenvolvimento**: o que já foi feito, o que está em andamento e o que falta, por fase.
**Antes de implementar**, leia a fase relevante lá (e o doc correspondente em `docs/`).
**Ao concluir uma tarefa**, marque o checkbox e registre o progresso no mesmo commit —
o protocolo completo (legenda de status, Definition of Done, matriz de requisitos) está
no topo do próprio `plan/ROADMAP.md`. Mantê-lo sincronizado com o código é obrigatório.

## O que é este projeto

Jogo web multijogador de leilão de caixas misteriosas em tempo real. É o **Trabalho
Final da disciplina Software Concorrente e Distribuído (SCD)**. O objetivo acadêmico
é **demonstrar conceitos de sistemas distribuídos e programação concorrente** — não é
um produto comercial. Portanto, ao implementar, **preserve e torne visíveis** os
mecanismos de concorrência/distribuição; nunca os esconda atrás de abstrações que
"simplificam demais".

## Requisitos que NÃO podem ser quebrados

O sistema **precisa** demonstrar (ver `docs/05-requisitos-distribuidos.md`):

1. Serviço acessível a múltiplos clientes na Internet.
2. Vários componentes distribuídos, integrados e coordenados (implementados por nós).
3. Acessos concorrentes a recursos/dados compartilhados (caixas, saldo, inventário, mercado).
4. Processamento no servidor concorrente com os acessos dos clientes (RNG, mercado, sets).
5. Interação remota **síncrona (bloqueante)** E **assíncrona**.
6. **Replicação** E **particionamento** de dados/funcionalidades.
7. Tratamento de **consistência** e **disponibilidade**.
8. **Mais de uma linguagem** (TypeScript, Java, Python) e **mais de um paradigma**
   (cliente-servidor, pub-sub, messaging).
9. Deploy demonstrável em **AWS EC2**.

Se uma mudança for conveniente mas violar algum item acima, **pare e sinalize** em vez
de prosseguir.

## Stack e fronteiras dos serviços

- `services/frontend` — **React + TypeScript**. Canvas/HTML para o leilão. Fala com o
  gateway por WebSocket (estado em tempo real) e REST (ações pontuais).
- `services/gateway` — **Node.js + TypeScript**. Mantém as conexões WebSocket, faz
  fan-out assíncrono (Redis Pub/Sub) e encaminha ações como **gRPC síncrono** para o core.
- `services/auction` — **Java (Maven + gRPC)**. Núcleo concorrente: lances atômicos, timers
  por caixa (anti-sniping), sorteio (RNG) da abertura. Estado quente em Redis; eventos para RabbitMQ.
- `services/wallet` — **Java (Maven + gRPC)**. Carteira e inventário com **consistência forte**
  (transações Postgres + lock distribuído Redlock). Particionado por jogador.
- `services/worker` — **Python**. Background: engine de preços de mercado, avaliação de
  coleções, reconciliação de saldos, eventos de manutenção. Consome filas RabbitMQ.
- `infra` — Docker Compose, scripts de deploy AWS, configuração de Redis/RabbitMQ/Postgres.

## Convenções

- **Idioma:** documentação e comentários de domínio em **português**; identificadores
  de código em **inglês** (`placeBid`, `openBox`, `walletBalance`).
- **Contratos primeiro:** ao mexer em comunicação entre serviços, atualize os `.proto`
  e os esquemas de eventos em `docs/07-contratos-api.md` ANTES da implementação.
- **Concorrência explícita:** prefira primitivas claras (`synchronized`/`ReentrantLock`,
  `java.util.concurrent`, transações SQL, Redlock) a magia de framework. Comente a invariante
  que cada lock protege.
- **Determinismo de testes:** o RNG da abertura de caixas deve aceitar *seed* injetável
  para testes reproduzíveis.
- **Nada de segredos no repo:** use `.env` (ver `.env.example`); nunca commite chaves AWS.

## Invariantes de negócio que o código deve garantir

(ver `docs/03-regras-de-negocio.md` para os detalhes)

- O saldo de um jogador **nunca** fica negativo, mesmo com lances concorrentes em vaults
  diferentes (reservas atômicas).
- Um item **não** pode ser vendido e usado em coleção ao mesmo tempo (consistência de inventário).
- O **último lance válido antes do timer zerar** vence a caixa — desempate por timestamp
  do servidor, não do cliente.
- Probabilidades exibidas = probabilidades reais aplicadas, e a soma das probabilidades de
  uma caixa é sempre 100%.

## Fluxo de trabalho sugerido

1. Consulte [`plan/ROADMAP.md`](plan/ROADMAP.md) para o estado atual e a próxima tarefa; marque-a `[~]`.
2. Leia o doc relevante em `docs/`.
3. Para uma feature, comece pelo contrato (proto/evento) e pelo modelo de dados.
4. Implemente o serviço dono do dado; exponha via gRPC/REST; emita eventos.
5. Escreva teste de concorrência (corrida de lances, saldo compartilhado) quando aplicável.
6. Atualize o doc correspondente se o comportamento mudar.
7. Marque a tarefa `[x]` em `plan/ROADMAP.md` e adicione uma linha ao registro de progresso.

## Comandos úteis

```bash
cd infra && docker compose up --build      # sobe tudo localmente
cd services/auction && mvn test             # testes do core (Java)
cd services/frontend && npm run dev         # frontend em modo dev
```
