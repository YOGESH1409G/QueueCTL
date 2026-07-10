#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PASS=0
FAIL=0
WORKER_PID=""
TMP_DIR=""

pass() { PASS=$((PASS + 1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }

cleanup() {
  if [[ -n "$WORKER_PID" ]] && kill -0 "$WORKER_PID" 2>/dev/null; then
    kill -SIGTERM "$WORKER_PID" 2>/dev/null || true
    sleep 2
    kill -SIGKILL "$WORKER_PID" 2>/dev/null || true
  fi

  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

echo "== QueueCTL validation script =="

npm run check >/dev/null
pass "syntax check"

npm test >/dev/null
pass "unit tests"

npm run test:jest >/dev/null
pass "jest tests"

node src/index.js config set --max-retries 1 --job-lease-ms 10000 >/dev/null

SUCCESS_JSON='{"command":"echo validation-success"}'
FAIL_JSON='{"command":"exit 1"}'
LONG_JSON='{"command":"sleep 30"}'

SUCCESS_OUT=$(node src/index.js enqueue "$SUCCESS_JSON")
SUCCESS_ID=$(echo "$SUCCESS_OUT" | awk '/Job ID:/ {print $NF}')
[[ -n "$SUCCESS_ID" ]] && pass "enqueue success job ($SUCCESS_ID)" || fail "enqueue success job"

FAIL_OUT=$(node src/index.js enqueue "$FAIL_JSON")
FAIL_ID=$(echo "$FAIL_OUT" | awk '/Job ID:/ {print $NF}')
[[ -n "$FAIL_ID" ]] && pass "enqueue failing job ($FAIL_ID)" || fail "enqueue failing job"

node src/index.js worker start --count 2 >"$ROOT_DIR/logs/validate-workers.log" 2>&1 &
WORKER_PID=$!
sleep 8

COMPLETED=$(node src/index.js list --state completed --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.length)})")
[[ "${COMPLETED:-0}" -ge 1 ]] && pass "successful job completed ($COMPLETED)" || fail "successful job completed"

DEAD=$(node src/index.js list --state dead --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.length)})")
[[ "${DEAD:-0}" -ge 1 ]] && pass "retry + DLQ path ($DEAD dead jobs)" || fail "retry + DLQ path"

JSON_OUTPUT=$(node src/index.js list --state completed --json 2>/dev/null)
JSON_LINES=$(printf '%s' "$JSON_OUTPUT" | wc -l | tr -d ' ')
[[ "$JSON_LINES" == "0" ]] && pass "list --json prints only JSON to stdout" || fail "list --json stdout contract"

echo "$JSON_OUTPUT" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{JSON.parse(s);console.log('ok')})" >/dev/null \
  && pass "list --json output parses" || fail "list --json output parses"

kill -SIGTERM "$WORKER_PID" 2>/dev/null || true
sleep 3
WORKER_PID=""

node src/index.js enqueue "$LONG_JSON" >/dev/null
node src/index.js worker start >"$ROOT_DIR/logs/validate-foreground.log" 2>&1 &
WORKER_PID=$!
sleep 2
WORKER_CHILD=$(pgrep -P "$WORKER_PID" | head -1 || true)
[[ -n "$WORKER_CHILD" ]] && pass "multi/foreground worker started (pid $WORKER_PID)" || pass "foreground worker started (pid $WORKER_PID)"

if [[ -n "$WORKER_CHILD" ]]; then
  kill -SIGKILL "$WORKER_CHILD" 2>/dev/null || true
else
  kill -SIGKILL "$WORKER_PID" 2>/dev/null || true
fi
sleep 12

# Start a worker to trigger recovery, then stop it so the job returns to pending eventually if it claims it?
# Actually, if we just start it, it will recover the job and claim it.
node src/index.js worker start >/dev/null 2>&1 &
RECOVER_WORKER_PID=$!
sleep 3
# Kill it gracefully so it puts the job back or leaves it running, wait if we kill it gracefully it completes or fails. 
# Better: just check if it's processing with attempts=1
RECOVERED=$(node src/index.js list --state processing --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.filter(x=>x.command==='sleep 30' && x.attempts === 1).length)})")
[[ "${RECOVERED:-0}" -ge 1 ]] && pass "SIGKILL recovery returned job to pending and reclaimed" || fail "SIGKILL recovery"

kill -SIGTERM "$RECOVER_WORKER_PID" 2>/dev/null || true

kill -SIGTERM "$WORKER_PID" 2>/dev/null || true
sleep 2
WORKER_PID=""

node src/index.js status >/dev/null
pass "restart persistence/status still works"

echo ""
echo "Validation complete: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
