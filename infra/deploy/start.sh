#!/usr/bin/env bash
#
# start.sh — sobe o stack do Hammer Price NA EC2 (executar dentro da instância).
#
# Faz a única coisa que difere do `docker compose up` local: descobre o DNS PÚBLICO
# da instância (via IMDSv2) e injeta VITE_GATEWAY_URL=ws://<dns>:8080, para o navegador
# do jogador — que roda fora da AWS — conseguir abrir o WebSocket do gateway. Sem isso
# o frontend tentaria ws://localhost:8080 e o leilão "não conectaria".
#
# Uso (na EC2, após clonar o repo):
#   ./infra/deploy/start.sh            # build + sobe em background
#   ./infra/deploy/start.sh down       # derruba
#   ./infra/deploy/start.sh logs [svc] # acompanha os logs
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

PUBLIC_HOST="$(imds public-hostname)"
[[ -z "$PUBLIC_HOST" ]] && PUBLIC_HOST="$(imds public-ipv4)"
[[ -z "$PUBLIC_HOST" ]] && PUBLIC_HOST="localhost"   # fallback (ex.: rodando fora da AWS)
export VITE_GATEWAY_URL="ws://${PUBLIC_HOST}:8080"
export VITE_PUBLIC_URL="http://${PUBLIC_HOST}:5173"   # base p/ as meta tags Open Graph (preview no WhatsApp)

dc() { docker compose --profile local "$@"; }

cmd="${1:-up}"
[[ $# -gt 0 ]] && shift || true

case "$cmd" in
  up)
    echo "→ VITE_GATEWAY_URL=$VITE_GATEWAY_URL"
    echo "→ subindo o stack (build na primeira vez pode levar alguns minutos)…"
    dc up --build -d
    echo
    echo "✓ No ar. Compartilhe com os jogadores:"
    echo "   Game (frontend): http://${PUBLIC_HOST}:5173"
    echo "   Gateway (WS):    ws://${PUBLIC_HOST}:8080"
    echo "   RabbitMQ admin:  http://${PUBLIC_HOST}:15672  (se a porta estiver liberada)"
    echo "→ Logs: ./infra/deploy/start.sh logs   ·   Derrubar: ./infra/deploy/start.sh down"
    ;;
  down)  dc down ;;
  logs)  dc logs -f "$@" ;;
  ps)    dc ps ;;
  *) echo "Comando desconhecido: $cmd (use: up | down | logs | ps)" >&2; exit 1 ;;
esac
