#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
API_PID=""
WEB_PID=""

cleanup() {
  trap - INT TERM EXIT
  for pid in "${API_PID:-}" "${WEB_PID:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

if [[ ! -x "$ROOT_DIR/api/.venv/bin/uvicorn" ]]; then
  echo "API environment not found. From api/, run: uv sync" >&2
  exit 1
fi
if [[ ! -d "$ROOT_DIR/web/node_modules" ]]; then
  echo "Web dependencies not found. From web/, run: npm install" >&2
  exit 1
fi

(
  cd "$ROOT_DIR/api"
  exec .venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8001
) &
API_PID=$!

(
  cd "$ROOT_DIR/web"
  exec npm run dev -- --host 127.0.0.1
) &
WEB_PID=$!

echo "API: http://127.0.0.1:8001"
echo "Web: http://127.0.0.1:5173"
echo "Press Ctrl+C to stop both servers."

# Stop both servers if either process exits.
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
exit 1
