# Serviço de Carteira/Inventário (Java + gRPC).
# Contexto de build = RAIZ do repositório (o pom gera stubs a partir de ../../proto).

# ---- Etapa de build ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY proto ./proto
COPY services/wallet/pom.xml ./services/wallet/pom.xml
WORKDIR /app/services/wallet
RUN mvn -q -e -DskipTests dependency:go-offline || true
COPY services/wallet/src ./src
RUN mvn -q -DskipTests package

# ---- Etapa de runtime ----
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /app/services/wallet/target/wallet-0.1.0.jar ./wallet.jar
ENV WALLET_ADDR=50052
EXPOSE 50052
ENTRYPOINT ["java", "-jar", "wallet.jar"]
