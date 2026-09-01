#!/usr/bin/env bash
# Does CONN_MAX_AGE leak PostgreSQL connections under Django's ASGI path?
#
# Django closes persistent connections from the request_finished signal, which
# runs in whichever thread served the request. Under ASGI the sync view runs in
# a threadpool thread; when that thread is retired the connection it opened is
# still parked in that thread's `connections` thread-local, and nothing closes
# it. High-water marks then never come back down.
#
# Method: baseline -> modest burst -> wait past CONN_MAX_AGE -> re-measure.
# If the count returns to baseline, connections are recycled properly. If it
# stays high, they leak, and CONN_MAX_AGE is unsafe without a bounded thread
# pool or an external pooler.
#
#   ./conn_leak_check.sh <django-ip> <port> <label>

set -u
IP="${1:-172.19.0.4}"
PORT="${2:-8001}"
LABEL="${3:-run}"

conns() {
  local out
  out=$(docker compose exec -T db psql -U danza -d danza -tAc \
    "select count(*) from pg_stat_activity where datname='danza'" 2>&1 \
    | tr -d '[:space:]')
  # psql itself needs a connection; being refused one is the loudest possible
  # answer to "are they exhausted?"
  case "$out" in
    ''|*toomanyclients*) echo "EXHAUSTED (psql refused)" ;;
    *)                   echo "$out" ;;
  esac
}

echo "=== $LABEL ==="
echo "baseline            : $(conns)"

docker run --rm --network nounder40_default curlimages/curl:latest sh -c \
  "for i in \$(seq 1 300); do curl -s -m 10 -o /dev/null http://$IP:$PORT/api/health/ & done; wait" \
  >/dev/null 2>&1

echo "immediately after   : $(conns)"
sleep 30
echo "after 30s           : $(conns)"
sleep 50
echo "after 80s (>MAX_AGE): $(conns)   <- should be back near baseline"
