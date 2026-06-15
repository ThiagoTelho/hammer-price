# Serviço de Leilão (Java + gRPC).
# IMPORTANTE: o contexto de build é a RAIZ do repositório (ver docker-compose.yml),
# porque o pom gera os stubs a partir de ../../proto (fonte única dos contratos).

# ---- Etapa de build: compila e empacota o fat jar ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
# proto/ precisa ficar como irmão de services/auction (o pom referencia ../../proto)
COPY proto ./proto
COPY services/auction/pom.xml ./services/auction/pom.xml
WORKDIR /app/services/auction
# Baixa dependências primeiro (camada cacheável enquanto o pom não muda)
RUN mvn -q -e -DskipTests dependency:go-offline || true
COPY services/auction/src ./src
RUN mvn -q -DskipTests package

# ---- Etapa de runtime: só o JRE + o jar ----
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /app/services/auction/target/auction-0.1.0.jar ./auction.jar
ENV AUCTION_ADDR=50051
EXPOSE 50051
ENTRYPOINT ["java", "-jar", "auction.jar"]
