# 08 — Deploy na AWS (EC2)

> O enunciado exige: **"Executar a demonstração utilizando a nuvem do AWS (EC2)."**
> Portanto, a **demonstração avaliada roda na AWS**. Este documento descreve a topologia
> e o passo a passo mais simples e barato que atende ao requisito.

## Importante: AWS vs. Vercel

A ideia de publicar o frontend na **Vercel** é ótima para conveniência, **mas não
substitui** a exigência de AWS. Estratégia adotada:

- **Backend (obrigatório na AWS):** gateway, Leilão, Carteira, Worker, Redis, RabbitMQ,
  Postgres rodam em **EC2**. É isso que a disciplina avalia.
- **Frontend (estático):** o build do React pode ser servido de duas formas — escolha uma:
  - **S3 + CloudFront** (recomendado: 100% AWS, barato, casa com o domínio próprio); ou
  - **Vercel** apenas como cópia de conveniência/landing, apontando para a API na AWS.
- Para o **vídeo da entrega**, grave contra os endpoints **da AWS**, para não haver dúvida
  quanto ao requisito.

## Topologia recomendada (barata, demonstra distribuição)

Mínimo viável que ainda mostra **particionamento e replicação entre máquinas**:

```
┌────────────────────────── AWS ──────────────────────────┐
│                                                          │
│  EC2-A (t3.small)            EC2-B (t3.small)            │
│  ┌────────────────┐          ┌────────────────┐         │
│  │ Gateway (Node) │          │ Leilão vault-2 │         │
│  │ Leilão vault-1 │          │ Carteira shard2│         │
│  │ Carteira shard1│          │ Worker (Python)│         │
│  │ Redis          │          │ Postgres RÉPLICA│        │
│  │ RabbitMQ       │          └────────────────┘         │
│  │ Postgres PRIMARY│                                     │
│  └────────────────┘                                      │
│                                                          │
│  S3 + CloudFront  ──►  frontend estático (React build)   │
│  Route 53 / DNS   ──►  domínio próprio                   │
└──────────────────────────────────────────────────────────┘
```

- **2 instâncias** já bastam para demonstrar componentes em máquinas diferentes,
  particionamento (vault-1 vs vault-2; shard1 vs shard2) e replicação (primary na A,
  réplica na B). Uma **3ª instância** (opcional) deixa a separação mais clara.
- Tipos `t3.small`/`t3.micro` mantêm o custo baixo; **desligar as instâncias** fora dos
  testes evita cobrança. Há crédito educacional via **AWS Academy/Educate** se disponível.

## Pré-requisitos

- Conta AWS (ou AWS Academy).
- Chave SSH (`.pem`) para acesso às instâncias.
- Docker e Docker Compose instalados nas instâncias (via `user-data` na criação).
- Imagens dos serviços publicadas (GitHub Container Registry ou build na própria instância).

## Passo a passo

### 1. Provisionar as instâncias
- Criar 2 EC2 Amazon Linux 2023 (`t3.small`).
- **Security Group:** liberar 22 (SSH, só seu IP), 80/443 (frontend/API), e as portas
  internas entre as instâncias (gRPC, Redis, RabbitMQ, Postgres) **restritas ao SG**
  (não expor ao mundo).
- `user-data` para instalar Docker:
  ```bash
  #!/bin/bash
  dnf update -y && dnf install -y docker git
  systemctl enable --now docker
  usermod -aG docker ec2-user
  curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
    -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose
  ```

### 2. Configurar variáveis de rede
- Use os **IPs privados** das instâncias para a comunicação interna (gRPC, Redis,
  RabbitMQ, replicação Postgres). Centralize em `.env` por instância (ver `.env.example`).

### 3. Subir os serviços
Em cada instância, clonar o repo e subir o compose com o **perfil** daquela máquina:
```bash
git clone <repo> && cd hammer-price/infra
# EC2-A
docker compose --profile node-a up -d
# EC2-B
docker compose --profile node-b up -d
```
> Os perfis (`node-a`, `node-b`) selecionam quais serviços sobem em cada máquina — ver
> `infra/docker-compose.yml`.

### 4. Replicação do Postgres
- Configurar **streaming replication**: primary na EC2-A, réplica (read-only) na EC2-B.
- O serviço de leitura (ranking/histórico) aponta para a réplica; escritas vão ao primary.

### 5. Frontend
- `npm run build` no `services/frontend`.
- Subir o conteúdo de `dist/` para um **bucket S3**; servir via **CloudFront**.
- Configurar o **domínio próprio** no Route 53 (ou no provedor de DNS) apontando para o
  CloudFront; e um subdomínio (ex.: `api.seudominio`) apontando para o gateway na EC2.

### 6. Verificação
- Acessar o frontend pelo domínio; abrir uma sala de vários dispositivos.
- Conferir o roteiro de demonstração em [05 — Requisitos Distribuídos](05-requisitos-distribuidos.md).

## Custos e higiene

- **Desligue (stop) as instâncias** quando não estiver testando — você paga por hora ligada.
- `t3.micro` pode estar no **free tier**; `t3.small` é barato mas não gratuito.
- Apague S3/CloudFront/Route 53 ao final, se não forem reaproveitados.
- **Nunca** comite credenciais AWS no repositório (ver `.gitignore` e `.env.example`).

## Domínio próprio

O grupo já possui um domínio para o **Hammer Price**. Plano:
- `seudominio.com` → CloudFront (frontend).
- `api.seudominio.com` → gateway na EC2 (com TLS via ACM/CloudFront ou Caddy/Nginx na EC2).

## Alternativa ainda mais simples (se 2 EC2 forem demais)
Rodar **tudo em uma única EC2** via Docker Compose, com **múltiplas réplicas de container**
para vault-1/vault-2 e shard1/shard2 e uma réplica de Postgres em container. Atende
formalmente "rodar em EC2" e demonstra particionamento/replicação **entre processos**,
porém é menos convincente que entre máquinas. Use só se o tempo apertar.
