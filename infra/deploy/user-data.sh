#!/bin/bash
# user-data — bootstrap de uma EC2 Amazon Linux 2023 para rodar o Hammer Price.
#
# Roda UMA vez, no primeiro boot da instância (passado via --user-data no provision.sh).
# Instala Docker + o plugin `docker compose` v2 (a mesma forma usada no dev.sh e no
# docker-compose.yml). NÃO clona o repo nem sobe o stack: o repositório é privado
# (GitHub Classroom), então o clone + `start.sh` ficam como passos manuais no DEPLOY.md
# para não embutir segredos (token do GitHub) aqui.
#
# Log deste script no boot: /var/log/cloud-init-output.log
set -xe

dnf update -y
dnf install -y docker git

systemctl enable --now docker
usermod -aG docker ec2-user   # permite `docker` sem sudo após reconectar o SSH

# Plugin `docker compose` v2 (o pacote docker do AL2023 não o traz embutido).
# Instala como cli-plugin para TODOS os usuários → habilita a sintaxe `docker compose`.
mkdir -p /usr/libexec/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

# Plugin `buildx` (BuildKit): o `docker compose --build` v2 exige buildx >= 0.17, e o
# AL2023 não traz uma versão compatível → instala o release mais recente como cli-plugin.
# (Sem isso: "compose build requires buildx 0.17.0 or later".)
BUILDX_VER="$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+')"
BUILDX_VER="${BUILDX_VER:-v0.19.3}"   # fallback caso a API do GitHub falhe/limite
curl -SL "https://github.com/docker/buildx/releases/download/${BUILDX_VER}/buildx-${BUILDX_VER}.linux-amd64" \
  -o /usr/libexec/docker/cli-plugins/docker-buildx
chmod +x /usr/libexec/docker/cli-plugins/docker-buildx

echo "user-data: Docker $(docker --version) + $(docker compose version) + $(docker buildx version) prontos."
