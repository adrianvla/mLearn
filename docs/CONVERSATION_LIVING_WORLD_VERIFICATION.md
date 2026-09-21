# Living-world verification

The full A01–A45 target remains broader than this wave. **Current bounded verdict (2026-09-21): V09 PASS.** V08 is accepted and its occurrence/reflection authority boundary remains intact. V09 autonomous jobs, bounded offscreen episodes, recovery, pause, foreground reconciliation, real-model behavior, and mounted product lifecycle pass the evidence below. V10 proactive contact, notifications, calls, and voice remain excluded. Historical blocked sections are retained as audit history and are superseded by the closure sections.


## V01 — Integration admission boundary, 2026-09-14

Production path: world bridge → `WORLD_INTEGRATE` → `worldIpc.integrateThread` → existing world mutation queue and journal service. Tests invoke the production domain writer and real JSON/NDJSON persistence in temporary directories; Electron module/window launch are controlled. No model or audio runs.

Red/green regressions in `src/electron/services/integration.test.ts`:

- An integration with a valid first draft and an unauthorized second audience originally resolved successfully and admitted the private material. It now rejects before either draft reaches Sea, retaining the original Thread event.
- Two simultaneous submissions originally returned `[false, false]` for `alreadyApplied`, proving duplicate admission. They now return one new admission and one replay with exactly one memory and one integration marker.
- Reusing the same operation ID with changed content originally returned success. It now rejects as a conflict. Retrying the original acknowledged operation after source erasure returns the existing admission.
- Promoting a person from another context originally changed their permanent status. It now rejects before writing memories or changing the person.

Existing partial-write replay test still exercises the actual journal and writer; its sources are now explicit and its Room/Thread is created through production APIs. It proves compatible retry of a previously partial batch, **not atomic crash recovery**. Existing remember-this erasure/provenance and promotion identity tests remain intact.

Validation:

- `npx vitest run src/electron/services/integration.test.ts src/electron/services/worldIpc.test.ts`: exit 0, 2 files / 16 tests passed.
- `npx vitest run src/electron/services/integration.test.ts src/electron/services/worldIpc.test.ts src/electron/services/journalService.test.ts src/electron/services/dreamerRuntime.test.ts`: exit 0, 4 files / 29 tests passed.
- `npm run typecheck`: exit 0, both renderer/shared and Electron TypeScript configurations.
- `git diff --check`: exit 0.
- Environment warning: Vitest/Node reports localStorage unavailable without `--localstorage-file`; it did not fail these tests.

Limits: no mounted integration workflow yet; no cross-file atomic transaction; no synthetic future-language test needed for this change (no language contract modified); full suite/build and real-runtime proof remain required at integration gates. All acceptance cases remain open in the implementation ledger.

## V02 — Independent selected-person practice, 2026-09-14

Production path: New Conversation exact selections → `WORLD_CREATE_SANDBOX` → `worldIpc.createSandbox` → atomic world JSON publication → Thread-owned cast and history-head baseline → App selection → shared roomOrchestrator/contextCompiler → existing provider/turn engine → sandbox journal → shared intelligent text. Local participant editing uses the same updateParticipant command with explicit Thread scope.

Controlled regression evidence: `worldIpc.test.ts` proves concurrent creation deduplication, unchanged permanent topology, baseline survival after persistent edits, local override isolation, refusal to replace ownership, sandbox Sea-write/unbound-actor rejection, and future-history exclusion in the actual compiler. `App.test.tsx` mounts Conversation with an independent sandbox and verifies pinned persona in provider input plus scoped user/character output. Existing NewConversationModal tests now verify exact IDs through the sandbox bridge instead of permanent membership writes.

Commands/results:

- Targeted domain/renderer set: 8 files / 98 tests passed.
- `npm run test`: 424 passed / 1 skipped files; 6,717 passed / 9 skipped tests (32.11 seconds). This run precedes the final sidebar CSS and practice-version label changes.
- Following those final UI changes: `npx vitest run src/renderer/windows/conversationAgent/ThreadInfoPanel.test.tsx src/renderer/windows/conversationAgent/NewConversationModal.test.tsx src/renderer/windows/conversationAgent/App.test.tsx`: 3 files / 32 tests passed.
- Both TypeScript configurations passed; production build passed, retaining the pre-existing large-chunk warning. Six edited locale JSON files parse successfully. `git diff --check` passed.

Native proof used actual built Electron pages, preload, main-owned stores and journal, with an isolated disposable profile `/tmp/mlearn-living-world-v02-profile` copied from the earlier test clone. The app's userData override was asserted before interaction. Permanent Room and Participant arrays were compared before/after creation and editing. No original real profile was used for writes; this is not the A40 original-profile hash/migration proof.

Normal pointer interaction exercised selection, separate intent, creation, text send, Details/local edit, reload and sidebar. 1100 px and 420 px creation containers had no overflow. Screenshot inspection found sidebar overflow for long names; it was fixed and a subsequent native run asserted no sidebar overflow. Reload restored 2 bubbles / 17 interactive tokens; no page errors were captured on the Conversation page. The temporary startup migration window and pre-append timing initially caused harness failures; the harness now waits for actual app/preload and acknowledged journal persistence.

Final native record: sandbox `thr_91cf0f59-8f0f-48c0-bc52-bea285413188`; events `evt_mu1gnqtv_1_dj8qbu48`, `evt_mu1gnqud_2_eritt8dl`. Exact selected origin IDs were preserved. Model: localhost Ollama-compatible controlled fixture at port 11449; **no real-model or audio proof**. Proactivity disabled in the test profile. Main-process startup logs report missing `dist-electron/env/bin/pip3`; no blanket clean-startup claim is made.

Harness/log: `/tmp/living-world-v02-electron.cjs`, `/tmp/living-world-v02-electron.log`. Screenshots copied to `/Users/adrian/.codex/visualizations/2026/09/14/01a0a0aa-246d-78c2-b79f-669b9b8445fd/living-world-v02-{create-1100,create-420,details-420,sidebar-420}.png`. These native results are partial evidence for A03/A07/A30/A31, not completed acceptance cases.

## V03 — Director staging, generated local individuals and Scenario consumption, 2026-09-14

Production path: New Conversation intent and exact selected IDs → main-owned prepareScenario → existing provider queue and policy → strict proposal validation → durable owner preview → activateScenario → one atomic world JSON publication → persisted Thread Scenario/bindings → shared compiler/orchestrator → actual character inference and scoped journal. Generated proposals are explicitly labelled as fictional, not researched canon. No Director actor or invented user setup message is created.

Controlled production-path evidence (`scenarioDirector.test.ts`): separate generated identities and remapped audiences, scoped goals/knowledge and directional relationships, unchanged permanent topology, repeated/concurrent activation idempotency, durable failed retry, cancellation, service reload and selected-person baseline conflict. Provider output is mocked in these tests; persistence/compiler/orchestrator are real. Inference-queue tests verify bounded main-owned output, foreground-safe queued cancellation and rejection before exposure when a queued local request's provider configuration changes.

Validation: full suite 425 passed / 1 skipped files, 6,724 passed / 9 skipped tests, 31.80 seconds; both TS configurations passed. Subsequent preview accessible-name change passed all 9 creation/sidebar tests. Production builds passed, retaining large-chunk warnings. Logs: `/tmp/living-world-v03-{full-tests,typecheck,accessibility-tests,build}.log`.

Native test uses actual built Electron, a disposable `/tmp/mlearn-living-world-v03-profile`, and local Ollama `gemma4-e4b-q4:latest` at port 11434; no model output is substituted. The first-run test exposed the setup modal blocking Continue to Chat; the production effect now waits for the intro and a mounted regression passes. Real model proposals then failed witness-reference validation and directional-relationship validation. These failures left no permanent or temporary published topology. The schema instructions were clarified, not the validators weakened. Synthetic raw output was captured observationally via the unchanged completeJob result to diagnose the second failure.

The next explicit retry of saved operation `6fb12b3a-4e0f-4a1e-b566-ffaa157a91a9` reached a valid preview in 14,673 ms. Normal clicks opened private profile details and accepted the proposed setting. At 1100 and 420 px the inspected creation containers had no horizontal overflow. Activation created `thr_a5cb7151-95b7-4ac9-86fa-3a13ca6520d2`, local Eleanor Vance and Marcus Chen, with no Room or permanent Participant records. A real reply by Eleanor used her documented efficiency/herb-growing priorities and voluntarily disclosed her own soil concern. The captured provider prompt included her goal and excluded Marcus's private starting knowledge. This is one positive sample, not the full A42 social-quality matrix.

The initial harness's rendered-bubble count allowed its second-reply wait to pass before a second character event existed. Its VERIFIED label does not certify two-person completion: the captured journal had one character reply. The harness now compares acknowledged character-event counts before/after each send. A saved-Thread restart run (`/tmp/living-world-v03-resume.cjs`, `.log`) is in progress to verify both actual replies. The first run already proves one reply and persisted reload. No audio/notification/group/migration proof is claimed. All A01–A45 remain open.

Final native follow-up: the first async browser wait still returned early; explicit Node-side polling of persisted character-event counts then verified increases 2→3 and 3→4, with distinct Eleanor and Marcus actor IDs asserted. `/tmp/living-world-v03-resume.log` exited 0. Final replies: `evt_mu1hr5nu_8_oocttdw9` (Eleanor) and `evt_mu1hre2m_11_dh79kyvk` (Marcus); all 11 captured events are Thread-scoped, including a scoped memory.belief. Reload retained the exchange; no Conversation page errors. Preview screenshots at 1100/420 and the resumed conversation screenshot are under the visualization directory as `living-world-v03-review-{1100,420}.png` and `living-world-v03-conversation-resumed.png`. The resumed screenshot is desktop width; its original temporary filename is not width proof.

Real-model quality finding still **failed/open**: Eleanor's later response includes malformed literal `correct_mistake{...}` syntax, including an apparent self-correction, in the committed display text. Marcus's response expresses his own artistic/pollinator priorities and differs from Eleanor's functional plan. These positive identity observations do not excuse the tool-output leak or establish trustworthy learner evidence. Next diagnosis must trace provider tool parsing → conversationAgent tool results → committed display/learning writes with this captured synthetic transcript, then regress the production boundary. Audio, autonomous continuity and all other full acceptance conditions remain open.

## V04 — Tool output and observed correction boundary, 2026-09-14

Root cause of the V03 live defect: `conversationAgent.parseToolCallsFromContent` used non-greedy brace matching, which truncated nested arguments, and deliberately retained failed parses. Streaming published the raw text and normal finalization persisted it. A malformed batched correction could also record a grammar failure before checking for an observed learner span; a null entry threw during finalization.

Fix: balanced, quote/escape-aware extraction for known inline tools; partial control syntax is withheld while streaming; malformed/incomplete arguments are discarded without execution or private-argument logging. Finalization and timeout paths consume cleaned content, including responses with structured tools. Valid nested calls still execute. Corrections require a non-empty changed correction and one unambiguous exact learner span with any supplied surrounding context, before widget/evidence creation. Conversation supplies the actual current human journal event independently of model-facing user-role history; synthetic context-only turns supply no observed human text.

Regression evidence: two parser tests failed before the extraction fix (malformed output leaked; nested no-parenthesis call did not execute). The invalid-correction test failed before validation, reproducing a null-entry failure and prior premature evidence writes. New tests cover malformed split streaming output, nested arguments and quoted braces, missing/nonhuman correction spans, and other-person text in a model user role. Older valid-correction fixtures were changed from unrelated `test` input to their claimed learner spans; rejection tests retain mismatched spans.

Validation: 123 tests passed across conversationAgent and mounted App after final observed-human wiring; both TypeScript configurations and production build passed. Full suite before that final wiring: 425 passed / 1 skipped files, 6,727 passed / 9 skipped tests, 31.34 seconds. Logs `/tmp/living-world-v04-{parser-red,evidence-red,tests,typecheck,build,full-tests}.log`. `git diff --check` passed.

Actual built Electron and local gemma4-e4b-q4:latest resumed the same disposable Thread. Explicit persisted-event polling acknowledged two new distinct actor replies (`evt_mu1hx37i_13_5grqckqr`, `evt_mu1hxgdl_15_n6y6kx4j`), asserted no known correction control syntax or model delimiter in either new committed reply, and verified reload with no Conversation page errors. The replies preserve different priorities and refer to previously disclosed conversation: Eleanor's functional plan and Marcus's proposed aesthetic/practical compromise. This live run preceded the final observed-human callback addition; that addition has mounted/unit and TS/build evidence. Harness/log/output: `/tmp/living-world-v04-electron.cjs`, `.log`, `/tmp/living-world-v04-quality.json`.

Limits: these positive real-model samples do not certify A42's full quality matrix. Old saved malformed messages were not rewritten. Voice correction authority, complete canonical Tier-2 evidence, tool permission/revalidation, semantic correctness of corrections and general prompt-injection resistance remain open. No acceptance case is closed by this checkpoint.

## V05 — Persistent Room foreground scope, 2026-09-14

Observed production defect: selecting a Room automatically selected/created a Thread, and all foreground user/character/correction/memory writes were hardcoded to Thread scope. Persistent Rooms could not conduct normal foreground world activity.

Changed route: Room selection without an explicit Thread now loads that Room's user-visible Sea transcript; scoped Sea from other Rooms remains available only to per-person context filtering. No Thread is created or silently selected. Explicit saved Thread selection remains separate. The shared orchestrator derives the output scope from the active Thread or encounter, writing persistent Room replies to Sea and sandbox replies to their Thread. User text, checker sidecars and memory tool writes use the same selected scope. Saved Room selection restores the selected Room, not always the first Room. Details identifies an active Room without presenting an untitled Thread. Voice uses the same route, but actual voice proof is still pending.

Regression proof: before the change, a direct persistent Room turn threw for missing Thread events and the journal store attempted to load a null Thread. New tests verify Sea history/append, other-Room transcript exclusion and mounted Room text with no createThread call. Existing saved-Thread parity tests now explicitly restore their saved Thread. Duplicate memory projection was caught by the full suite: IDs from distinct streams must remain distinct, so deduplication keys include Room and scope as well as event ID.

Validation: 65 focused domain/store/mounted tests passed; both TS configurations and production build passed. Final full suite: 425 passed / 1 skipped files, 6,731 passed / 9 skipped tests, 32.33 seconds. Logs `/tmp/living-world-v05-{red,tests,typecheck,build,full-tests}.log`. Native existing-Room selection/text/reload is running against the same disposable profile and actual local model, with synthetic Room/individual setup through production entity APIs. It does not prove a usable new persistent Room creation UI.

Remaining: user-facing persistent Room creation through Director, independent membership/presence, cross-window event subscription, main-authorized foreground commit validation, legacy Room-linked Thread migration/creation, and the automatic reflection/autonomy/contact loop remain incomplete. All full acceptance cases remain open.

Final V05 native result: `/tmp/living-world-v05-electron.cjs` exited 0, actual local gemma4-e4b-q4:latest; normal sidebar selection of `room-ce9b9b95-4b5a-4962-a132-de2636ed9ed0` → user `evt_mu1i734x_4_nd8esna4` → character `evt_mu1i78ug_5_1w2drr97`, both directly Sea-scoped; Thread count stayed 1 (the prior independent sandbox). Reload restored the selected Room and its reply. Conversation page errors: none. Native screenshot review at 1100 and 420 px completed; screenshots copied as `living-world-v05-room-{1100,420}.png` in the visualization directory. The first reload text assertion incorrectly included ruby pronunciation text; the corrected assertion removes rt/rp from a detached clone for comparison only. No production rendering was bypassed.

Native quality failure: this local model emits `[thinking]` / `[Thinking]` prose followed by `<channel|>` inside ordinary message content, and that text currently reaches the journal and display. This is distinct from the V04 corrected tool-call parser. Both native V05 replies demonstrate it. The exact synthetic response is in `/tmp/living-world-v05-quality.json` and saved test Sea journal. `ollamaService.ts` also forwards provider `message.thinking` as `<think>` content; trace both paths before choosing a shared control/content boundary. Persistent scope/reload is verified; A42 and UX output quality remain failed/open. Do not claim this as acceptable character speech or a completed connected living-world loop.

## V06 — Canonical reasoning-marker boundary and persistent Room creation, 2026-09-14

### Reasoning-marker leak (V05 failure)

Root cause: model output is control-bearing text, and nothing between the provider stream and the journal/display stripped it. `ollamaService.streamChatUnified` transports provider `message.thinking` as `<think>` regions (transport metadata, documented in place; the merge is unchanged because `WordSelector`'s think-tag JSON recovery consumes it), while some models additionally leak reasoning conventions inside ordinary `content` (the V05 `[thinking] … <channel|>` sample). The shared conversation agent had no handling for either.

Fix: one canonical boundary, `src/shared/modelContent.ts` `sanitizeModelSpeech` (pure, idempotent). `<think>…</think>` regions and `[thinking]`-label regions are dropped; a `[thinking]` region ends at `[/thinking]` or a `<channel|>`-family marker and speech after it is kept; unterminated regions are withheld while streaming and dropped when final; stray closing/channel tokens are deleted; a trailing partial marker is held during streaming. Applied at:

- Agent generation boundary (`conversationAgent.startStream`): streaming `onChunk`, finalization, and the 90-second timeout path all sanitize before tool-call parsing, so reasoning text can never execute tools or become speech.
- Journal persistence (`roomOrchestrator.runAndAppend` character draft) and model-history projection (`projectHistoryForParticipant`, via `sanitizeJournalMessageText` — character rows only, human rows verbatim).
- Display projections (`journalRuntime.eventsToDisplayMessages`, `roomMessages.projectMessages`), so persisted rows written before the boundary existed render clean on reload without rewriting journal history. User messages are never rewritten.

Red/green regressions: `src/shared/modelContent.test.ts` (15 unit cases incl. the V05 synthetic sample, streaming holds, idempotency, human-text exemption); new tests in `roomOrchestrator.test.ts` (runner output persisted clean; persisted dirty rows project clean, user rows verbatim), `conversationAgent.test.ts` (chunk-split V05 leak never appears in any `onChunk`, `onDone` content or history), `journalRuntime.test.ts` (persisted dirty character row renders clean). All three integration tests failed before the boundary was wired and pass after.

Live regression: actual built Electron with the SAME local model that produced the V05 leak (`gemma4-e4b-q4:latest`), fresh disposable profile `/tmp/mlearn-living-world-v06-profile`. One streamed + persisted + reloaded character reply (`evt_mu1omsrf_3_qrvx2s9u`) contains no `[thinking]`, `<channel|>`, `<think>` or tool syntax; the reloaded bubble matches the persisted text. Harness `/tmp/living-world-v06-electron.cjs`, quality record `/tmp/living-world-v06-quality.json`. This closes the V05 leak defect; A42's full quality matrix remains open.

### Persistent Room creation wave

Production path: New Conversation modal scope choice (`Temporary practice` vs `My world (persistent room)`) → persistent + no intent: `WORLD_CREATE_PERSISTENT_ROOM` → `worldIpc.createPersistentRoom` (deterministic, one `withWorldMutation` save publishing Room + roster + `createdByOperation` retry identity; membership history events drafted against the pre-membership roster and appended after the entity save). Persistent + intent: `prepareScenario` with `scope: 'persistent'` → owner preview → `activateScenario` publishes Room, permanent Participants for generated individuals (IDs remapped `participant_*`), selected people joined as members, and the Scenario on a room-linked Thread in one atomic save. The shared compiler consumes the Scenario through the existing `thread.scenario` contract; the turn engine writes Sea-scope replies (V05 semantics).

Legacy replacement: the sidebar's Room-linked `New Thread` button and `App.newThread()` → `WORLD_CREATE_THREAD` entry are removed; `WORLD_CREATE_THREAD`/`createThread` is deleted from constants, IPC, preload, `global.d.ts`, both bridges and worldIpc. Old saved room-linked threads (including legacy-migrated archived ones) remain listed and selectable; read paths are unchanged — this is the explicit preservation boundary. Creation only runs through the New Conversation boundary; `handleClear` now routes there.

Controlled evidence: `worldIpc.test.ts` replaces the createThread tests with `createPersistentRoom` tests (atomic publication + persisted roster + membership event, retry returns the same Room, changed roster conflicts, temporary/absent person rejection, empty-selection rejection). `scenarioDirector.test.ts` adds persistent activation tests: atomic Room+permanent-cast+Scenario-Thread publication, per-person scenario compilation (goals/knowledge witnesses, private objective excluded), selected-person roster join without identity rewrite, and no permanent topology on validation failure. `NewConversationModal.test.tsx` covers the scope choice dispatch (persistent selection → `createPersistentRoom` with `scope: 'persistent'`; persistent intent → `prepareScenario` with scope attached; sandbox assertions unchanged).

Validation: focused domain/renderer set 26 files / 288 tests passed; `npm run typecheck` (both configurations); `npm run build` (large-chunk warning retained); full suite 426 passed / 1 skipped files, 6,758 passed / 9 skipped tests. Six locale dictionaries gained `NewConversation.ScopeLabel/ScopeTemporary/ScopePersistent/PersistentHint`, dead `Sidebar.NewThread` removed; all six parse.

Live proof: the same native run above exercised persistent creation end to end with normal pointer interaction: scope radio → Rowan chip → Start → `room-2c60d772-0fee-454b-b5f6-06a2aec92308` with `createdByOperation`, roster `[Rowan]`, zero Threads, one membership Sea event, Sea-scoped user/character events, reload restore, no page errors, no horizontal overflow at 420 px (`/tmp/living-world-v06-room-{1100,420}.png`, creation dialog `/tmp/living-world-v06-create-1100.png`; screenshots are temporary artifacts).

Limits: no generated-intent persistent activation was run natively (real-model Director proposals remain flaky per V03; the staging/validation path is fixture-verified). Membership events after the entity save are not cross-file atomic — a crash between them loses only cosmetic history, never the roster (roster is authoritative in world.json). Concurrent multi-window persistent creation is serialized by the existing world mutation queue but not separately proven. Generated persistent individuals keep scenario-private goals/knowledge in the Scenario, not in facets; destination-aware integration, scoped reflection, autonomy and contact remain open. No acceptance case is closed by this checkpoint.

### V06 adversarial correction — 2026-09-14

The submitted persistent-intent path did **not** write Sea replies: selecting its room-linked Scenario Thread caused Thread-scoped user/character events, and ordinary Room return dropped Scenario context. The focused regression reproduced this. Persistent activation now stores Scenario on the Room and opens Sea scope, with zero Threads. The canonical compiler consumes Room Scenario state on subsequent turns. Old saved Threads are preserved without automatic scope conversion.

See `CONVERSATION_LIVING_WORLD_V06_REVIEW.md` for findings, repair, boundaries and native evidence. New validation: 6,763 passed / 9 skipped tests, both TS configurations and production build pass. Actual local-model Director preview → acceptance → Room exchange → reload → explicit Room return → second exchange passed in built Electron, with two Sea exchange pairs and no reasoning markers. Generated additional cast remains fixture-tested; the native intent run selected an existing person. Selective integration was not started.

## V07 — Adversarial selective-integration review, 2026-09-15 (current)

**Verdict: V07 still architecturally incomplete.** The original W1–W5 soundness claim was falsified. New operations have been corrected and verified; old pending/interrupted prefixes have no before-image and cannot be deterministically repaired from their ledger alone. Older adoptions without the new immutable link also need an explicit migration decision if their baseline has drifted. See [V07 review](CONVERSATION_LIVING_WORLD_V07_REVIEW.md) for the failure matrix, corrections and remaining blocker.

**Original protocol:** W1 exposed adopted people/current roster/situation through `loadWorld`; W2 membership and W3 admissions were returned by unfiltered Sea readers before W4. Startup reconciliation was queued before world IPC reads, but was not a universal read barrier; an interrupted recovery left published topology behind. Passing replay tests did not establish isolation.

**Current protocol:** private prepared ledger save → tagged membership/memory/marker preparation → one atomic world save publishing topology **and committed status**. All canonical Sea projection/subscription/query readers gate prepared rows on committed status. The journal marker is no longer described as the logical commit. Recovery is driven by prepared content, not source survival; transient I/O stays retryable, while proven conflicts publish no prepared effects.

Corrections also cover stable adoption after persona edits, tampered binding/collision rejection, witnesshood independent of current membership, world-continuity destinations without Room creation, Room-only situation adoption, destination/consequence-level claims, retracted source exclusion, automatic dependency deselection, pending retry/failure reporting, and narrow modal layout.

Evidence:

- Three initial adversarial regressions failed against the original implementation: W3 pre-commit adoption visibility, historical witnesses becoming current members, and adopted-person identity failing after a persistent persona edit.
- `scripts/verify-v07-crashes.cjs`: actual SIGKILL after W1, W2, W3, journal marker and final atomic world commit; fresh process reads **before recovery**; source Thread+journal deletion; deterministic recovery and replay. All four prepared boundaries exposed zero canonical rows/topology changes; the final boundary exposed the complete result.
- Production domain tests cover identical concurrent submissions, changed-selection conflict, source deletion, independent consequences sharing provenance, manual different interpretations, separate destinations, A-only knowledge, historical departure, C exclusion, preview purity, retraction and the existing Dreamer input path. Old W1 fixtures now document the unresolved legacy state instead of asserting “coherent” recovery.
- Actual Electron on a full copy-on-write cloned profile: Details → integration preview → destination/consequence/dependency/situation → injected marker I/O failure → Retry → reload → destination Details → Memory Browser → original Thread. The failed attempt had no canonical B, roster/situation change or Sea memory. Retry committed once. A second actual Electron process for that clone exited under the single-instance lock.
- Desktop 800×600 and narrow 390×760 CSS-pixel inspection. No horizontal overflow; the admission-badge grid defect was found and corrected. No integration-related uncaught renderer exception was observed. Whole-app startup did log an existing Anki-forwarding HTTP 500; the deliberate I/O failure was expected and shown to the user.

Final validation: full suite **427 passed / 1 skipped files; 6,789 passed / 9 skipped tests**. After the last small label/layout/identity-hash changes, targeted integration/modal tests passed **28/28**; both TypeScript configurations, production build, all five process-crash probes, locale JSON parsing and `git diff --check` passed. The final rebuilt native retry cleared the prior error and showed completion; an explicitly selected world-scoped private note was visible to A and absent from B in Memory Browser. Narrow item text measured 253 px after the badge fix. Details gained an explicit close button because backdrop-centre activation was intercepted by the narrow drawer.

Profile isolation evidence: original `world.json` and `kv-store.json` checksums remained identical. The original settings checksum changed before the first successful cloned-app launch (13:55:29 versus 13:56:24); differing authentication state was observed, not logged. No command wrote the original profile, but whole-profile byte identity is not claimed. A08/A09 remain open at full acceptance scope. Autonomous lives, Dreamer expansion, initiative, Scenario evolution and V08 were not started.

## V08 — Automatic scoped reflection and persistent Scenario evolution, 2026-09-16 (historical initial result)

Production path: completed foreground turn → `WORLD_TRIGGER_REFLECTION` → main-owned `dreamerRuntime.consolidateContext` (policy-gated, in-flight deduplication, abort-aware) → per-person scoped reflection (`dreamerService.runReflection`, one validated model call per cast member's own witness/absence-filtered view) and Director scenario evolution (`scenarioDirector.evolveScenario`, shared-window proposal validated against exact cast identities). Both publish through one durable `ReflectionRunRecord` (world.json ledger), reflection drafts persisted before any journal append (all-or-nothing resume), and scenario evolution through an atomic entity compare-and-save plus the `scenario_evolved` history row and a scenario-kind consolidation marker. Startup recovery (`reconcilePendingMaintenance`) runs in `main.initialize()` after legacy migration; app quit aborts in-flight passes at phase boundaries; sandbox Thread deletion cancels and settles its runs, and thread-scoped journal writes now require a live, context-matching Thread record (erased streams cannot be resurrected).

Controlled production-path evidence (real JSON/NDJSON persistence in temporary directories; providers mocked; journals/world files real):

- `dreamerService.test.ts` (8 tests): thread-scope isolation, per-window idempotency, per-owner view partitioning (Ben's prompt never contains Ava's private disclosure; empty views make no calls), cast-identity rejection with bounded retry then honest window close, provenance on every derived row, all-or-nothing recovery of an interrupted prepared publication (marker verified, never duplicated, no re-derivation), fail-closed settlement of a pending record without prepared output.
- `scenarioDirector.test.ts` (14 tests incl. evolution): sandbox scenario evolution from real events with validated identities, goal-update rejection for unknown participants (nothing committed), durable conclusion consumed by the compiler (`concluded`, conclusion text in developments), crash recovery between entity save and journal row (prepared cleared on commit), private goal deltas absent from the witnessed `scenario_evolved` payload and from the other cast member's compiled context.
- `journalService.test.ts` (9) / `threadErasure.test.ts`: thread-scoped writes now validate context ownership (`thread.roomId === roomId`); existing streams/tests updated to seed live Thread records.
- `scripts/verify-v08-maintenance.cjs` (15 checks, after build, real filesystem, one fresh SIGKILL probe profile each): kill inside the model call → pending record, recovery settles failed, replay derives once; kill after the first derived row → recovery completes the prepared publication all-or-nothing and replays idempotently; kill after the marker → recovery verifies it and settles committed without a duplicate; clean run → exactly one committed record, replay no-ops.

Real-model evaluation (labeled separately; deterministic fixtures prove orchestration, not grounding):

- `scripts/verify-v08-real-model.cjs`: real local `gemma3:4b` through `dreamerLlm.complete` → real `ollamaService` path on a disposable profile. Committed per-person reflection (owner-scoped beliefs citing real source events) and a committed Director evolution (developments citing real events, one private goal update, situation left active — no mandatory drama). `LIVE_MODEL_EVIDENCE=PASS`. Earlier runs with `gemma3:1b` failed output-shape validation three times and were recorded, not mocked; prompt requirements were clarified and parsing made fence-tolerant without loosening identity validation.
- `scripts/v08-electron-main.cjs` under `npx electron`: actual Electron main process, production `WORLD_TRIGGER_REFLECTION` IPC handler registration and invocation, real model, real journals (asserted `app.getPath('userData')` equals the disposable profile). `ELECTRON_EVIDENCE=PASS` — 7 owner-scoped derived events (owners mara/eli), one reflection marker with all 7 produced ids, one committed `scenario_evolved` with developments citing the real source events. This is a main-process IPC-path run; a full mounted-conversation-window UI run remains open (see limits).

Validation:

- `npm run test`: 425 passed / 3 skipped files; 6,792 passed / 21 skipped tests. One earlier run showed transient WordSync parallel-pool failures that pass both in isolation and in a subsequent full-suite run (order/parallel sensitivity, not V08 code); the failing-check rerun was required and recorded here rather than waived.
- `npm run typecheck` (both configurations), `npm run build` (pre-existing large-chunk warning retained): exit 0.
- Crash verifier: 15/15 PASS; real-model script: `LIVE_MODEL_EVIDENCE=PASS`; Electron harness: `ELECTRON_EVIDENCE=PASS`.

Limits: no mounted conversation-window interaction (reflection runs through the production IPC handler inside real Electron, but notification/deep-link/UI surfaces for maintenance state are not exercised — they remain later waves); no per-owner display surface beyond Details status; repeated-reflection salience amplification is bounded per window by the attempt ledger but full A20/A21 invalidation propagation (search indices, queued prompts) is open; VoiceMem-inspired prefetch/prefetch invalidation unchanged; A01–A45 remain open at full acceptance scope.

## V08 — Adversarial review and repair, 2026-09-16 (historical blocked verdict)

**BLOCKED within V08.** [Detailed findings and evidence](CONVERSATION_LIVING_WORLD_V08_REVIEW.md). Scope remains automatic scoped reflection and persistent Scenario evolution; roadmap V08 → V09 → V10 → END. No successor work, commit, push or deployment.

The original “all-or-nothing” claim was false: the supplied crash script explicitly asserted partial canonical rows before settlement. Scenario state also published before history. Corrections introduce canonical preparation gating for Sea/Thread readers and one atomic Scenario/status publication, serialize world mutations, replace wall-clock windows with stream sequences, revalidate sources/cast, invalidate derived memory on correction, remove private goals/relationships from shared Director input, preserve development witnesses, route maintenance through the shared cancellable bounded provider queue, preserve legacy Thread scope, and remove a false retry promise.

New production-path regressions first failed for same-millisecond event loss, visible partial reflection and source-retraction races. Post-repair focused tests: **42 passed / 5 files**. Updated process crash verifier: **15/15 PASS**, now requiring zero canonical output before publication. Scenario failure injection checks unchanged entity/history before retry and one recovered publication. No new native Scenario SIGKILL or mounted UI result is claimed.

Remaining V08 blockers are explicit: missing coherent opt-in for Threads-only privacy; Dreamer lacks continuing-person context and resolution rows do not resolve loops; arbitrary generated prose still gains historical authority; Scenario goals/conclusion do not recompute after source correction; existing-person goal updates are unsupported; bounded backlog/retry/resource behavior and live product verification are incomplete. These are not deferred to V09.

Real-provider rerun: `node scripts/verify-v08-real-model.cjs` exited 2, `LIVE_MODEL_EVIDENCE=BLOCKED`, with no derived/evolution rows and bounded failures in disposable profile `v08-real-G4193P`. The configured localhost:11434 endpoint could not be reached from this environment. The supplied Electron script directly invokes a captured registered handler inside Electron; it does not prove renderer IPC transport or mounted Conversation behavior. Prior row-count PASS labels do not certify semantics.

Validation logs: `/tmp/v08-review-{red,focused,full-tests,typecheck,build,crashes,real-model}.log`. Full suite after the main repairs: **425 passed / 3 skipped files; 6,795 passed / 21 skipped tests**. Both TypeScript configurations and production build pass (existing large-chunk warning). Final small-guard/UI checks are recorded below. Tests used disposable profiles only. No migration obligation was invented for unreleased intermediate formats; no original user profile was changed.

Final small-change checks: **49 passed / 6 targeted files** (including mounted Details tests); both TypeScript configurations pass. `git diff --check` and all six locale JSON parses pass. These checks do not close the V08 blockers.

## V08 — Submitted remediation, 2026-09-16 (historical claim; superseded below)

Continued from the dirty checkout; all Astra repairs preserved; no reset, no V09 work, no commit/push/deploy. This round resolved the four remaining V08 blockers through production paths and re-verified everything, including Astra's regressions.

### B1 — Coherent Threads-only vs Living World boundary
- One central opt-in: `Settings.livingWorldEnabled` (default **false** = Threads-only), enforced main-side via `src/shared/livingWorld.ts` (`livingWorldEnabled` / `requireLivingWorld`). No per-feature matrix.
- Gated entry points (consent off → reject/no-op with the consent error): `createPersistentRoom`, `createRoom`, `activateScenario` (persistent scope) and `prepareScenario` (persistent scope, rejects at request time before inference spend), `applyMembership` 'add', `createParticipant` kind 'persistent', `rememberThis`, `integrateThread` (async rejection before any queue wait or world read), sea-scope `JOURNAL_APPEND` (renderer path), `dreamerRuntime.runMaintenance` (covers `WORLD_TRIGGER_REFLECTION`, idle scheduler and integration triggers for both scopes), `schedulerRuntime.reconcileAll` (whole pass — no proactive initiative, no autonomous maintenance), `reconcilePendingMaintenance` (deferred; pending records resolve on the next consented startup).
- Deliberately ungated (audited): read paths, membership 'remove', `updateParticipant`/`deleteParticipant` on existing people — user data management of already-existing state, never world extension. Service-level `runReflection`/`evolveScenario` exports have no production callers outside the gated runtime wrappers (caller map verified by grep); they remain DI seams for tests.
- Renderer consent surfaces (route to consent; never the boundary): New Conversation persistent scope heads-up + "Enable Living World and continue", IntegrationModal consent block, App first-entry prompt for persistent Rooms. Locales: `mlearn.ConversationAgent.LivingWorld.*` in all six languages.
- Tests: consent off — createPersistentRoom/applyMembership-add/rememberThis/createRoom/createParticipant-persistent/integrateThread reject with no world mutation; consolidateContext makes zero model calls (Sea + sandbox); scheduler runs no proactive reconcile and no consolidation. Consent on — all prior behavior. 19 worldIpc tests, integration/dreamerRuntime/schedulerRuntime fixtures updated.

### B2 — Person-grounded reflection
- Per-owner reflection now carries continuing-person context computed canonically: `personalHistory(ownerId, context)` unions the context stream with all other Rooms' Sea streams + world continuity (Sea only), filtered to rows the owner owns AND witnessed, minus tombstoned/superseded rows. Thread contexts stay thread-local (sandbox isolation unchanged).
- `makePrompt` includes owner persona, prior derived beliefs (capped 12), and the owner's currently-open loops; `validateDerived` enforces per-belief/per-resolution `sourceEventIds ⊆` the owner's visible window — fabricated or foreign citations reject the whole output (bounded per-owner retries, then honest window close).
- Cross-Room propagation test: Room B reflection prompt carries the owner's Room A prior belief/open loop and never another person's private rows; second person in Room B receives none of it. Compiled context already filtered cross-Room by witnesses.

### B3 — Real open-loop lifecycle
- Typed `resolution` rows (`ResolutionPayload`: ownerId, loopId, status satisfied/cancelled/contradicted/superseded, text, per-item sourceEventIds) close an owned open loop; `openLoopStates` derives current loop state (latest valid resolution wins, owner-matched); `deriveRoomProjection`/compiled context expose only currently-open loops; loop history rows are preserved.
- Model names the target loop by 1-based ordinal in the prompt's openLoops list; canonical code maps ordinal → journal id. When the owner has no open loops the output contract omits `resolutions` entirely. Numeric-string ordinals are coerced; range violations reject.
- Belief supersession: `supersedesEventId` (validated against the owner's prior derived rows) tombstones the replaced belief in the projection while journal history stays intact.

### B4 — Model prose never becomes history
- Reflection output kinds restricted to belief/open-loop/relationship — `episode`/`fact` are rejected (adversarial test: hallucinated occurrence prose cannot become episode/lore rows). All beliefs/resolutions must cite events from the owner's entitled view; reflections can only ever append `memory.belief`/`resolution` rows (occurrence types structurally unreachable).
- Scenario evolution: typed proposal `{developments[loop→sourceEventIds], goalUpdates, retractions, concluded, reopened}`; `fact` kind deleted; every development/retraction/conclusion/reopen must cite events from the shared window; retraction targets must be developments currently in force. Authoritative current state derives via `authoritativeScenario` (shared/scenarioState.ts): retracted/tombstone-invalidated entries leave the current view; the stored chain is never rewritten; `status` derives (concluded only while a valid conclusion stands).

### B5 — Scenario correction and reopening
- Correction is pure derivation: a correction tombstoning a cited source drops that development/goal change from the authoritative view with no entity write and no journal rewrite; the evolution pass and compiler consume the derived view.
- conclude → reopen → retract-reopen ordered case verified; correction-of-conclusion auto-reopens while the stored chain keeps the conclusion; existing-person scenario goals (`ParticipantRef.goals` + `ScenarioGoalChange` chain) apply without touching base persona.

### Verification evidence (this round)
- Full suite: **425 passed / 3 skipped files; 6,828 passed / 21 skipped tests**. Both TypeScript configurations pass; production build passes (pre-existing large-chunk warning); `git diff --check` and all six locale JSON parses pass.
- Astra regression re-run: `scripts/verify-v08-maintenance.cjs` **15/15 PASS** on the final build (zero canonical derived rows before recovery; per-window idempotent replay; loop resolution exercised via ordinal-mapped fake output).
- Real provider: `node scripts/verify-v08-real-model.cjs` → **exit 0, `LIVE_MODEL_EVIDENCE=PASS`, `LOOP_RESOLUTION_EVIDENCE=PASS`** on real local `gemma3:4b` through the production `ollamaService` path: committed per-person reflections (owner-scoped beliefs with valid per-item citations), a committed loop resolution mapped by code to the seeded loop id, and a committed cited scenario evolution (progress, no conclusion, no mandatory drama). Evidence only counts reflection-provenance rows — seeded fixtures are excluded. Earlier runs of the same script failed honestly (model emitted `status: "open"`, hallucinated loopIds, string ordinals) and were recorded, driving the prompt/ordinal clarifications without loosening validation.
- Mounted Electron: `node scripts/v08-mounted-electron.cjs` → **`MOUNTED_ELECTRON_EVIDENCE=PASS`** — real built app in dev contract (vite :3000 + `NODE_ENV=development`), disposable APFS-cloned profile (original untouched), real renderer UI driven over CDP: EULA/intro gates → sidebar click selects the persistent Room → real user message → real character reply committed to Sea → **automatic** main-owned reflection derived rows (no manual trigger) → reload → remount → Garden continuity + history → second real exchange in the same continuity. All reply waits assert new `message.character` rows specifically; failures dump UI state.

### Limits and blockers recorded honestly
- gemma3:4b is unstable against the strict reflection contract (intermittent malformed JSON, wrong key names, hallucinated loop ids across attempts); per-owner bounded attempts and the ordinal contract make committed output trustworthy when it lands, and failures close windows honestly. No model-quality certification beyond the recorded samples.
- Proactive initiative remains pre-V08 machinery with its own opt-out (`proactivityEnabled`), now subordinated to Living World consent at the scheduler.
- Older V08 limits not addressed this round (mounted maintenance Details surfaces beyond status, A20/A21 full invalidation propagation, voice/group/media/migration waves) remain open at full acceptance scope. All A01–A45 remain open; V09 remains unauthorized.
- Tests used disposable profiles only; the mounted run reads the installed runtime via an APFS clone and never writes the original profile. No commit, push or deployment was made.


## V08 — Re-review after remediation, 2026-09-16 (historical blocked verdict; superseded below)

**V08 still blocked.** Full findings, repaired defects, retained limitations and exact counterexamples are in the [authoritative re-review](CONVERSATION_LIVING_WORLD_V08_REVIEW.md#v08-re-review-after-remediation--2026-09-16-authoritative).

Repairs on the existing dirty checkout: direct-service and startup-integration consent gates; revocation rechecks through queued creation/inference and persistent Scenario preparation; temporary-person promotion gate; exact capped ordinal mapping with durable owner-context hashes; shared Scenario prompt exclusion of private goals and pre-join developments; real-message correction ownership; lifecycle replay after reopening retraction; invalid superseder handling; strict per-goal citations/arrays; honest evidence harness checks. Disposable Thread use and Room-first persistent Scenarios remain intact. No new feature-toggle matrix, migrations, V09 or V10 work.

Evidence by layer:

| Layer | Fresh result | Meaning / limitation |
|---|---|---|
| Regression/full suite | **6,843 passed / 21 skipped; 425 passed / 3 skipped files**, 39.49 s | Fifteen new tests and strengthened old tests. Logs `/tmp/v08-rereview-{red,red2,recovery-red,corrections-red,queue-red,prompt-red,parser-red,prepare-red}.log` record reproduced failures; final suite `/tmp/v08-rereview-final-tests.log`. |
| TypeScript | Both configs pass | `/tmp/v08-rereview-final-typecheck.log`. |
| Production build | Pass; existing large-chunk warning | `/tmp/v08-rereview-final-build.log`. |
| Process crashes | **15/15 PASS** on final build | `/tmp/v08-rereview-final-crashes.log`; zero canonical rows at prepared B/C boundaries. Reflection matrix only; Scenario has filesystem-failure unit evidence. |
| Adversarial built production path | **exit 2, AUTHORITY_EVIDENCE=BLOCKED** | `scripts/verify-v08-authority.cjs` turns a suspicion into next-context history and closes the related loop without resolving evidence. `/tmp/v08-rereview-final-authority.log`. |
| Real local model | **Semantic FAIL**, structural exit 0; `gemma3:4b`, 37,018 ms | `/tmp/v08-rereview-real-model.log`: future layout plan becomes completed layout; considering the rake question becomes satisfied resolution. The harness now labels structural success separately and requires semantic review. |
| Submitted mounted Electron | Actual Electron/IPC transport; **claimed successful exchanges disproved** | Inspected `/tmp/v08-mounted-run10.log` and retained OS-temp profile `v08-mounted-JP5l2m`: both character texts are empty, and a committed Scenario invents a discussion of herbs/flowers from the user's rake question. |
| Tightened mounted harness | Syntax-checked, **not rerun** | Requires nonempty replies, committed maintenance, Scenario before reload, restored history and a second reply. No fresh mounted success claim. |
| Hygiene | Pass | Six locale JSON parses, evidence-script syntax, `git diff --check`. |

The remaining blockers are semantic authority for Scenario history and loop closure, durable dependencies on prior personal context, bounded automatic backlog/retry/projection recovery, and valid mounted product evidence. Model instability is acceptable only when it fails safely; the recorded commits do not. No original user profile was written, no commit/push/deploy, no unreleased-format migration. **V09 remains unauthorized.**

## V08 — Closure verification, 2026-09-21 (authoritative current)

**PASS.** Scope is limited to V08 automatic scoped reflection and persistent Scenario interpretation/evolution. V09/V10 were not begun or authorized.

| Layer | Fresh result | Evidence and meaning |
|---|---|---|
| Targeted regressions | **149 passed / 10 files** | Loop self-resolution/later-linked resolution, cross-Room dependency invalidation, projection rename recovery/idempotence, trigger follow-up and window bounds, scheduler fair bound, explicit failed-window retry, interpretation compiler/rendering, and Retry UI. `/tmp/v08-close-focused.log`. |
| Full suite | **441 passed / 1 skipped files; 7,252 passed / 9 skipped tests** | `npm run test`, exit 0. `/tmp/v08-close-full-tests.log`. |
| TypeScript | Both configurations pass | `npm run typecheck`, exit 0. `/tmp/v08-close-typecheck.log`. |
| Production build | Pass | `npm run build`, exit 0; existing chunk warnings only. `/tmp/v08-close-build.log`. |
| Process crash/recovery | **19/19 PASS** | Built services; five probes including SIGKILL after projection-store rename and before ledger settlement. Canonical rows remain hidden while pending; recovery commits exact drafts/marker and does not apply salience twice. `/tmp/v08-close-crashes.log`. |
| Authority probe | **PASS, exit 0** | `STORED_SCENARIO_INTERPRETATIONS`, `COMPILED_SCENARIO_INTERPRETATIONS`, `SELF_RESOLUTION_BLOCKED=true`, `LATER_EVIDENCE_RESOLVED=true`. `/tmp/v08-close-authority.log`. |
| Real supported model | **Structural PASS; semantic PASS after inspection** | `gemma4-e4b-q4:latest` through the built runtime/provider path; 23,839 ms; profile `v08-real-dFoCEe`. Four owner-scoped derived rows have valid citations; the rake resolution cites Eli's later explicitly linked repair message; two Scenario rows have interpretation authority. `/tmp/v08-close-real-model.log`, `/tmp/v08-real-model.json`. |
| Mounted Electron | **Transport PASS; semantic PASS after inspection** | Profile `v08-mounted-hDAP0L`; real main/preload/renderer/bridge/provider; nonempty first reply, automatic committed reflection/evolution, reload/remount, Room plus history visible, nonempty second reply. Two beliefs remain owner interpretations of witnessed dialogue; two Scenario entries are labeled interpretations. `/tmp/v08-close-mounted.log`, `/tmp/v08-mounted-record.json`. |
| Hygiene | Pass | `git diff --check`, six locale JSON parses, and syntax checks for every modified V08 harness. |

Production invariants verified:

- Scenario-generated prose has no occurrence authority: storage, journal payload, compiler, and UI retain `authority: 'interpretation'` and the UI explicitly says it is not established occurrence history.
- Loop closure requires later direct evidence structurally linked by `replyToEventId` or correction target; prompt ordinals do not expose canonical loop IDs.
- Published derived state carries prior-context dependency edges; canonical cross-Room invalidation recursively removes descendants after correction without rewriting journal history or leaking another Room's rows.
- Runtime backlog work is bounded (three windows/pass, two coalesced passes, reschedule at the boundary); scheduler work is bounded/fair (eight Rooms/reconcile); failed windows reopen only through durable explicit retry.
- Projection mutation and its operation marker publish atomically before settlement, making the recovery call exactly-once in effect.

No original profile write, commit, push, deployment, V09, or V10 work occurred. Full A01–A45 acceptance remains outside this narrow V08 verdict.

## V09 — Autonomous living-world closure verification, 2026-09-21 (authoritative current)

**PASS.** This closes the V09 autonomous-world wave only. V10 proactive contact is neither implemented nor claimed.

| Layer | Fresh result | Evidence and meaning |
|---|---|---|
| Focused regressions | **50/50**, then **44/44** | Autonomy service/runtime, scheduler, shared foreground/background queue, fair bounded wait, exact authority, V08 occurrence consumption, and repair-prompt regressions. |
| Full suite | **443 passed / 1 skipped files; 7,277 passed / 9 skipped tests** | `npm test`, exit 0, 40.63 seconds on the final documented tree. |
| TypeScript | Both configurations pass | `npm run typecheck`, exit 0 after final production changes. |
| Production build | Pass | `npm run build`, exit 0; existing Vite dynamic-import/chunk warnings only. |
| Authority/adversarial probe | **PASS** | Final `node scripts/verify-v09-authority.cjs`: same-Room trigger join, grounded intention/episode, exact event-ID certification, actual witnesses, invitee privacy, forged-row quarantine, no-work zero inference, malicious-user rejection, and stale foreground cancellation. Profile `v09-authority-Zqp3GB`; episode `autonomy_ebee277ca5ae67b5df9545ba21733831`; occurrence `evt_muairwud_7_x9jifcld`. |
| Process crash/recovery | **A/B/C all PASS** | `node scripts/verify-v09-crash.cjs`: SIGKILL during inference leaves no half-authority; partial physical rows remain wholly hidden; atomic commit exposes exactly one episode; fresh recovery/replay produces one occurrence and four exact certified rows without duplication. |
| Real supported model | **Structural PASS; semantic PASS after inspection** | `node scripts/verify-v09-real-model.cjs`, local `gemma4-e4b-q4:latest`, profile `v09-real-model-xy2F2S`. Mara's grounded intention leads to a bounded seed-sorting episode with Eli; user absent, private Mara disclosure absent from Eli input, exact occurrence cited by a V08 resolution, and later response accurately consumes the occurrence. |
| Mounted Electron | **Transport/lifecycle PASS; semantic PASS** | `node scripts/v09-mounted-electron.cjs`, profile `v09-mounted-pSa2NB`, record `os.tmpdir()/v09-mounted-record.json`. Actual main/preload/renderer/bridge/provider; foreground 6,324 ms; window-close background continuation; exact episode certification; V08 consequence; full termination and byte-stable journal; restart; Details pause persisted; later recall 12,332 ms; no proactive rows. Teardown check found zero test Electron processes. |
| UI and privacy | **PASS** | Details shows compact autonomy state and pause/resume without private contents. Six locales parse. Participant contexts are compiled independently; absent/user/private-state adversarial tests pass. |
| Hygiene | **PASS** | Evidence scripts syntax-check; `git diff --check`; no original-profile write, commit, push, deployment, or migration. |

Authority findings:

- `occurrence.simulated` and intention rows are main-owned. Renderer append IPC rejects both event types and any `autonomyJobId` provenance.
- Physical NDJSON presence is insufficient: canonical readers require a committed job and exact membership in its `eventIds`. A forged row naming a real committed job remains quarantined.
- Prompts never assign witness/actor authority. Code owns lead/invitee identity; a decliner is a witness/respondent but not an action actor. User-action claims and unauthorized affected participants fail validation.
- Prepared drafts stay noncanonical until atomic job settlement. Recovery publishes only the previously validated exact drafts and revalidates consent, Room/person revisions, sources, active intention/open-loop state, and newer foreground activity.
- Dreamer remains downstream interpretation. V09 occurrences may structurally resolve linked V08 loops; Dreamer cannot create occurrences.

Boundedness and lifecycle findings:

- One global background autonomy inference and per-Room join prevent duplicate concurrent jobs; scheduler work is capped and round-robin. Foreground requests are inserted before queued background requests.
- A model may wait once, retry once after 60 seconds, then that job becomes terminal. Fair selection advances to another grounded person. Resource blocks back off durably; no eligibility performs no inference.
- Full process absence never becomes simulated elapsed activity. Startup heals a bounded set of prepared or committed episode Rooms, while the seven-day catch-up cap prevents indefinite replay.
- `worldAutonomyEnabled` is a distinct persisted pause under the existing Living World consent gate. It does not create V10 schedules, notifications, calls, messages to the user, or contact delivery.

Semantic review of the final real-model and mounted records found ordinary plausible activity grounded in supplied seed-library materials; no user impersonation; participant disagreement preserved; no private-text disclosure; no mandatory drama; later continuity based on the authoritative occurrence. The mounted V08 consequence cited another exact certified row from the same episode; the separate real-model gate proves exact occurrence citation and loop resolution.

HANDOFF_VERDICT=PASS
