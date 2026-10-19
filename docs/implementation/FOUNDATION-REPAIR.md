# Focused foundation repair - October 19, 2026

Scope: the maintainer-authorized performance and shared-UI repair on `agent/m01`,
draft PR #44, after fast-forwarding the clean worktree to contract commit
`13ab1e8897a71f85843cf22efd6517d0b4439d28`. No milestone advancement, merge or
maintainer acceptance is implied. M02 remains partial; M03 is not admitted.
Application source is `66a5f04d99c960b568e0f34d71ebb5752b4e7dad`, with backend
repair `52f94f5e` and shared-owner/consumer repair `66a5f04d`.
Verified native Linux harness is `463b76cfb6c031b13809c9d04ec684ab472dc687`;
its only application-relative change is `tests/desktop/native-smoke.mjs`.

## Consuming-app performance

All controlled runs used the real Tauri development app, its existing isolated
`net.kikan.mlearn.v3dev` profile, paused `test-video.mov` at 18,805 ms, and the
same Japanese package `0.1.1-sudachi20260116-jmdict20261017`. No live v2 profile,
replacement guest, fabricated result or filesystem-cache flush was used.

| Measurement | Unoptimized development | Repaired development |
| --- | --- | --- |
| Successful initialization, three fresh processes | 21,740 / 21,934 / 21,642 ms | 373 / 366 / 400 ms |
| First three-cue morphology call | 384 / 382 / 382 ms | 7.85 / 7.88 / 7.85 ms |
| Resume action to committed annotation frame | 23,661 / 22,954 ms, instrumented repeats | 1,261 / 1,258 / 1,321 ms |
| Host resource time within initialization | 20-26 ms, instrumented repeats | 22-27 ms |
| Initialization work | 255,954,738 fuel; 122,948,671 resource bytes; 1,877 range reads | Identical |

The first before run and last after run used the documented command:
`source .mlearn/preflight/env.sh; npm run dev:desktop -- --no-watch`.
Other runs launched the preserved or current native executable against the same
frozen renderer and signed local catalog. Metrics were enabled with
`MLEARN_PLUGIN_METRICS=1` and `EXPO_PUBLIC_MLEARN_METRICS=1`.
The first instrumented baseline also had a three-second native CPU sample;
the next was unsampled. Reported end-to-end times include approximately
0.84-1.26 seconds of existing source revalidation. Annotation frame metrics are
post-commit animation-frame observations, corroborated by actual usable native
word controls and Inspector interaction, not pixel-presentation timestamps.

The sample and explicit host-resource spans identify interpreter execution,
not dictionary I/O, as the dominant initialization cost. Optimize the interpreter,
its three support crates and the host's generic execution code in development,
retaining symbols, assertions and overflow checks. Runtime and application code
remain ordinarily debuggable. Wasmi remains the engine; validation, authentication,
fuel slices, memory ceilings, cancellation and the existing single execution slot
are unchanged.

Wasmi 2 automatic dispatch at optimization level 3 overflowed the actual native
worker stack with development checks enabled. The unchanged connected
Japanese/restart test also reproduced the abort. Explicit built-in
`portable-dispatch` avoids recursive-handler dependence on LLVM tail-call
elimination. Intermediate safe opt-level-1 candidates took 1.99 and 1.02 seconds
and failed the predeclared 500 ms initialization budget; they were not called ready.

Portable dispatch also applies to Release. The retained automatic-dispatch probe
and current Release probe both passed all 13 genuine inputs and 59 lexical entry
checks. Ten 13-input warm batches took 65,889 versus 156,837 microseconds total:
6.59 versus 15.68 ms per batch, a 2.38x throughput cost. Current Release
initialization took 204.65 ms. This is an explicit bounded-stack tradeoff, not a
claim that Release performance is unchanged; both remain inside the 500 ms batch
budget. No cache or engine redesign was introduced.

Warm transcript search took 3.35 ms of morphology and 18 ms to its committed
frame; the six-cue page took 24.78 ms and 65 ms respectively. Transcript reopen
reused morphology and projected current Knowledge (141 microseconds), committing
in 48 ms. Home/reopen also reused morphology. English selection produced its
explicit unsupported-script error; switching back initialized Japanese once in
373.85 ms and restored the same source.

Actual same-package selection exposed unnecessary cache invalidation. Rust now
returns the bounded source immediately when both installed ID and version already
match, preserving cached morphology; the UI avoids issuing that unchanged
selection. A real storage/guest regression failed before the fix and passes
after it. A separate stale-version case still adopts the installed version through
normal validated execution. No guest work is confused with the executor's admission
mutex, and same-version artifact replacement still clears the existing cache.

## Shared UI ownership and real surfaces

`resolveTheme().typography` now owns complete family/size/line-height/weight roles,
including action, badge, media-title, subtitle and inspection roles. Shared `Text`,
native inline controls, text fields and buttons consume those roles. Feature-local
font copies are removed. `Badge` owns noninteractive reading/POS materials;
`Button` owns selected treatment and checkmarks; `SettingRow` owns meaningful
divided label/description/action composition shared by appearance and language
management. These owners reach actual Home, Settings, Watch, transcript and
Inspector callers, without a widget framework or new domain authority.

The approved `inspector/inspector.png`, `other/settings.png` and Watch reference
were opened directly. Supporting runtime/CSS evidence used clean reference
revision `1788f9c74dc73dd884b687ec80d9550c3ebf6c6b`, with its supported
`MLEARN_USER_DATA` disposable profile. Actual computed styles were captured;
the genuine EULA/onboarding state was not represented as a finished Settings
screen. That process/profile were removed without tracked reference changes.

Actual native desktop QA covered:

- Slate/Quartz Home and Settings at 1080x800 and 420x560; accepted 2x text on
  the minimum window, real scrolling and reachable source actions.
- Real Japanese Inspector, reading/POS chips, long dictionary body/source,
  expanded granular correction controls and six genuine alternative entries.
- Transcript search, nested Inspector, independent body/footer scrolling,
  visible dismissal and focus restoration to the initiating occurrence.
- Actual invalid-theme feedback beside Save, with the saved theme unchanged.
- Genuine opening feedback. Its first capture exposed a label behind the absolute
  toolbar; it now uses the existing status region below the measured toolbar.
  A subsequent real 420x560/2x opening capture verifies readable containment.

Desktop media keeps its intentional contrast treatment in both ordinary themes.
No DevTools-only state, screenshot-specific DOM or fabricated content was used.
Home/final mobile composition remains `visual_pending`, not maintainer-approved.
Current desktop state was restored to Slate 1x, 18,805 ms, offset 0, rate 1 and
click inspection. Preferences revision is 25 after deliberate theme QA;
Knowledge revision and claim receipts remain 21/21.

## Verification ledger

Local evidence stays under `.mlearn/foundation-repair/`; private media, profile
data and captures are not uploaded.

- `final-ui-checks.log`: npm tests, typecheck, architecture lint, generated
  contract check, web export, all six browser tests and whitespace check pass.
- `final-rust-checks.log`: complete `npm run test:native` passes, including
  authenticated admission, fuel/memory limits, cancellation, persistence/restart,
  artifact freshness, Knowledge completion and real Japanese workflows.
- `same-package-{red,green-build}.log`: reproduced regression and connected
  12-test green run. `final-affected-checks.log` and `final-strict-checks.log`
  include the final named regressions and all eight desktop host tests.
- A pre-existing desktop test fixture omitted the three M02 source-preference
  fields and could not compile. The baseline blob confirms the omission; the
  fixture now supplies ordinary defaults without changing its assertions.
- `final-scoped-clippy.log`: strict runtime/host all-targets and desktop production
  diagnostics pass. Desktop all-target strict Clippy still reports unchanged
  `media/tests.rs:189` (`useless_format`); its blob matches `13ab1e8`.
  The previously recorded storage-test `field_reassign_with_default` is also
  outside this repair. Neither is suppressed or claimed clean.
- `mobile-release-build.log`: current consuming iOS and Android Release builds
  pass, including regenerated native bindings and all packaged native targets.
- Android foundation and complete Watch/transcript/claims/preferences/restart
  flows pass (123 and 205 seconds). Current iOS foundation and complete Watch
  flows pass (598 and 164 seconds), with zero JUnit failures. Actual Inspector
  and transcript captures from both platforms were opened.
- The first iOS foundation run failed at its long-press Select All gesture.
  Retained native screenshots show a real caret/selection but no edit menu.
  Repeated taps at the same visible leading-text position opened the native menu;
  the harness now uses that proven iOS gesture. Android retains its already-passing
  gesture, and every original assertion remains. The complete iOS rerun, not just
  the diagnostic probe, passes. Failed probes remain retained.
- Hosted foundation `39295160843` passes on application source `66a5f04d`.
  Linux native `39295160705` failed at pointer dismissal immediately after
  reopening Inspector. Its actual failure image and DOM are retained: the real
  entry is open, with the dismissal assertion still enforced. The harness now
  observes real entry completion, layout and Close hit testing before WebDriver
  chooses its pointer location; it still performs the actual pointer click and
  requires disappearance within the unchanged five-second bound. No sleep,
  synthetic click or application-state replacement was added.
- Full hosted Linux native rerun `39296832207` passes on `463b76cf`, including
  the actual IPC/package/playback/Inspector/claims/transcript/cancellation/
  minimum/2x/restart/recovery step. Its current minimum Inspector and transcript
  captures were opened. Hosted foundation `39296832201` also passes, with web,
  Rust and both macOS/Windows desktop jobs successful.
- Original consuming mobile `39295160679` compiled both Release apps but failed
  UI assertions. Opened Android evidence shows the unrelated Pixel Launcher ANR
  obscuring correctly selected English Home. Opened iOS evidence and command
  receipts show persisted offset/transcript/claims/restart succeeded before a final
  Reset tap hit a control clipped by the fixed footer on iOS 26.5. Both failures
  remain retained under `mobile-failed-39295160679/`, not relabelled passing.
  Harness-only `8aa53c46` explicitly scrolls the Reset/status targets into view and
  conditionally dismisses only that exact launcher ANR, never an mLearn error.
  YAML parsing and whitespace checks pass; original assertions remain intact.
  Consuming mobile rerun `39299585014` has passed Android's actual UI/persistence,
  complete APK ABI and unchanged-source steps (none skipped). JUnit reports zero
  failures in 242.955 seconds; actual transcript/restart captures were opened.
  iOS compiled but its retained UI log reproduced the reset failure: accessibility
  visibility alone skipped moving the clipped target. The job then exceeded its
  55-minute limit, confirmed by the check annotation; its missing JUnit is not a
  pass. The harness now centers Reset away from the viewport edge, retaining
  original assertions. The complete local consuming iOS 27 flow passes with zero
  failures in 177.994 seconds; its actual restart capture was opened. This is not
  claimed as hosted iOS 26.5 verification. The iOS
  job budget now reserves time for the unchanged 20-minute UI bound after the
  observed 42-minute cold preparation/build, plus evidence upload. No agent
  cancelled either run. Application/binary inputs remain unchanged.
- Centered harness `0ca5ca83` is pushed. Complete consuming mobile run
  `39308549546` is subscribed; its actual iOS result remains required.

LSP diagnostics were unavailable (missing TypeScript server and Rust daemon
timeouts). Actual compiler, typechecker and scoped strict diagnostics supply the
verification; LSP errors are not counted as passes.

Successful native timing logs are `unoptimized-{1,2,3}.log`,
`portable-optimized-{1,2}.log` and `portable-normal-dev.log`.
Interrupted HMR baseline attempts, the optimized automatic-dispatch stack abort,
and slower safe experiments remain retained and explicitly excluded from success
timing claims. Release probe outputs and CPU sample are retained beside them.

Current local captures include `settings-{slate,quartz}-desktop.png`,
`home-quartz-desktop.png`, `inspector-desktop.png`, `inspector-expanded.png`,
`inspector-source-visible.png`, `transcript-desktop.png`,
`transcript-minimum-2x.png`, `inspector-minimum-2x-expanded.png` and
`inspector-alternatives-minimum.png` and `opening-source-desktop.png`. The latter
retains the genuine normal-launch Resume pending state below the toolbar, followed
by paused 18,805 ms annotations and Home restoration. Its OS window capture includes
the shadow (2384x1824); its application window is 1080x800. The binary hash is
unchanged. All 14 images listed in local `candidate-identity.json` exist and decode
with their recorded original dimensions (the other captures are 2160x1600 or
840x1120). The reader's automatic 2000-pixel preview
resizing is not mistaken for a different native viewport. That manifest records
the exact binary, package/data and source identities and restored state.
