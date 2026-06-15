# Gateway de tempo-real (Node + TypeScript, executado via tsx).
# Contexto de build = RAIZ do repositório: o gateway carrega os .proto em runtime
# a partir de ../../../proto (relativo a services/gateway/src), então proto/ precisa
# existir como irmão de services/gateway dentro da imagem.
FROM node:22-alpine
WORKDIR /app

# Dependências primeiro (camada cacheável)
COPY services/gateway/package.json services/gateway/package-lock.json ./services/gateway/
WORKDIR /app/services/gateway
RUN npm ci

# Código + contratos
WORKDIR /app
COPY proto ./proto
COPY services/gateway ./services/gateway

WORKDIR /app/services/gateway
ENV GATEWAY_PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
