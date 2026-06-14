# Serviço de Leilão (auction) — Java (Maven + gRPC)

Núcleo concorrente do Hammer Price. **Particionado por vault**: cada instância é dona de
um subconjunto de caixas.

## Responsabilidades
- Lances **atômicos** por caixa (`ReentrantLock` por caixa).
- Cronômetros por caixa com **anti-sniping** (etapa posterior).
- **RNG** de abertura server-side, com seed injetável (etapa posterior).
- Reservar saldo via gRPC à **Carteira** antes de aceitar lance.
- Publicar eventos (`bid.placed`, `box.sold`, `box.opened`) em Redis Pub/Sub e RabbitMQ
  (etapa posterior).

## Invariantes (ver docs/03-regras-de-negocio.md)
- Vencedor = último lance válido antes do timer zerar (desempate por timestamp do servidor).
- `Σ P_efetiva = 1` na abertura; nenhuma probabilidade negativa.

## Estrutura
```
auction/
  pom.xml                 # build Maven + protobuf-maven-plugin (gera stubs gRPC)
  src/main/java/br/ufg/hammerprice/auction/
    AuctionServer.java    # servidor gRPC + cliente gRPC da Carteira
    BoxStore.java         # estado e lance atômico das caixas (lock por caixa)
```
Os stubs gRPC são gerados em `target/generated-sources` a partir de `../../proto`.

## Comandos
```bash
mvn -q -DskipTests package                          # gera o fat jar
WALLET_GRPC=localhost:50052 java -jar target/auction-0.1.0.jar
# ou, em desenvolvimento:
mvn -q compile exec:java -Dexec.mainClass=br.ufg.hammerprice.auction.AuctionServer
```
