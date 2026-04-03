#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_PATH="${1:-.}"
PORT="${2:-8080}"

echo "=== codesight ==="
echo ""

# Run analysis (pass through remaining args for --llm etc.)
shift 2>/dev/null || true
node "$SCRIPT_DIR/analyze.mjs" "$PROJECT_PATH" "$@"

# Kill any existing server on the port
lsof -ti :"$PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true

# Start server
echo ""
echo "Starting server on http://localhost:$PORT"
cd "$SCRIPT_DIR"
node serve.mjs "$PORT" &
SERVER_PID=$!
echo "$SERVER_PID" > "$SCRIPT_DIR/.server.pid"

# Open browser
if command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:$PORT" 2>/dev/null
elif command -v open &>/dev/null; then
  open "http://localhost:$PORT"
fi

echo "Server PID: $SERVER_PID (run ./stop.sh to stop)"
