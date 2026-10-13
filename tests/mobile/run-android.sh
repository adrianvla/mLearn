#!/usr/bin/env bash
set -euo pipefail
# Called only inside the emulator runner, which owns this disposable device.
device="emulator-${EMULATOR_PORT:-5554}"
mkdir -p test-results/mobile
trap 'adb -s "$device" logcat -d -t 3000 > test-results/mobile/native.log 2>&1 || true' EXIT
adb -s "$device" install apps/client/android/app/build/outputs/apk/release/app-release.apk
maestro --device "$device" test --format junit --output test-results/mobile/junit.xml \
  --test-output-dir test-results/mobile --debug-output test-results/mobile \
  tests/mobile/foundation.yaml 2>&1 | tee test-results/mobile/run.log
