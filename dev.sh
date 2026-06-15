#!/usr/bin/env bash
#
# dev.sh — atalho para o ambiente de desenvolvimento local do Hammer Price.
#
# Sobe os 5 serviços + Redis/RabbitMQ/Postgres via Docker Compose (profile `local`),
# cuidando das chatices: garante o Docker no ar e escolhe uma porta livre para o
# Postgres (PG_PORT) quando a 5432 já estiver ocupada.
#
# Uso:
#   ./dev.sh            # = up (build + sobe + segue os logs; Ctrl+C derruba)
#   ./dev.sh up         # idem
#   ./dev.sh start      # sobe em background (detached)
#   ./dev.sh down       # derruba tudo
#   ./dev.sh reset      # derruba e APAGA o volume do Postgres (zera o schema)
#   ./dev.sh ps         # status dos containers
#   ./dev.sh logs [svc] # segue os logs (de todos ou de um serviço)
#   ./dev.sh test       # roda o test-slice.mjs ponta a ponta no container do gateway
#   ./dev.sh doctor     # checa Docker e mostra a PG_PORT que seria usada
#
# Override: defina PG_PORT no ambiente (ou em infra/.env) para fixar a porta.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$ROOT/infra"
PROFILE="local"
cd "$INFRA"

dc() { docker compose --profile "$PROFILE" "$@"; }

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

ensure_docker() {
  if docker info >/dev/null 2>&1; then return 0; fi
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "→ Docker não está no ar; iniciando o Docker Desktop…"
    open -a Docker 2>/dev/null || true
    for _ in $(seq 1 60); do
      docker info >/dev/null 2>&1 && { echo "→ Docker pronto."; return 0; }
      sleep 2
    done
  fi
  echo "✗ Docker daemon indisponível. Inicie o Docker e tente de novo." >&2
  exit 1
}

# Escolhe PG_PORT livre (a partir da 5432) se o usuário não tiver fixado uma.
pick_pg_port() {
  if [[ -n "${PG_PORT:-}" ]]; then
    echo "→ PG_PORT=$PG_PORT (definida pelo ambiente)"
    return 0
  fi
  local p=5432
  while port_in_use "$p"; do
    echo "→ porta $p ocupada; tentando $((p + 1))…"
    p=$((p + 1))
  done
  export PG_PORT="$p"
  echo "→ PG_PORT=$PG_PORT (porta livre escolhida)"
}

urls() {
  echo "   Game:     http://localhost:5173"
  echo "   Gateway:  ws://localhost:8080"
  echo "   RabbitMQ: http://localhost:15672 (guest/guest)"
  echo "   Postgres: localhost:${PG_PORT:-5432}"
}

cmd="${1:-up}"
[[ $# -gt 0 ]] && shift || true

case "$cmd" in
  up)
    ensure_docker; pick_pg_port
    echo "→ subindo (build + foreground). Ctrl+C derruba."; urls
    dc up --build
    ;;
  start)
    ensure_docker; pick_pg_port
    dc up --build -d
    echo "→ no ar (background). Use './dev.sh logs' ou './dev.sh down'."; urls
    ;;
  down)  ensure_docker; dc down ;;
  reset) ensure_docker; dc down -v; echo "→ containers e volume do Postgres removidos." ;;
  ps)    ensure_docker; dc ps ;;
  logs)  ensure_docker; dc logs -f "$@" ;;
  test)  ensure_docker; dc exec -T gateway node test-slice.mjs ;;
  doctor)
    ensure_docker
    echo "✓ Docker no ar."
    pick_pg_port
    echo "✓ Tudo pronto para './dev.sh up'."
    ;;
  -h|--help|help)
    cat <<'EOF'
dev.sh — ambiente de desenvolvimento local do Hammer Price.

  ./dev.sh            up (build + sobe + segue os logs; Ctrl+C derruba)
  ./dev.sh up         idem
  ./dev.sh start      sobe em background (detached)
  ./dev.sh down       derruba tudo
  ./dev.sh reset      derruba e APAGA o volume do Postgres (zera o schema)
  ./dev.sh ps         status dos containers
  ./dev.sh logs [svc] segue os logs (de todos ou de um serviço)
  ./dev.sh test       roda o test-slice.mjs ponta a ponta no gateway
  ./dev.sh doctor     checa Docker e mostra a PG_PORT que seria usada

Override: defina PG_PORT no ambiente (ou em infra/.env) para fixar a porta.
EOF
    ;;
  *)
    echo "Comando desconhecido: $cmd. Use './dev.sh help'." >&2
    exit 1
    ;;
esac
