#!/bin/bash
#
# Local persistent MongoDB for development.
#
# WHY THIS EXISTS. With MONGODB_URI blank the app starts an IN-MEMORY replica
# set and re-seeds it on boot, so every nodemon restart throws the database away
# and spends ~15 seconds rebuilding 209 users, 52 stocks and 18,720 snapshots.
# Vite stays up throughout, but it proxies /api to a port that is not listening,
# so the browser looks broken for the whole window. Pointing MONGODB_URI at this
# instance makes a restart an Express boot instead — the seed only runs when the
# database is empty.
#
# NO INSTALL REQUIRED. It reuses the mongod binary that mongodb-memory-server
# has already downloaded and cached, so this adds no Homebrew package, no
# Docker image and no account.
#
# A REPLICA SET, NOT A STANDALONE, and that is not optional: MongoDB only offers
# multi-document transactions on a replica set, and order execution depends on
# them. `connectDb()` probes for support at boot and logs what it found.
#
# Bound to 127.0.0.1 with no authentication — local development only. Do not
# expose this port.
#
#   ./scripts/mongo.sh start|stop|status|logs
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT/.data/mongodb"
LOG_FILE="$ROOT/.data/mongod.log"
PID_FILE="$ROOT/.data/mongod.pid"
PORT=27017
REPL_SET=rs0

# Prefer the newest cached binary; both live where mongodb-memory-server put
# them. The cached files are named `mongod-arm64-darwin-8.2.1`, NOT `mongod` —
# matching the bare name finds nothing and reports "no binary" on a machine that
# has two. `sort -V` then picks the highest version rather than the first found.
find_mongod() {
  find "$HOME/.cache/mongodb-binaries" "$ROOT/node_modules/.cache/mongodb-memory-server" \
    -name 'mongod*' -type f -perm -u+x 2>/dev/null | sort -V | tail -1
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo "mongod already running (pid $(cat "$PID_FILE")) on port $PORT"
    return 0
  fi

  local bin
  bin="$(find_mongod)"
  if [ -z "$bin" ]; then
    echo "No cached mongod binary found." >&2
    echo "Run 'npm install' once with MONGODB_URI blank to let" >&2
    echo "mongodb-memory-server download one, then retry." >&2
    exit 1
  fi

  mkdir -p "$DATA_DIR"
  echo "starting mongod ($("$bin" --version | head -1))"

  # NO --fork: mongod 8 rejects it on macOS ("fork+exec is incompatible with
  # macOS"), so the process is backgrounded here and its pid recorded by hand.
  #
  # oplogSize is capped deliberately: the default sizes itself from free disk
  # and would claim gigabytes for a database this small.
  nohup "$bin" \
    --dbpath "$DATA_DIR" \
    --port "$PORT" \
    --bind_ip 127.0.0.1 \
    --replSet "$REPL_SET" \
    --oplogSize 128 \
    --wiredTigerCacheSizeGB 0.25 \
    --logpath "$LOG_FILE" \
    >/dev/null 2>&1 &

  echo $! > "$PID_FILE"

  # Backgrounding returns immediately, so wait for the port to actually accept
  # before initiating — otherwise the init script races the server's startup.
  for _ in $(seq 1 60); do
    if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then break; fi
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "mongod exited during startup — last log lines:" >&2
      tail -n 15 "$LOG_FILE" >&2
      rm -f "$PID_FILE"
      exit 1
    fi
    sleep 0.5
  done

  # Listening is not the same as writeable: the replica set still has to be
  # initiated before it will accept a write.
  node "$ROOT/scripts/mongo-init.mjs"
}

stop() {
  if ! is_running; then
    echo "mongod is not running"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  echo "stopping mongod (pid $pid)…"
  # SIGTERM lets WiredTiger checkpoint and close cleanly; SIGKILL would force a
  # recovery pass on the next start.
  kill "$pid"
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  rm -f "$PID_FILE"
  echo "stopped"
}

status() {
  if is_running; then
    echo "mongod running (pid $(cat "$PID_FILE")) on 127.0.0.1:$PORT"
    du -sh "$DATA_DIR" 2>/dev/null | sed 's/^/data: /'
  else
    echo "mongod is not running"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) tail -n 40 "$LOG_FILE" ;;
  *) echo "usage: $0 start|stop|restart|status|logs" >&2; exit 1 ;;
esac
