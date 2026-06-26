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

echo "user-data: Docker $(docker --version) + $(docker compose version) prontos."
