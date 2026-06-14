# 🔨 Hammer Price

> Jogo web multijogador de **leilão de caixas misteriosas** em tempo real.
> Trabalho Final da disciplina **Software Concorrente e Distribuído (SCD)** — UFG, 2026.1.

Jogadores disputam, em tempo real, leilões de *mystery boxes*. Cada caixa exibe a
probabilidade de conter cada tipo de item (Cobre, Prata, Ouro, Diamante e o raro
Mímico). Os jogadores dão lances com orçamento limitado, abrem as caixas que
arremataram e decidem o que fazer com os itens: **guardar** para fechar coleções
valiosas, **vender** no mercado dinâmico, ou **queimar** para aumentar a própria
afinidade (probabilidade pessoal) por um tipo de item. Vence quem tiver o maior
patrimônio líquido ao fim da partida.

O charme do jogo é o equilíbrio **habilidade × sorte** (estilo pôquer): você aposta
com base no valor esperado, mas lê os adversários pelo histórico de lances e convive
com a aleatoriedade da abertura.

---

## 📚 Documentação

Toda a concepção do projeto está em [`docs/`](docs/):

| Documento | Conteúdo |
|---|---|
| [01 — Visão Geral](docs/01-visao-geral.md) | Objetivo, contexto da disciplina e requisitos obrigatórios |
| [02 — Regras do Jogo](docs/02-regras-do-jogo.md) | Mecânicas, loop de jogo, condição de vitória |
| [03 — Regras de Negócio](docs/03-regras-de-negocio.md) | Economia, odds, coleções, afinidade, mercado |
| [04 — Arquitetura](docs/04-arquitetura.md) | Componentes distribuídos, diagramas, paradigmas de interação |
| [05 — Requisitos Distribuídos](docs/05-requisitos-distribuidos.md) | Mapeamento de cada requisito da disciplina para o sistema |
| [06 — Planejamento](docs/06-planejamento.md) | Escopo, marcos, divisão de tarefas, roteiro da demo |
| [07 — Contratos de API](docs/07-contratos-api.md) | gRPC, REST e eventos WebSocket/fila |
| [08 — Deploy AWS](docs/08-deploy-aws.md) | Topologia EC2, passo a passo, domínio |
| [09 — Modelo de Dados](docs/09-modelo-de-dados.md) | Esquemas Postgres/Redis e invariantes |

Instruções para desenvolvimento assistido por IA: [`CLAUDE.md`](CLAUDE.md).

---

## 🏗️ Stack

| Camada | Tecnologia | Linguagem |
|---|---|---|
| Cliente web | React + HTML5 Canvas | TypeScript |
| Gateway tempo-real | Node.js + WebSocket | TypeScript |
| Serviço de Leilão (core) | Go (goroutines, mutex, RNG) | Go |
| Serviço de Carteira/Inventário | Go (consistência forte) | Go |
| Worker de background | Mercado, coleções, reconciliação | Python |
| Mensageria | RabbitMQ (eventos) + Redis Pub/Sub (broadcast) | — |
| Estado quente / locks | Redis (Redlock) | — |
| Persistência | PostgreSQL (primary + read replica) | — |
| RPC entre serviços | gRPC | — |
| Deploy | Docker Compose em AWS EC2 (2–3 instâncias) | — |

> **3 linguagens** (TypeScript, Go, Python) e **3 paradigmas** (cliente-servidor,
> pub-sub, messaging), conforme exigido pela disciplina.

---

## 🚀 Como rodar (desenvolvimento local)

> O esqueleto de cada serviço está em [`services/`](services/). O ambiente local
> completo sobe via Docker Compose:

```bash
cd infra
docker compose up --build
```

Frontend: http://localhost:5173 · Gateway: ws://localhost:8080

Detalhes de cada serviço nos respectivos `README` dentro de `services/`.

---

## ☁️ Produção

A **demonstração avaliada roda em AWS EC2** (exigência da disciplina). O passo a passo
de deploy está em [08 — Deploy AWS](docs/08-deploy-aws.md). O domínio próprio aponta
para o frontend (S3 + CloudFront) e a API (EC2).

---

## 👥 Equipe

| Integrante | Responsabilidade principal |
|---|---|
| _a definir_ | Serviço de Leilão (Go) |
| _a definir_ | Carteira + Worker (Go/Python) |
| _a definir_ | Gateway + Frontend (Node/React) |
| _a definir_ | Infra AWS + Documentação |

**Disciplina:** Software Concorrente e Distribuído — Prof. Fábio Moreira Costa
**Entrega:** 28/06/2026 · **Instituição:** Instituto de Informática — UFG
