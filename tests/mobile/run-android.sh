#!/usr/bin/env bash
set -euo pipefail
# Called only inside the emulator runner, which owns this disposable device.
device="emulator-${EMULATOR_PORT:-5554}"
mkdir -p test-results/mobile
trap 'adb -s "$device" logcat -d -t 3000 > test-results/mobile/native.log 2>&1 || true' EXIT
{
  command -v adb
  adb version
  adb server-status
  emulator -version
} > test-results/mobile/host-adb-start.log 2>&1
adb -s "$device" install apps/client/android/app/build/outputs/apk/release/app-release.apk
python3 tools/create-watch-fixture.py .mlearn/m01-ci-fixtures
adb -s "$device" shell mkdir -p /sdcard/Download
adb -s "$device" push .mlearn/m01-ci-fixtures/watch-fixture.mp4 /sdcard/Download/m01-watch.mp4
adb -s "$device" push .mlearn/m01-ci-fixtures/watch-fixture.srt /sdcard/Download/m01-watch.srt
maestro --device "$device" test --format junit --output test-results/mobile/junit.xml \
  --test-output-dir test-results/mobile --debug-output test-results/mobile \
  tests/mobile/watch.yaml 2>&1 | tee test-results/mobile/run.log
