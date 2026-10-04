# Flashcard Review interaction ownership

The displayed encounter owns its captured card, learning decision, package-declared task capabilities, and knowledge presentation. A cursor acknowledgment, journal revision, or knowledge refresh does not create another encounter. Rating advances the encounter locally; durable persistence runs behind it.

## Presentation and evidence

`FlashcardReview` pins a physical encounter in `useDecisionPin`. The card and materialized knowledge used by `FlashcardWordTitle` are snapshots. If knowledge has not hydrated when the encounter is selected, its presentation stays neutral for that encounter. The next encounter can use newer knowledge.

The rating profile is selected once for the encounter. An asynchronous graph projection resolves once for that encounter and controls evidence admission, without changing the displayed rows. Ratings require a successful projection and supported capabilities. Unknown package capability identifiers remain open-ended. Live knowledge consumers outside review keep their journal/threshold subscriptions.

The interaction phase is question, revealed, or complete. Pending cursor, assistance, rating, removal, and retraction writes do not supply additional presentation phases. Failures remain visible and recoverable, with controls blocked where continuing would compromise correctness.

Actual peer card edits, schedule changes, removal, exclusion, or task changes invalidate the encounter. Derived retention-cache changes and cursor updates do not. A peer rating must retire a revealed encounter even when the card remains in the learning queue. A conflicting successor cursor is recovered explicitly by adopting the saved peer position.

## Persistence

`FlashcardContext.submitRating` applies the existing sparse optimistic rating command and returns a durability receipt. The command carries evidence, decision audit linkage, scheduler changes, Undo, and assistance provenance. Requested assistance and restored assistance use the same background command; they do not require a separate acknowledged interaction route.

The receipt resolves successfully only when the command is acknowledged or committed. Recoverable I/O failures retain the receipt and assistance through persistence retry; terminal admission refusals resolve it unsuccessfully. Undo, crash recovery, and stale-write validation continue to use the existing authoritative writer and journal.

Review cursor writes use `flashcards.saveReviewPresentation`, a sparse command containing the captured card, decision, and expected cursor owner. They bypass the renderer whole-store save/flush/reconciliation path. At the authoritative writer, earlier admitted ratings settle first; an obsolete cursor for a changed card is discarded, and a competing cursor owner is rejected. Successful cursor writes broadcast a sparse commit. Atomic library disk writes still occur and can be slow, but they are not awaited by the next local rating interaction.

Answer exposure is a monotonic local recovery marker keyed by physical encounter. It requires no shared cue read/modify/write lock, so revealing the answer cannot queue behind automatic audio or delayed cue cleanup. Shared assistance still merges under its existing lock. Cleanup runs after durable rating acknowledgment and compares both cue revision and exposure revision, preserving newer peer exposure. Audio that has not actually been admitted/played is not fabricated as assistance.

## Verification boundary (2026-10-03)

Real Electron validation used isolated copies of the existing 1,202-card persisted library, journal, installed language packages, settings, and media. No acceptance ratings were intentionally applied to the original profile. The copied settings enabled auto-TTS but muted it; both the normal copied configuration and an additional unmuted auto-TTS run were exercised.

The final unmuted run completed 20 consecutive ordinary ratings with 1.1 seconds question dwell and 0.35 seconds revealed dwell. Keypress to next usable question, sampled at animation frames: p50 17.3 ms, p95 24.7 ms, maximum 28.3 ms. Whole-store operations around 1.6–1.8 seconds continued in the background. DOM captures recorded only question/revealed phases, no status banners, and no same-encounter word, title-color, or rating-profile changes. These are local measurements, not a universal latency guarantee.

All 20 ratings had journal decision-audit links and durable Undo records; 13 recorded audio assistance. After draining background work, no rating commands remained uncommitted and SQLite quick_check returned ok. Live Undo returned the actual rated card. A forced process kill/restart restored the exact undone encounter ID and revealed-answer state. Two real Electron renderer windows exercised peer rating invalidation, cursor conflict, and explicit recovery to the authoritative successor.

Automated validation: 631 tests across 13 directly affected suites passed, plus 68 provider persistence/recovery/Undo cases. Both TypeScript configurations, the production build (including its splash asset check), and diff checks passed. The complete provider suite has four unrelated grammar-panel failures (374 passed); the same four failures were independently reproduced on the untouched starting implementation and tests. Those failures are outside this cleanup.

Missing images remained a local image-unavailable state. Unrelated Anki synchronization failures did not supply review phases. Desktop and 580-pixel narrow screenshots were inspected. Baseline runtime capture stopped after seven ratings when the question disappeared following a cursor-save failure; it is not a completed 20-rating baseline or a comparable tail-latency sample.

## Follow-up: inactive-window work and Guardian accounting

The first acceptance trace measured the local transition, but did not establish main-process responsiveness between ratings. Follow-up CPU profiling found knowledge-change broadcasts repeatedly refreshing the inactive Welcome curriculum collection. Its `getEvidenceLinkedSurfaces` call scanned addressed journal records synchronously in the main process. About 25.5 seconds of a 50-second profile were spent in that scan, with a maximum event-loop delay of 1,574 ms. Approximately 8,300 projection requests were made during 20 ratings (the diagnostic handler wrappers in that baseline counted each call twice).

`useWindowActivity` now lets the shared collection readers run only while visible and focused. Blur cancels the remaining asynchronous projection fan-out; journal changes and query changes accumulate without restarting background collection reads. Focus consumes deferred invalidations; a clean focus reuses the completed collection. The small authoritative store commits still propagate, preserving peer-rating invalidation and stale-write correctness. Cursor-only commits no longer reload durable Undo history.

After the change, another 20-rating profile made zero journal-key/collection-link requests in the inactive main window and exactly 20 encounter projection requests. Maximum main-loop delay fell to 157 ms; remaining whole-store serialization/copy work is still synchronous. A separate focused, unmuted auto-TTS run measured p50 25.3 ms, p95 34.0 ms, and maximum 47.8 ms, with no within-encounter identity/color/profile changes or normal status banners. These measurements include different diagnostic overhead and are not a claim that the earlier 17.3 ms median improved further. Main-window focus catch-up completed and displayed the updated learner summary.

Restarting the original acceptance copy exposed an independent Guardian accounting bug: a retried observation was deduplicated by SQLite, but the service counted the proposed row as new evidence in the ledger. A regression test reproduced one stored row and a ledger count of two, causing the same evidence-loss block on restart. `appendKnowledgeEvents` now counts actual inserted sequence reservations and suppresses invalidations for zero-insert retries. Guardian's loss checks remain unchanged. The blocked `/tmp/mlearn-review-after` copy was preserved without snapshot restoration; follow-up profiling used a separate copy with its own Guardian baseline. After the fixed runs, its ledger/evidence counts agreed, SQLite quick_check returned ok, and no rating commands remained pending.

The follow-up profile restarted successfully after both fixed 20-rating runs and restored the exact saved question ID (`9a03d4d8-13d3-4703-8a48-a5875a413a95`) and face-down state. The earlier blocked profile was not repaired by discarding its ledger or rolling back learner data.

Follow-up automated checks passed: 261 tests across eight projection/activity/Guardian/storage/review suites, plus 68 provider recovery tests, both TypeScript configurations, and the production build. The idempotent-append regression includes Guardian preflight after retry; activity tests cover blur cancellation, inactive journal reads, coalesced revisions, focus catch-up, and listener cleanup.

## Event-driven focus and startup writes

A completed collection request is retained across blur/focus. Journal revision, language, query, threshold, and explicit retry changes invalidate it. While inactive, journal requests retain their admitted source; focus admits only the latest deferred revision. Interrupted projection batches resume against current inputs. Focus itself is not an invalidation, and cached failures still require explicit retry.

The loader compares normalized values without relying on object field order, and combines image extraction with normalization into one migration write. Capability and grammar materialization still replay authoritative evidence on startup, including journal-only keys and crash recovery, but only assign changed records and schedule a save when the materialized cache actually changes. An empty grammar replay no longer schedules a full-store save.

Real Electron checks on the same large copied library: five clean blur/focus cycles made zero IPC requests; 20 ratings while the main window was inactive caused zero journal-key or linked-collection reads there. Focus flattened those events into one journal-key read and one linked-collection read. After catch-up completed, another five clean focus cycles made zero additional IPC requests.

The 20-rating unmuted auto-TTS run measured p50 26.2 ms, p95 33.6 ms, maximum 33.9 ms. DOM observations contained only question/revealed phases, no status banners, and stable encounter identity/title presentation. Restart restored the exact saved encounter (`bbcbf008-488b-43be-90bf-5b4d8c2778fb`, 感動), face down. No rating commands remained uncommitted, SQLite quick_check returned ok, and Guardian startup succeeded. The first restart after those ratings performed one cache reconciliation save; the subsequent unchanged cold startup and clean main-window reload performed zero full-store saves. Actual changed caches and migrations remain durable.

Checks passed: 136 tests across storage/activity/projection suites, 88 provider recovery/persistence/provenance cases, both TypeScript configurations, production build and splash check, and diff check. A broader provider selection passed 109 cases and reproduced the same four pre-existing grammar-panel failures documented above. Raw diagnostics and DOM evidence are saved under the local acceptance artifact directory `flashcard-review/focus-startup`.


## Full-history predictive rebuild regression (2026-10-04)

Commit `ecf51d23` added a full retained-addressed-attempt query and predictive fit to `getLearningEvidence`, called synchronously by Electron's learning-evidence IPC handler after journal changes. The large persisted journal returned 429,219 addressed rows containing 720,865,236 bytes of JSON. Read-only probes took 2,095–2,158 ms for SQL alone. A delayed asynchronous filesystem continuation can therefore include unrelated main-loop work in its `write+rename` interval; that log interval does not isolate disk latency.

`LearningEvidenceReader` now owns a single read-only worker. The worker queries and fits within one WAL read transaction, pins provenance to the transaction's sequence counter, caches a settled same-language/same-sequence result, and never migrates or writes the journal. Concurrent same-language/revision requests share one promise; worker failures reject callers and explicit retry starts a fresh worker. Full retained evidence and exact retractions remain inputs, including attempts outside the bounded IPC tail. Addressed rows stream through the reader rather than retaining the entire raw SQL result alongside parsed events.

`useLearningModel` retains the last settled same-language model while a journal refresh is pending. Advancing a review no longer waits for that rebuild; a language switch and a rejected read still withhold the model. Its fallback fit depends on the admitted snapshot, so starting a refresh cannot relabel or refit the previous snapshot. The pre-existing local clean-focus changes were preserved.

Verification used read-only probes against the large journal, then a complete isolated copy for Electron ratings, Undo, durability and restart. The worker rebuild took 4,220 ms while the caller's maximum heartbeat gap was 11.3 ms. Twenty consecutive Electron ratings measured p50 41.7 ms, p95/max 77.6 ms, with only question/revealed phases. Saves during that run were roughly 116–154 ms. Main-loop p99 was 14.0 ms, maximum 346.3 ms; synchronous store work still exists. Undo restored the prior encounter face down, zero rating commands remained pending, SQLite quick_check passed, and restart passed Guardian and restored the same encounter ID and question phase.

The readiness regression test fails with the old implementation. The six focused suites passed 297 tests, including the IPC boundary against synchronous rebuilds and worker-startup failure/retry. Both typechecks, production build/splash check, and diff check passed. Rebuild time itself remains several seconds in the worker, and initial model admission still awaits the first fit. An unrelated AnkiConnect error and retried stale whole-store revisions occurred in the isolated run; this change does not claim to resolve those paths. The first incomplete test copy was correctly blocked by Guardian; validation used a subsequent complete copy without restoring learner data or bypassing protection. Raw evidence is under the local 2026-10-04 `rating-regression` artifact folder.
