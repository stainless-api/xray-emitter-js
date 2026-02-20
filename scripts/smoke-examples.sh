#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export STAINLESS_XRAY_ENDPOINT_URL="${STAINLESS_XRAY_ENDPOINT_URL:-http://xray:foobar@127.0.0.1:4318}"
export STAINLESS_XRAY_SPAN_PROCESSOR="${STAINLESS_XRAY_SPAN_PROCESSOR:-simple}"

LOG_DIR="$(mktemp -d)"
COLLECTOR_PID=""
COLLECTOR_LOG="$LOG_DIR/mock-collector.log"

cleanup() {
  if [[ -n "$COLLECTOR_PID" ]]; then
    kill -TERM "$COLLECTOR_PID" 2>/dev/null || true
    wait "$COLLECTOR_PID" 2>/dev/null || true
  fi
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT

start_mock_collector() {
  case "$STAINLESS_XRAY_ENDPOINT_URL" in
    http://*127.0.0.1:4318* | http://*localhost:4318*)
      node >"$COLLECTOR_LOG" 2>&1 <<'EOF' &
const http = require('node:http');

const server = http.createServer((req, res) => {
  req.on('error', () => {});
  req.resume();
  req.on('end', () => {
    res.statusCode = 200;
    res.end('ok');
  });
});

server.listen(4318, '127.0.0.1');
EOF
      COLLECTOR_PID="$!"
      sleep 0.2

      if ! kill -0 "$COLLECTOR_PID" 2>/dev/null; then
        if grep -q "EADDRINUSE" "$COLLECTOR_LOG" 2>/dev/null; then
          COLLECTOR_PID=""
        else
          echo "mock collector failed to start"
          cat "$COLLECTOR_LOG"
          exit 1
        fi
      fi
      ;;
  esac
}

stop_process_tree() {
  local pid="$1"

  pkill -INT -P "$pid" 2>/dev/null || true
  kill -INT "$pid" 2>/dev/null || true

  local attempt
  for attempt in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done

  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

run_server_example() {
  local example="$1"
  local url="$2"
  local log_file="$LOG_DIR/${example}.log"

  echo "==> smoke server: ${example}"
  pnpm --filter "./examples/${example}" start >"$log_file" 2>&1 &
  local pid="$!"

  local ready=0
  local attempt
  for attempt in $(seq 1 80); do
    if curl --silent --show-error --fail --max-time 1 "$url" >/dev/null 2>&1; then
      ready=1
      break
    fi

    if ! kill -0 "$pid" 2>/dev/null; then
      echo "example ${example} exited before becoming ready"
      cat "$log_file"
      return 1
    fi

    sleep 0.25
  done

  if [[ "$ready" -ne 1 ]]; then
    echo "timed out waiting for ${example} at ${url}"
    cat "$log_file"
    stop_process_tree "$pid"
    return 1
  fi

  stop_process_tree "$pid"
}

run_script_example() {
  local example="$1"
  local log_file="$LOG_DIR/${example}.log"

  echo "==> smoke script: ${example}"
  if ! pnpm --filter "./examples/${example}" start >"$log_file" 2>&1; then
    cat "$log_file"
    return 1
  fi
}

start_mock_collector

run_server_example "express" "http://127.0.0.1:3000/"
run_server_example "fastify" "http://127.0.0.1:3000/"
run_server_example "hono" "http://127.0.0.1:3000/"
run_server_example "node-http" "http://127.0.0.1:3000/"
run_server_example "effect" "http://127.0.0.1:3000/"

run_script_example "edge"
run_script_example "next-app"
run_script_example "remix-app"

echo "example smoke tests passed"
