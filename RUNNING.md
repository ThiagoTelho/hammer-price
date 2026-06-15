# Executando localmente

Um lance percorre `frontend (React) → gateway (Node) → leilão (Java) → carteira (Java)`.

Há dois jeitos de subir: **Docker Compose** (recomendado — sobe tudo, incluindo Redis,
RabbitMQ e Postgres) ou **4 terminais** sem Docker (backend Java/Node à mão).

> O leilão e a carteira ainda mantêm estado **em memória**; Redis/RabbitMQ/Postgres já
> sobem e o schema é aplicado, mas o wiring de persistência, Pub/Sub e mensageria entra
> nas Fases 2–5 (ver [`plan/ROADMAP.md`](plan/ROADMAP.md)).

## Opção A — Docker Compose (recomendado)

Pré-requisito: Docker Desktop. O jeito mais fácil é o script `dev.sh` (raiz do repo),
que garante o Docker no ar e escolhe uma **porta livre para o Postgres** se a 5432
estiver ocupada:

```bash
./dev.sh            # build + sobe + segue os logs (Ctrl+C derruba)
./dev.sh start      # sobe em background
./dev.sh ps         # status        ./dev.sh logs [svc]   # logs
./dev.sh test       # roda o test-slice.mjs ponta a ponta
./dev.sh down       # derruba        ./dev.sh reset        # derruba + zera o Postgres
./dev.sh doctor     # checa Docker e mostra a PG_PORT que será usada
```

Ou, equivalente, direto pelo compose a partir de `infra/`:

```bash
cd infra
docker compose --profile local up --build
```

Sobe os 5 serviços + Redis + RabbitMQ + Postgres (com o schema de
[`db/init`](infra/db/init/) aplicado na primeira subida). Os parâmetros de jogo são
lidos de [`config/balance.yaml`](infra/config/balance.yaml), montado nos containers.

- Frontend: http://localhost:5173 · Gateway: ws://localhost:8080
- Console RabbitMQ: http://localhost:15672 (guest/guest) · Postgres: `localhost:5432`
- Para overrides de credenciais/portas: `cp ../.env.example .env` e ajuste antes de subir.
- Derrubar tudo: `docker compose --profile local down` (use `-v` para zerar o volume do Postgres).

## Opção B — 4 terminais, sem Docker

## Pré-requisitos
- Java 21+ (testado no Temurin 21)
- Maven 3.9+
- Node 20+ (testado no 26)
- `protoc` **não é necessário**: o `protobuf-maven-plugin` baixa o `protoc` e o plugin
  gRPC automaticamente e gera os stubs a partir dos `.proto` em `proto/`.

## Build dos serviços Java

```bash
cd services/wallet && mvn -q -DskipTests package
cd services/auction && mvn -q -DskipTests package
```

Cada build gera um *fat jar* executável em `target/<serviço>-0.1.0.jar`.

## Subir os serviços (4 terminais)

```bash
# 1) Carteira (gRPC :50052)
java -jar services/wallet/target/wallet-0.1.0.jar
# (ou, sem empacotar: cd services/wallet && mvn -q compile exec:java)

# 2) Leilão (gRPC :50051, fala com a carteira)
WALLET_GRPC=localhost:50052 java -jar services/auction/target/auction-0.1.0.jar

# 3) Gateway (WebSocket :8080, fala com o leilão)
cd services/gateway && npm install && AUCTION_GRPC=localhost:50051 npm start

# 4) Frontend (http://localhost:5173)
cd services/frontend && npm install && npm run dev
```

Variáveis aceitas: `WALLET_ADDR` (padrão `:50052`), `AUCTION_ADDR` (padrão `:50051`),
`WALLET_GRPC` (padrão `localhost:50052`), `GATEWAY_PORT` (padrão `8080`),
`AUCTION_GRPC` (padrão `localhost:50051`).

Abra **http://localhost:5173** em duas abas/navegadores, entre com nomes diferentes
(ex.: `ana` e `bob`) e dê lances — os eventos aparecem para todos em tempo real.

## Teste automatizado da fatia

Com os 3 serviços de backend no ar:

```bash
cd services/gateway && node test-slice.mjs
```

Exercita: lance válido (confirmação síncrona + broadcast assíncrono), superar lance
(devolve a reserva do anterior), lance baixo, saldo insuficiente e — o ponto-chave —
**reservas em caixas diferentes somando o orçamento**, provando que o saldo
compartilhado nunca fica negativo.

## Contratos gRPC

Os `.proto` ficam em `proto/` (fonte única). Os serviços Java geram os stubs em tempo de
build (via `protobuf-maven-plugin`), e o gateway Node carrega os `.proto` em runtime
(`@grpc/proto-loader`) — não há código gerado versionado a manter.
