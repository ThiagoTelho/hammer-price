# Serviço de Carteira / Inventário (wallet) — Go

Guardião da **consistência forte**. **Particionado por jogador** (shard por `playerId`).

## Responsabilidades
- Saldo, reservas, inventário, afinidade e coleções.
- `Reserve` / `Release` / `Settle` de saldo; `AddItem` / `SellItem` / `BurnItem`.
- Toda operação de dinheiro serializada por **Redlock(playerId) + transação Postgres**.
- Registrar tudo no **ledger** (base da reconciliação).

## Invariantes
- `balance - reserved >= 0` sempre (nunca saldo negativo, mesmo com lances concorrentes
  em vaults diferentes).
- Um item em **exatamente um** estado: `FREE` | `LOCKED_COLLECTION` | `CONSUMED`.
- `afinidade(player, type) <= teto`.

## Estrutura sugerida
```
wallet/
  cmd/server/main.go
  internal/wallet/     # reserve/release/settle sob lock
  internal/inventory/  # estados de item, sell/burn
  internal/ledger/     # append-only
  internal/grpc/
  proto/               # wallet.proto (ver docs/07)
```

## Comandos
```bash
go test ./...        # testes de concorrência da reserva
go run ./cmd/server
```
