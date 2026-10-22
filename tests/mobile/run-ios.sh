#!/bin/bash
set -euo pipefail
device="$1"
export PATH="$PWD/tests/mobile/ios-driver:$PATH"
mkdir -p test-results/mobile
set +e
maestro --device "$device" test --config tests/mobile/config.yaml --format junit --output test-results/mobile/junit.xml --test-output-dir test-results/mobile --debug-output test-results/mobile tests/mobile/watch.yaml 2>&1 | tee test-results/mobile/run.log
original_status=$?
if [ "$original_status" -ne 0 ] && [ -f test-results/mobile/junit.xml ]; then
  # Experiments use the same failed picker and compiled app, never a green retry.
  video=$(python3 -c 'import re,xml.etree.ElementTree as E; root=E.parse("test-results/mobile/junit.xml").getroot(); text="\n".join("".join(x.itertext()) for x in root.iter("failure")); match=re.search(r"id: (m01-(?:watch|japanese)), mp4",text); print(match.group(1) if match else "")')
  if [ -n "$video" ]; then
    mkdir -p test-results/mobile/picker-identical test-results/mobile/picker-keyboard
    maestro --device "$device" test --config tests/mobile/config.yaml -e VIDEO_NAME="$video" -e DIAGNOSTIC_STAGE=identical --format junit --output test-results/mobile/picker-identical/junit.xml --test-output-dir test-results/mobile/picker-identical --debug-output test-results/mobile/picker-identical tests/mobile/watch/picker-selection-replay.yaml 2>&1 | tee test-results/mobile/picker-identical/run.log
    replay_status=$?
    keyboard_status=null
    if [ "$replay_status" -ne 0 ]; then
      maestro --device "$device" test --config tests/mobile/config.yaml -e VIDEO_NAME="$video" --format junit --output test-results/mobile/picker-keyboard/junit.xml --test-output-dir test-results/mobile/picker-keyboard --debug-output test-results/mobile/picker-keyboard tests/mobile/watch/picker-keyboard-replay.yaml 2>&1 | tee test-results/mobile/picker-keyboard/run.log
      keyboard_status=$?
    fi
    printf '{"video":"%s","originalExit":%s,"identicalReplayExit":%s,"keyboardReplayExit":%s}\n' "$video" "$original_status" "$replay_status" "$keyboard_status" > test-results/mobile/picker-diagnostic.json
  fi
fi
exit "$original_status"
