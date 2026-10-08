#!/usr/bin/env bash
set -euo pipefail
# Read-only capture apart from resetting the process's diagnostic frame counters.
if [[ $# -ne 3 ]]; then
  echo "Usage: bash scripts/android-reader-metrics.sh <serial> <start|finish> <artifact-directory>" >&2
  exit 2
fi
reader_serial="$1"
reader_phase="$2"
reader_artifacts="$3"
reader_package="md.obsidian"
mkdir -p "$reader_artifacts"
adb -s "$reader_serial" get-state >/dev/null
adb -s "$reader_serial" shell pidof "$reader_package" >/dev/null
case "$reader_phase" in
  start)
    adb -s "$reader_serial" shell getprop ro.product.model > "$reader_artifacts/device-model.txt"
    adb -s "$reader_serial" shell getprop ro.build.version.release > "$reader_artifacts/android-version.txt"
    adb -s "$reader_serial" shell dumpsys package "$reader_package" > "$reader_artifacts/obsidian-package.txt"
    adb -s "$reader_serial" shell dumpsys meminfo "$reader_package" > "$reader_artifacts/memory-before.txt"
    adb -s "$reader_serial" shell dumpsys gfxinfo "$reader_package" reset > "$reader_artifacts/frame-reset.txt"
    echo "Started. Run one focused flow in an isolated test Vault; then run finish."
    ;;
  finish)
    adb -s "$reader_serial" shell dumpsys gfxinfo "$reader_package" > "$reader_artifacts/gfxinfo.txt"
    adb -s "$reader_serial" shell dumpsys gfxinfo "$reader_package" framestats > "$reader_artifacts/framestats.txt"
    adb -s "$reader_serial" shell dumpsys meminfo "$reader_package" > "$reader_artifacts/memory-after.txt"
    echo "Captured frame and memory evidence in $reader_artifacts. Pair with QReader's exported timing report."
    ;;
  *) echo "Phase must be start or finish" >&2; exit 2 ;;
esac
