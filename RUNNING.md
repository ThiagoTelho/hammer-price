# Executando a fatia vertical (local)

Esta é a **fatia vertical** do Hammer Price: um lance percorre
`frontend (React) → gateway (Node) → leilão (Go) → carteira (Go)`.

> Estado em memória (sem Postgres/Redis/RabbitMQ ainda). O objetivo é ter o caminho
> ponta a ponta funcionando; as camadas de persistência, Pub/Sub, mensageria,
> particionamento por vault e RNG de abertura entram nas próximas etapas.

## Pré-requisitos
- Go 1.26+
- Node 20+ (testado no 26)
- `protoc` **não é necessário** para rodar (o código gerado já está versionado em
  `proto/gen/go`). Só é preciso para regenerar os contratos.

## Subir os serviços (4 terminais)

```bash
# 1) Carteira (gRPC :50052)
cd services/wallet && WALLET_ADDR=:50052 go run ./cmd/server

# 2) Leilão (gRPC :50051, fala com a carteira)
cd services/auction && AUCTION_ADDR=:50051 WALLET_GRPC=localhost:50052 go run ./cmd/server

# 3) Gateway (WebSocket :8080, fala com o leilão)
cd services/gateway && npm install && AUCTION_GRPC=localhost:50051 npm start

# 4) Frontend (http://localhost:5173)
cd services/frontend && npm install && npm run dev
```

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

## Regenerar os contratos gRPC (opcional)

Só se você alterar os `.proto`:

```bash
# instalar plugins uma vez
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
export PATH="$PATH:$(go env GOPATH)/bin"

# gerar
protoc --proto_path=proto \
  --go_out=. --go_opt=module=github.com/ThiagoTelho/hammer-price \
  --go-grpc_out=. --go-grpc_opt=module=github.com/ThiagoTelho/hammer-price \
  proto/auction.proto proto/wallet.proto
```
