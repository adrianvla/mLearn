# Watch pending-update cancellation review

Source: `6d1de700e307cfa28f65c17a2d2c1baa0cebb3f8`.
Base: `03ab9e452869db726b7baebd7917d66aa2bc4100`.
Reviewer: `st_01a18e47`, independent gate review, APPROVE.

## Scope and verdict

The reviewer found no blocking defect in this bounded NAV-02 increment.
Cancellation becomes available only after `pauseAndSave()` succeeds. Pending
and failed checkpoints retain their recovery owner without a cancellation
escape. Actual-file cancellation remains separate.

The update action re-enters existing focus cleanup. Focus identity and source
epoch checks reject obsolete publication and prevent old operations from
clearing replacement state. Admitted mutations retain the runtime client's
serial tail through receipt settlement; source cancellation does not bypass
that tail. Rust remains the persistence authority.

The native smoke restoration subscription precedes Back and removes its
listener on success or cleanup. It observes explicit cancellation before
releasing the held preference receipt. Durable-offset and fresh-checkpoint
assertions remain. Code-quality review found no deletion-only, tautological
or implementation-mirroring tests, unnecessary production extraction or new
sleep-based synchronization. Named review skills were unavailable to the
reviewer; the supplied criteria were applied directly.

## Root verification

Artifacts below are in `/tmp/mlearn-ci-independent.6EaZ3F/`.

| Scenario | Result | Artifact |
| --- | --- | --- |
| Typecheck, ownership lint, native-smoke syntax | PASS | `watch-source-checks.log` |
| Old bundle, real committed preference held | Expected failure: cancel control absent | `watch-update-red-original-bundle.log`, `watch-update-red-results/` |
| Fresh export and first cancellation run | Cancel/receipt/resume succeeded; new test locator was wrong | `watch-update-fresh-green.log`, `watch-update-green-results/` |
| Corrected cancellation, checkpoint, restart | PASS, one scenario, 22.4 seconds | `watch-update-green-corrected.log`, `watch-update-green-corrected-results/` |
| Adjacent Home/Back recovery and replacement | PASS, two scenarios, 25.7 seconds | `watch-update-adjacent.log`, `watch-update-adjacent-results/` |

The fresh bundle is `5c9faba4392e87a2c92964d0eed2a926`. The new locator
correction uses the existing accessible name, including `375 milliseconds`;
it did not change production behavior. Root inspected pending captures at
1100/390 pixels, cancelled/restored captures at 390 pixels, and both adjacent
checkpoint-failure captures. The reviewer also inspected the cancellation
captures and logs.

Real Rust/package/SQLite execution preserves the admitted 375 ms preference,
3000 ms initial position and 1.5 playback rate through cancellation and late
receipt delivery, then a fresh 11000 ms checkpoint through native-process
crash/restart. Departure cases retain explicit checkpoint Retry and no cancel
escape. These scenarios make zero provider calls.

Original 2560 MiB admission, 2048/1024 MiB workload guard and 4 GiB reserve
were retained. Root's corrected teardown probe completed with no matching QA
runtime or preview process and no listener on port 4173. The first teardown
probe had an awk quoting error and supplied no teardown proof.

## Limits

At review time, desktop-native execution remained open. It subsequently passed
on pushed receipt source `8b74e7a69fe89a0b5f17742e6f13d67be5f1b975` in run
41115838504, native job 124269718631. Readback verified the exact head SHA,
successful real IPC/plugin-download/restart smoke and successful tracked-source
integrity step. This closes that increment's desktop-native gate, not mobile,
whole M10 or visual parity. Watch source LSP timed out at the original source
checkpoint; normal typecheck passed and the corrected test had clean diagnostics.

Foundation run 41115838452 also passed on exact receipt source `8b74e7a6`.
Readback confirmed successful web 124269718130, Rust 124269718595,
OCR-detector 124269718693, macOS 124272863540 and Windows 124272863580 jobs.
This does not diagnose or erase the historical intermittent Windows theme-input
failures or certify either subsequent fallback delta.

The reviewer ran no builds, tests, devices or network requests and did not
independently observe process teardown. The actual host owner is
`apps/client/src/host/createHost.web.ts`; the review brief incorrectly named
`src/runtime/createHost.web.ts`, and the reviewer resolved the correct path.

This approval covers only the bounded increment. It does not establish broad
visual parity, close M10 milestone gates, integrate M11, grant maintainer
acceptance or authorize merge/release. Prior M07/native/visual limits remain.
