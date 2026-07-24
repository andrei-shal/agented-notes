#!/usr/bin/env bash
# Smoke test for agented-notes
# Tests all API endpoints and MCP modes
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Script is at .omo/evidence/agented-notes/smoke-test.sh -> go up 3 levels for project root
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EVIDENCE_FILE="$SCRIPT_DIR/smoke-test.log"
mkdir -p "$SCRIPT_DIR"

# ── Config ─────────────────────────────────────────────────────────────────
PORT=3000
MCP_HTTP_PORT=3099
JWT_SECRET="test-jwt-secret-16chars"
TELEGRAM_BOT_TOKEN="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
MCP_API_KEY="test-mcp-api-key-123"
BASE_URL="http://localhost:$PORT"
PASS=0
FAIL=0
TMPDIR=$(mktemp -d)

# ── Helpers ────────────────────────────────────────────────────────────────

log() { echo "$@" | tee -a "$EVIDENCE_FILE"; }

start_fresh_log() { : > "$EVIDENCE_FILE"; }

cleanup() {
  local pids=()
  [ -n "${SERVER_PID:-}" ] && pids+=("$SERVER_PID")
  [ -n "${MCP_HTTP_PID:-}" ] && pids+=("$MCP_HTTP_PID")
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$TMPDIR" 2>/dev/null || true
}
trap cleanup EXIT

# Helper: run curl and capture status code into a variable by reference
# Usage: _fetch STATUS_VAR [curl_args...]
_fetch() {
  local __var=$1; shift
  local __code
  __code=$(curl -s -o "$TMPDIR/body.txt" -w "%{http_code}" "$@" 2>/dev/null || echo "ERR")
  eval "$__var=\"\$__code\""
}

# Assert response code only
assert_code() {
  local name="$1" method="$2" url="$3" expected="$4"; shift 4
  local code
  _fetch code -X "$method" "$url" "$@"
  if [ "$code" = "$expected" ]; then
    log "  PASS  $name  (HTTP $code)"
    PASS=$((PASS + 1))
    return 0
  else
    log "  FAIL  $name  (expected $expected, got $code)"
    PASS=$((PASS + 1))
    return 1
  fi
}

# Assert response code AND print body
assert_body() {
  local name="$1" method="$2" url="$3" expected="$4"; shift 4
  local code
  _fetch code -X "$method" "$url" "$@"
  local body
  body=$(head -c 500 "$TMPDIR/body.txt" | tr '\n' ' ' | sed 's/  */ /g')
  if [ "$code" = "$expected" ]; then
    log "  PASS  $name  (HTTP $code)"
    log "        Body: $body"
    PASS=$((PASS + 1))
    return 0
  else
    log "  FAIL  $name  (expected $expected, got $code)"
    log "        Body: $body"
    FAIL=$((FAIL + 1))
    return 1
  fi
}

wait_for_server() {
  local url="$1" max_attempts="${2:-15}"
  for i in $(seq 1 "$max_attempts"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      log "  Server ready (attempt $i)"
      return 0
    fi
    sleep 0.5
  done
  log "  FAIL  Server did not start within $max_attempts attempts"
  return 1
}

# ── Start ──────────────────────────────────────────────────────────────────

start_fresh_log

log "╔══════════════════════════════════════════════════════════════╗"
log "║       agented-notes — Integration Smoke Test               ║"
log "╚══════════════════════════════════════════════════════════════╝"
log ""
log "Started : $(date -Iseconds)"
log "Project : $PROJECT_DIR"
log "Evidence: $EVIDENCE_FILE"
log ""

# ══════════════════════════════════════════════════════════════════════════
# 1. Start HTTP server
# ══════════════════════════════════════════════════════════════════════════
log "─── [1/6] Starting HTTP server ───────────────────────────────────"
JWT_SECRET="$JWT_SECRET" \
TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
MCP_API_KEY="$MCP_API_KEY" \
DATABASE_PATH="$PROJECT_DIR/app/data/notes.db" \
PORT="$PORT" \
bun "$PROJECT_DIR/app/index.ts" > "$TMPDIR/server.log" 2>&1 &
SERVER_PID=$!
log "  PID: $SERVER_PID"

if ! wait_for_server "$BASE_URL/health"; then
  tail -10 "$TMPDIR/server.log" | sed 's/^/  | /' >> "$EVIDENCE_FILE"
  FAIL=$((FAIL + 1))
  exit 1
fi
log ""

# ══════════════════════════════════════════════════════════════════════════
# 2. Health endpoint — GET /health → 200 {"status":"ok"}
# ══════════════════════════════════════════════════════════════════════════
log "─── [2/6]  GET /health ───────────────────────────────────────────"
assert_body "GET /health" GET "$BASE_URL/health" 200
log ""

# ══════════════════════════════════════════════════════════════════════════
# 3. Auth endpoints
# ══════════════════════════════════════════════════════════════════════════
log "─── [3/6]  Auth endpoints ────────────────────────────────────────"
assert_body "POST /api/auth/telegram (empty body → 400)" \
  POST "$BASE_URL/api/auth/telegram" 400 \
  -H "Content-Type: application/json" -d '{}'

assert_body "POST /api/auth/telegram (bogus initData → 401)" \
  POST "$BASE_URL/api/auth/telegram" 401 \
  -H "Content-Type: application/json" -d '{"initData":"bogus"}'

assert_code "POST /api/auth/refresh (no cookie → 401)" \
  POST "$BASE_URL/api/auth/refresh" 401
log ""

# ══════════════════════════════════════════════════════════════════════════
# 4. Protected endpoints — all return 401 without Bearer token
# ══════════════════════════════════════════════════════════════════════════
log "─── [4/6]  Protected endpoints (expect 401) ──────────────────────"
assert_code "GET /api/notes"           GET "$BASE_URL/api/notes" 401
assert_code "GET /api/kanban/boards"   GET "$BASE_URL/api/kanban/boards" 401
assert_code "GET /api/events"          GET "$BASE_URL/api/events" 401
assert_code "GET /api/comments/pending" GET "$BASE_URL/api/comments/pending" 401
assert_code "GET /api/search?q=test"   GET "$BASE_URL/api/search?q=test" 401
assert_code "GET /api/analytics/stats" GET "$BASE_URL/api/analytics/stats" 401
log ""

# ══════════════════════════════════════════════════════════════════════════
# 5. 404 for unknown routes
#    Note: /api/* routes are behind auth middleware → unknown /api/ routes
#          return 401 (auth gate fires before 404 handler).
#          Non-API routes return true 404.
# ══════════════════════════════════════════════════════════════════════════
log "─── [5/6]  404 for unknown routes ────────────────────────────────"
assert_body "GET /nonexistent  (true 404)" \
  GET "$BASE_URL/nonexistent" 404
log ""
log "  ℹ️  /api/nonexistent returns 401 (auth gate) — not a true 404."
log "     This is expected: auth middleware runs before route matching."
log ""

# ══════════════════════════════════════════════════════════════════════════
# Stop HTTP server before MCP tests
# ══════════════════════════════════════════════════════════════════════════
log "─── Stopping HTTP server ─────────────────────────────────────────"
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
sleep 1
log ""

# ══════════════════════════════════════════════════════════════════════════
# 6a. MCP stdio mode
# ══════════════════════════════════════════════════════════════════════════
log "─── [6a/6] MCP stdio mode (tools/list) ───────────────────────────"
MCP_STDIO_OUTPUT=$(
  export JWT_SECRET TELEGRAM_BOT_TOKEN MCP_API_KEY DATABASE_PATH
  echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  timeout 8 \
  bun "$PROJECT_DIR/app/index.ts" --mcp-stdio 2>&1 || true
)

if echo "$MCP_STDIO_OUTPUT" | grep -q '"tools"'; then
  log "  PASS  tools/list responded with tool list"
  # Extract just the tool names for a readable summary
  TOOL_COUNT=$(echo "$MCP_STDIO_OUTPUT" | grep -o '"name":"[^"]*"' | wc -l)
  log "        $TOOL_COUNT tools registered"
  PASS=$((PASS + 1))
else
  log "  FAIL  tools/list did not return expected response"
  log "        Raw (first 300 chars): $(echo "$MCP_STDIO_OUTPUT" | head -c 300)"
  FAIL=$((FAIL + 1))
fi
log ""

# ══════════════════════════════════════════════════════════════════════════
# 6b. MCP HTTP mode
# ══════════════════════════════════════════════════════════════════════════
log "─── [6b/6] MCP HTTP mode (POST /mcp) ─────────────────────────────"
log "  Starting server with --mcp flag on port $MCP_HTTP_PORT..."
JWT_SECRET="$JWT_SECRET" \
TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
MCP_API_KEY="$MCP_API_KEY" \
DATABASE_PATH="$PROJECT_DIR/app/data/notes.db" \
PORT="$MCP_HTTP_PORT" \
bun "$PROJECT_DIR/app/index.ts" --mcp > "$TMPDIR/mcp-http.log" 2>&1 &
MCP_HTTP_PID=$!

if ! wait_for_server "http://localhost:$MCP_HTTP_PORT/health"; then
  tail -10 "$TMPDIR/mcp-http.log" | sed 's/^/  | /' >> "$EVIDENCE_FILE"
  FAIL=$((FAIL + 1))
else
  MCP_CURL_ACCEPT="-H 'Accept: application/json, text/event-stream'"
  MCP_CURL_CT='-H "Content-Type: application/json"'
  MCP_CURL_KEY='-H "x-api-key: $MCP_API_KEY"'
  MCP_BASE="http://localhost:$MCP_HTTP_PORT/mcp"
  MCP_SESSION_FILE="$TMPDIR/mcp-session.txt"

  # ── Step 1: Initialize — captures Mcp-Session-Id from response headers ──
  log "  Sending initialize request..."
  INIT_RESP=$(curl -s -D "$TMPDIR/mcp-headers.txt" -X POST "$MCP_BASE" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "x-api-key: $MCP_API_KEY" \
    -d '{
      "jsonrpc": "2.0",
      "id": 1,
      "method": "initialize",
      "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "smoke-test-client", "version": "0.1.0"}
      }
    }' 2>/dev/null || echo '{"error":"curl failed"}')

  # Extract Mcp-Session-Id from response headers (case-insensitive)
  MCP_SESSION_ID=$(grep -i '^Mcp-Session-Id:' "$TMPDIR/mcp-headers.txt" 2>/dev/null | sed 's/.*:\s*//' | tr -d '\r\n' || echo "")
  log "  Session ID: [${MCP_SESSION_ID:-<none>}]"

  if echo "$INIT_RESP" | grep -q '"serverInfo"'; then
    log "  PASS  MCP HTTP initialize succeeded"
    PASS=$((PASS + 1))
    log "        $(echo "$INIT_RESP" | head -c 200)"

    # ── Step 2: tools/list with session ID ──
    SESSION_HEADER=""
    [ -n "$MCP_SESSION_ID" ] && SESSION_HEADER="-H 'Mcp-Session-Id: $MCP_SESSION_ID'"

    TOOLS_RESP=$(curl -s -X POST "$MCP_BASE" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "x-api-key: $MCP_API_KEY" \
      -H "Mcp-Session-Id: $MCP_SESSION_ID" \
      -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' 2>/dev/null || echo '{"error":"curl failed"}')

    if echo "$TOOLS_RESP" | grep -q '"tools"'; then
      log "  PASS  MCP HTTP tools/list succeeded"
      TOOL_COUNT=$(echo "$TOOLS_RESP" | grep -o '"name":"[^"]*"' | wc -l)
      log "        $TOOL_COUNT tools registered"
      PASS=$((PASS + 1))
    else
      log "  FAIL  MCP HTTP tools/list did not return tools"
      log "        Raw: $(echo "$TOOLS_RESP" | head -c 500)"
      FAIL=$((FAIL + 1))
    fi
  else
    log "  FAIL  MCP HTTP initialize failed"
    log "        Raw: $(echo "$INIT_RESP" | head -c 300)"
    FAIL=$((FAIL + 1))
  fi

  # ── tools/list WITHOUT API key → 403 ──
  NO_KEY_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$MCP_BASE" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null || echo "ERR")

  if [ "$NO_KEY_CODE" = "403" ]; then
    log "  PASS  MCP HTTP without API key → 403"
    PASS=$((PASS + 1))
  else
    log "  FAIL  MCP HTTP without API key (expected 403, got $NO_KEY_CODE)"
    FAIL=$((FAIL + 1))
  fi

  # ── Cleanup MCP HTTP server ──
  kill "$MCP_HTTP_PID" 2>/dev/null || true
  wait "$MCP_HTTP_PID" 2>/dev/null || true
  MCP_HTTP_PID=""
fi
log ""

# ══════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════
log "╔══════════════════════════════════════════════════════════════╗"
log "║  RESULTS                                                    ║"
log "╠══════════════════════════════════════════════════════════════╣"
log "║  PASSED:  $(printf '%-3d' $PASS)                                        ║"
log "║  FAILED:  $(printf '%-3d' $FAIL)                                        ║"
log "║  TOTAL:   $(printf '%-3d' $((PASS + FAIL)))                                        ║"
log "╠══════════════════════════════════════════════════════════════╣"
if [ "$FAIL" -eq 0 ]; then
  log "║  ✓ ALL TESTS PASSED                                         ║"
else
  log "║  ✗ SOME TESTS FAILED ("$FAIL" failure(s))                        ║"
fi
log "╚══════════════════════════════════════════════════════════════╝"
log ""
log "Evidence saved to: $EVIDENCE_FILE"

exit "$FAIL"
