# Frontend (React + Vite) — servidor de desenvolvimento com HMR.
# Em produção vira build estático (S3 + CloudFront); ver docs/08-deploy-aws.md.
# Contexto de build = RAIZ do repositório (uniforme com os demais serviços).
FROM node:22-alpine
WORKDIR /app/services/frontend

COPY services/frontend/package.json services/frontend/package-lock.json ./
RUN npm ci

COPY services/frontend ./
ENV VITE_GATEWAY_URL=ws://localhost:8080
# Base pública p/ as meta tags Open Graph (og.png). Sobreposto no deploy (start.sh).
ENV VITE_PUBLIC_URL=http://localhost:5173
EXPOSE 5173
# --host 0.0.0.0 para o dev server ser acessível de fora do container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
