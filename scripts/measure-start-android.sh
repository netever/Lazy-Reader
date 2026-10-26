#!/usr/bin/env bash
# Cold start on Android: from launch to the first page of the last opened book.
#
# Before running: install the app on the phone, open any book in it and leave it open
# (the app reopens the last book on start). Connect the phone with USB debugging on.
#
# Usage:  scripts/measure-start-android.sh [runs]     (default 10 runs)
#
# For each run the app is force-stopped, started again, and the script waits for the
# "PERF first_page" line in logcat. Two numbers are printed:
#   first_page_ms  from process creation to the first page (what the reader sees)
#   activity_ms    Android's own TotalTime from `am start -W` (window shown, not the book)
# Copy the summary into docs/PERF.md together with the phone model.
set -euo pipefail

PKG=com.lazyreader.app
ACTIVITY="$PKG/.MainActivity"
RUNS=${1:-10}

command -v adb >/dev/null || { echo "adb not found: source scripts/env.sh first"; exit 1; }
adb get-state >/dev/null || { echo "no device connected"; exit 1; }

echo "device: $(adb shell getprop ro.product.manufacturer | tr -d '\r') $(adb shell getprop ro.product.model | tr -d '\r'), Android $(adb shell getprop ro.build.version.release | tr -d '\r')"

results=()
for i in $(seq 1 "$RUNS"); do
  adb shell am force-stop "$PKG"
  sleep 2
  adb logcat -c
  activity_ms=$(adb shell am start -W -n "$ACTIVITY" | tr -d '\r' | awk -F': ' '/TotalTime/ {print $2}')
  line=""
  for _ in $(seq 1 60); do
    line=$(adb logcat -d | grep -m1 "PERF first_page" || true)
    [ -n "$line" ] && break
    sleep 0.5
  done
  if [ -z "$line" ]; then
    echo "run $i: no first_page mark within 30 s (is a book open in the app?)"
    continue
  fi
  first_ms=$(echo "$line" | sed -E 's/.*since_process_ms=([0-9]+).*/\1/')
  echo "run $i: first_page_ms=$first_ms activity_ms=$activity_ms"
  results+=("$first_ms")
done

if [ ${#results[@]} -gt 0 ]; then
  median=$(printf '%s\n' "${results[@]}" | sort -n | awk '{a[NR]=$1} END {print (NR%2 ? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2)}')
  echo "runs=${#results[@]} median_first_page_ms=$median"
fi
