#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PID=""
BROWSER_PID=""

cleanup() {
  trap - INT TERM EXIT
  [[ -n "$BROWSER_PID" ]] && kill "$BROWSER_PID" 2>/dev/null || true
  [[ -n "$SERVER_PID" ]] && kill -TERM -- "-$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Run the existing development services in their own process group for clean shutdown.
setsid "$ROOT_DIR/dev.sh" &
SERVER_PID=$!

URL="http://127.0.0.1:5173"
for _ in $(seq 1 60); do
  if curl --silent --fail "$URL" >/dev/null; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Chess Tutor services failed to start. Check the dependencies and try again." >&2
    exit 1
  fi
  sleep 1
done
if ! curl --silent --fail "$URL" >/dev/null; then
  echo "Chess Tutor did not become ready at $URL." >&2
  exit 1
fi

# Prefer a standalone Chromium window; otherwise open in the user's default browser.
BROWSER=""
for candidate in chromium chromium-browser google-chrome; do
  if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$(command -v "$candidate")"; break; fi
done
if [[ -n "$BROWSER" ]]; then
  "$BROWSER" --app="$URL" --class=ChessTutor --name="Chess Tutor" &
  BROWSER_PID=$!
  wait "$BROWSER_PID" || true
else
  xdg-open "$URL"
  echo "Chess Tutor is running at $URL. Close this terminal to stop it."
  wait "$SERVER_PID"
fi
