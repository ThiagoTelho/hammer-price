# Serviço de Leilão (auction) — Go

Núcleo concorrente do Hammer Price. **Particionado por vault**: cada instância é dona de
um subconjunto de caixas.

## Responsabilidades
- Lances **atômicos** por caixa (`sync.Mutex` ou ator/channel por caixa).
- Cronômetros por caixa com **anti-sniping**.
- **RNG** de abertura server-side (seed injetável — testes determinísticos).
- Reservar saldo via gRPC à **Carteira** antes de aceitar lance.
- Publicar eventos (`bid.placed`, `box.sold`, `box.opened`) em Redis Pub/Sub e RabbitMQ.

## Invariantes (ver docs/03-regras-de-negocio.md)
- Vencedor = último lance válido antes do timer zerar (desempate por timestamp do servidor).
- `Σ P_efetiva = 1` na abertura; nenhuma probabilidade negativa.

## Estrutura sugerida
```
auction/
  cmd/server/main.go
  internal/box/        # estado e lance atômico da caixa
  internal/timer/      # cronômetros + anti-sniping
  internal/rng/        # sorteio com seed injetável
  internal/grpc/       # handlers PlaceBid/OpenBox
  proto/               # auction.proto (ver docs/07)
```

## Comandos
```bash
go test ./...        # inclui testes de corrida de lances (go test -race)
go run ./cmd/server
```
