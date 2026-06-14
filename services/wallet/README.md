# Serviço de Carteira / Inventário (wallet) — Java (Maven + gRPC)

Guardião da **consistência forte**. **Particionado por jogador** (shard por `playerId`).

## Responsabilidades
- Saldo, reservas, inventário, afinidade e coleções.
- `Reserve` / `Release` / `GetPlayer` (fatia vertical); `Settle`, `AddItem`, `SellItem`,
  `BurnItem` em etapas posteriores.
- Toda operação de dinheiro serializada — hoje por método `synchronized`; depois por
  **Redlock(playerId) + transação Postgres**.
- Registrar tudo no **ledger** (etapa posterior).

## Invariantes
- `balance - reserved >= 0` sempre (nunca saldo negativo, mesmo com lances concorrentes
  em vaults diferentes).
- Um item em **exatamente um** estado: `FREE` | `LOCKED_COLLECTION` | `CONSUMED`.
- `afinidade(player, type) <= teto`.

## Estrutura
```
wallet/
  pom.xml                 # build Maven + protobuf-maven-plugin (gera stubs gRPC)
  src/main/java/br/ufg/hammerprice/wallet/
    WalletServer.java     # servidor gRPC
    WalletStore.java      # saldo/reservas em memória (acesso serializado)
```

## Comandos
```bash
mvn -q -DskipTests package                          # gera o fat jar
java -jar target/wallet-0.1.0.jar
# ou, em desenvolvimento:
mvn -q compile exec:java -Dexec.mainClass=br.ufg.hammerprice.wallet.WalletServer
```
