#!/usr/bin/env bash
#
# start.sh — sobe o stack do Hammer Price NA EC2 (executar dentro da instância).
#
# DOIS modos:
#   • SEM domínio (padrão): descobre o IP/DNS público da instância (IMDSv2) e injeta
#     VITE_GATEWAY_URL=ws://<host>:8080. Joga-se em http://<host>:5173 (frontend Vite).
#   • COM domínio (HTTPS): defina DOMAIN. Sobe o perfil `prod` (Caddy) com HTTPS automático
#     (Let's Encrypt) servindo o build ESTÁTICO e fazendo proxy do WebSocket em wss://<dominio>/ws.
#     Requer: o domínio apontando (A record) para esta instância e as portas 80/443 abertas.
#
# Uso (na EC2, após clonar o repo):
#   ./infra/deploy/start.sh                          # simples (IP público, http)
#   DOMAIN=seu-dominio.com ./infra/deploy/start.sh   # com domínio + HTTPS (Caddy)
#   [DOMAIN=…] ./infra/deploy/start.sh down|logs|ps
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/infra"

# DNS público da instância via IMDSv2 (token obrigatório no AL2023).
imds() {
  local token
  token="$(curl -sX PUT "http://169.254.169.254/latest/api/token" \
            -H "X-aws-ec2-metadata-token-ttl-seconds: 300" 2>/dev/null || true)"
  curl -s -H "X-aws-ec2-metadata-token: $token" \
    "http://169.254.169.254/latest/meta-data/$1" 2>/dev/null || true
}

if [[ -n "${DOMAIN:-}" ]]; then
  # Produção com domínio + HTTPS (perfil `prod`: Caddy serve estático + proxy do /ws).
  # Aceita só o host: remove esquema (http/https) e qualquer caminho, se vierem por engano.
  DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
  export DOMAIN
  export VITE_GATEWAY_URL="wss://${DOMAIN}/ws"
  export VITE_PUBLIC_URL="https://${DOMAIN}"
  PROFILE="prod"
  PUBLIC_URL="https://${DOMAIN}"
else
  # Simples: IP/DNS público da instância (perfil `local`: frontend Vite em :5173).
  PUBLIC_HOST="$(imds public-hostname)"
  [[ -z "$PUBLIC_HOST" ]] && PUBLIC_HOST="$(imds public-ipv4)"
  [[ -z "$PUBLIC_HOST" ]] && PUBLIC_HOST="localhost"   # fallback (ex.: rodando fora da AWS)
  export VITE_GATEWAY_URL="ws://${PUBLIC_HOST}:8080"
  export VITE_PUBLIC_URL="http://${PUBLIC_HOST}:5173"   # base p/ as meta tags Open Graph (WhatsApp)
  PROFILE="local"
  PUBLIC_URL="http://${PUBLIC_HOST}:5173"
fi

dc() { docker compose --profile "$PROFILE" "$@"; }

cmd="${1:-up}"
[[ $# -gt 0 ]] && shift || true

case "$cmd" in
  up)
    echo "→ perfil=$PROFILE  ·  VITE_GATEWAY_URL=$VITE_GATEWAY_URL"
    echo "→ subindo o stack (build na primeira vez pode levar alguns minutos)…"
    dc up --build -d
    echo
    if [[ -n "${DOMAIN:-}" ]]; then
      echo "✓ No ar (HTTPS): ${PUBLIC_URL}"
      echo "   O Caddy emite o certificado no 1º acesso (~30s). Precisa das portas 80 e 443"
      echo "   abertas e do domínio apontando para esta instância."
    else
      echo "✓ No ar. Compartilhe com os jogadores:"
      echo "   Game (frontend): ${PUBLIC_URL}"
      echo "   Gateway (WS):    $VITE_GATEWAY_URL"
    fi
    echo "→ Logs: [DOMAIN=…] ./infra/deploy/start.sh logs   ·   Derrubar: … down"
    ;;
  down)  dc down ;;
  logs)  dc logs -f "$@" ;;
  ps)    dc ps ;;
  *) echo "Comando desconhecido: $cmd (use: up | down | logs | ps)" >&2; exit 1 ;;
esac
