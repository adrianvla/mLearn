# Watch checkpoint increment gate review

recommendation: APPROVE
blockers: []

Source: `0875124772a6621a98c18a7c7b124e081189d053` against `6d6c41da`.
Review checkout: `/tmp/mlearn-ci-independent.6EaZ3F/watch-checkpoint-review`.
Scope: this bounded increment only. This is not M10 completion, M11 admission, milestone acceptance, maintainer acceptance, merge or release approval.

## originalIntent

Continue bounded M10 navigation/checkpoint engineering while CI is unavailable. Watch Home must retain a usable source and explicit recovery after a failed checkpoint, wait for acknowledgement before departure, preserve the retained Material workspace's unsubmitted draft, and expose Cancel opening only for native source opening. Rust remains the persistence/domain authority and the existing runtime cancellation owner remains unique.

## desiredOutcome

A learner can recover a failed save, explicitly retry, then leave Watch for Home only after the save completes. Returning to management preserves the unsubmitted Material search. Home saving must not offer cancellation of a different native operation.

## userOutcomeReview

No demonstrated regression or unmet bounded product criterion was found. The product diff separates `opening` from generic `busy` at the actual `openSource` await, clears it in `finally` and on focus admission, and leaves the existing cancellation API in place. It creates no persistence store, new cancellation authority, parser or abstraction.

The exact Git HEAD matches the requested source; `status --short` was empty. The three-file diff is limited to WatchScreen, its existing connected source-search test, and the current checkpoint document. I read all 826 lines of WatchScreen and all 210 lines of watch-search.spec.ts, not merely the supplied excerpt.

### Criteria and evidence

- C1, recoverable failed Home checkpoint: `WatchScreen.tsx:278-294,308-318,391-405,713-717` retains save error/retry and reloads the source admission after failed departure. The green failed-state screenshot visibly retains Watch, its decoded video, and Retry saving position. The existing integration test aborts the save transport rather than replacing the persistence implementation.
- C2, acknowledgement before departure: `WatchScreen.tsx:391-405` awaits cancellation and `pauseAndSave` before `dismissTo('/')`; Home is disabled by `busy` at lines 681-682. The test at `watch-search.spec.ts:185-205` subscribes before Home, holds the real save request, checks the disabled Home and unchanged route, then releases it and checks Home plus the saved position/offset/rate after another native crash/restart. The pending screenshot agrees with those assertions.
- C3, retained management drafts: unchanged management Tabs and Material search state remain the presentation owners. The existing `watch-departure-native-core.spec.ts:9-56` exercises both Home and Reselect at desktop and narrow widths. The green run includes both. I directly inspected all four requested root Home/retained-Material screenshots: the actual Home surfaces and exact `Manual retained Watch draft 1080`/`390` inputs are visible alongside the Children Material editor.
- C4, cancellation meaning: `WatchScreen.tsx:465-473,686-689` brackets `openSource` only. The old broad `busy` predicate is removed. The red log specifically reproduces expected zero / received one Cancel opening control while Home's checkpoint is held. The corresponding green screenshot has a disabled Home and no such control. This is a user-visible wrong-operation regression, not a source-spelling test.
- C5, existing authorities and preservation: `runtime-client/src/client.ts:41-45,130-165,219-225,258` retains one epoch/cancellation owner and acknowledges save responses through the typed client. Durable saves are deliberately not invalidated as source actions. `crates/runtime/src/watch.rs:408-423` writes the Rust source before returning PositionSaved. No Rust, protocol, router, management-store or host implementation changed. STATE explicitly retains the provisional foundation, Windows/iOS failures and incomplete M10 status.

## Independent code review and skill-perspective pass

Loaded `programming/SKILL.md`, its TypeScript reference, and `remove-ai-slops/SKILL.md` from `/Users/adrian/.omo/binary-runtime/5.1.45/plugin/skills/`. Applied them directly to this exact diff and its relevant production owners under the explicit read-only/no-execution scope; no cleanup was performed.

Checked async/focus lifetimes, cancellation identity, ownership, type escapes, unnecessary production extraction, parsing/normalization, dead code, defensive scaffolding, duplication, and speculative abstractions. The new React boolean is presentation state with a concrete lifetime, not another runtime owner. Its `finally` restores the state for success or failure. No new type suppression, cast, normalization or runtime compatibility layer was added.

Checked tests for excessive/useless coverage, deletion-only tests, mere-removal assertions, tautologies, implementation mirroring and source/prose pinning. None was introduced. The added request classifier selects the injected transport fault; it does not compute the expected persisted values. The expectations are independently fixed at 3000 ms, 2000 ms and 1.5. The negative Cancel assertion protects a reproduced incorrect action while also checking genuine checkpoint admission, disabled Home, route retention, successful departure and persistence. It is not merely verifying requested code removal. The extension reuses the existing expensive real-video/native fixture and keeps all previous assertions. Event subscriptions precede actions, and the held request has deterministic explicit release in `finally`; there are no new sleeps.

Nonblocking maintenance note: the existing source-search scenario is long and now combines search/restart and departure recovery. Splitting it could improve failure locality but would duplicate costly setup; no bounded success criterion requires that redesign. WatchScreen's large pre-existing size and its pre-existing unguarded drop/navigation continuations are retained risks, not newly demonstrated failures. Broad blur/unmount interleavings and actual native drag/drop cancellation were not executed or certified here.

This artifact explicitly records the independent code review and both required skill perspectives. A separate executor/code-review report path and notepad path were not supplied, and bounded searches found no separate current checkpoint review artifact. Therefore comparison against a separate report's explicit skill coverage could not be completed. This is recorded as an evidence gap, not invented approval evidence or a product blocker: no stated bounded product criterion requires a second report in addition to this independent review.

## Checked artifact paths

All relative source paths below are inside the locked review checkout.

- Full exact Git diff of the requested revisions and clean source identity.
- `apps/client/src/features/watch/WatchScreen.tsx` (complete).
- `tests/web/watch-search.spec.ts` (complete).
- `docs/implementation/STATE.md:1-130`.
- `tests/web/watch-departure-native-core.spec.ts` and `tests/web/messenger-native-fixture.ts`.
- `packages/runtime-client/src/client.ts` (relevant cancellation, queue, response and Watch methods).
- `apps/client/src/bootstrap/MediaSurface.tsx`, `apps/client/src/host/MediaPlayer.web.tsx`, `apps/client/src/host/createHost.web.ts`.
- `apps/client/src/app/_layout.tsx`, `apps/client/src/app/(management)/_layout.tsx`, relevant MaterialScreen state/navigation declarations.
- `tools/runtime-browser-qa.mjs` (native process/transport, restart and teardown owners).
- `crates/runtime/src/watch.rs:398-439`.
- `/tmp/mlearn-ci-independent.6EaZ3F/watch-checkpoint-red.log`.
- `/tmp/mlearn-ci-independent.6EaZ3F/watch-checkpoint-green.log`.
- `/tmp/mlearn-ci-independent.6EaZ3F/watch-checkpoint-supervision.log`.
- `/tmp/mlearn-ci-independent.6EaZ3F/watch-checkpoint-green-results/.last-run.json`.
- `/tmp/mlearn-ci-independent.6EaZ3F/watch-checkpoint-green-results/watch-search-literal-trans-da0ca-ckpoint-safe-Home-departure-chromium/watch-home-checkpoint-{failed,pending}-390.png` (both visually inspected).
- `/tmp/mlearn-ci-independent.6EaZ3F/manual-watch-final.log`.
- `/Users/adrian/dev/mLearn-v3/.mlearn/m10/manual-watch-{home,material-retained}-{1080,390}.png` (all four visually inspected).
- `/Users/adrian/dev/mLearn-v3/.mlearn/m10/watch-checkpoint-08751247-native` (directory inventory only: imports, plugin-blobs, profile.sqlite3; not executed or opened as a live profile).

## Exact evidence limits and retained risks

No builds, tests, browser/device/server launches, network or CI requests were run by this reviewer, as explicitly required. Reproduction here means checking the exact source, recorded failures/results and image artifacts, not a new execution claim. The green log contains successful typecheck, architecture lint, fresh export hash `432136dd68020a28fd34d62458b00b2a`, and all 12 scenarios passing in 15.0 seconds; `.last-run.json` reports passed with no failed tests. The raw log does not independently record a final shell exit code or candidate Git hash, so those associations rely on the checkpoint and matching export/source context rather than a signed execution manifest. Separate LSP diagnostic output was not supplied; normal typecheck output is present.

The native browser fixture executes real Rust/package/storage requests but adapts media byte delivery and shell listen registration. It proves browser decoding and native persistence/restart, not OS-native playback, native drag/drop cancellation, or iOS/Windows behavior. The manual adapter's missing native media is explicitly disclosed and is not passed off as decoding proof.

The manual log records graceful browser exit 0, preview SIGTERM, no active provider/catalog and native close. The asserted final process/port absence, wrapper exit 255 and separate PIPESTATUS probe are checkpoint/brief claims, not independently reproduced from a dedicated readback/probe artifact. The temporary `manual-watch-final.mjs` was listed initially but unavailable when subsequently read; it was not reviewed. Neither limitation falsifies the visible manual result or the separate connected automated evidence.

Resource samples in the inspected run logs retain the four-GiB reserve and remain safe. The earlier OmO spike is still unexplained; this review does not resolve it or authorize automatic workload restarts. Existing Windows native-theme/input and iOS Watch failures, M07 provisional status, draft PR44/45, unavailable CI and all broader M10 gates remain open.

## Verdict

APPROVE this bounded increment on the inspected evidence. No demonstrated bounded product failure merits REQUEST_CHANGES. Do not interpret this verdict as M10 completion, permission to start M11 before M10 gates, platform acceptance, maintainer acceptance, merge or release authorization.
