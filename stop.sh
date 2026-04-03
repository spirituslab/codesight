#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/.server.pid" ]; then
  PID=$(cat "$SCRIPT_DIR/.server.pid")
  kill "$PID" 2>/dev/null && echo "Server stopped (PID $PID)" || echo "Server not running"
  rm -f "$SCRIPT_DIR/.server.pid"
else
  echo "No server PID file found"
fi
