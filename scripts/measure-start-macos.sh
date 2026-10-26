#!/usr/bin/env bash
# Cold start on macOS, same method as the Windows script: wall clock from launch
# to the "PERF first_page" line in perf.log. Open a book in the app before running.
#
# Usage:  scripts/measure-start-macos.sh /path/to/Lazy\ Reader.app [runs]
set -euo pipefail

APP=${1:?path to the .app bundle}
RUNS=${2:-10}
LOG="$HOME/Library/Application Support/com.lazyreader.app/perf.log"
BIN="$APP/Contents/MacOS/$(defaults read "$APP/Contents/Info" CFBundleExecutable)"
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }

results=()
for i in $(seq 1 "$RUNS"); do
  pkill -f "$BIN" || true
  sleep 2
  before=$( [ -f "$LOG" ] && wc -l < "$LOG" || echo 0 )
  t0=$(now_ms)
  open "$APP"
  line=""
  for _ in $(seq 1 120); do
    line=$( [ -f "$LOG" ] && tail -n +"$((before + 1))" "$LOG" | grep -m1 "PERF first_page" || true )
    [ -n "$line" ] && break
    sleep 0.25
  done
  if [ -z "$line" ]; then echo "run $i: no first_page mark"; continue; fi
  epoch=$(echo "$line" | sed -E 's/.*epoch_ms=([0-9]+).*/\1/')
  echo "run $i: first_page_ms=$((epoch - t0))"
  results+=("$((epoch - t0))")
done
pkill -f "$BIN" || true

if [ ${#results[@]} -gt 0 ]; then
  median=$(printf '%s\n' "${results[@]}" | sort -n | awk '{a[NR]=$1} END {print (NR%2 ? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2)}')
  echo "runs=${#results[@]} median_first_page_ms=$median"
fi
