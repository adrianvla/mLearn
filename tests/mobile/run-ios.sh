#!/bin/bash
set -euo pipefail
device="$1"
export PATH="$PWD/tests/mobile/ios-driver:$PATH"
mkdir -p test-results/mobile
# M03-M07 defers picker diagnostic replays, not this primary acceptance result.
maestro --device "$device" test --config tests/mobile/config.yaml --format junit --output test-results/mobile/junit.xml --test-output-dir test-results/mobile --debug-output test-results/mobile tests/mobile/watch.yaml 2>&1 | tee test-results/mobile/run.log
