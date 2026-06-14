# Executando a fatia vertical (local)

Esta é a **fatia vertical** do Hammer Price: um lance percorre
`frontend (React) → gateway (Node) → leilão (Java) → carteira (Java)`.

> Estado em memória (sem Postgres/Redis/RabbitMQ ainda). O objetivo é ter o caminho
> ponta a ponta funcionando; as camadas de persistência, Pub/Sub, mensageria,
> particionamento por vault e RNG de abertura entram nas próximas etapas.

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
