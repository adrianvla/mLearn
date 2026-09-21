# V09 adversarial review — 2026-09-21

**Current verdict: PASS.** V09's main-owned autonomous living-world loop is production-path complete within its defined wave. The accepted V08 distinction remains strict: V09 may publish a validated simulated occurrence; V08 may interpret or resolve from it but cannot invent one. V10 proactive contact, notification, call and voice behavior is excluded.

## Architecture reviewed

The review traced current ownership rather than treating the new service as an isolated feature: `main` startup/quit, scheduler cadence and resume hooks, shared LLM queue, renderer foreground turns, per-person context compilation, journal canonical projection, world mutation/atomic rename, V08 consolidation and invalidation, preload/bridge authority, Settings reconciliation, and Details UI. The live path is:

`schedulerRuntime` → `autonomyRuntime` → `autonomyService` → `llmRouter.completeJob(background)` → hidden prepared journal rows → exact `world.json` job commit → canonical journal projection → V08 consolidation → later `compileContext`.

There is no renderer-owned autonomy loop and no V09 call into legacy proactive schedule/contact delivery.

## Adversarial findings repaired

1. **A job ID was not enough authority.** Canonical journal reads now require both a committed job and exact membership of the row ID in that job's certified `eventIds`. A forged row carrying a real job ID stays quarantined. Renderer IPC rejects V09 event types and autonomy provenance.
2. **Partial physical publication could have looked authoritative.** Prepared drafts are private durable job content. Rows appended before the world commit are filtered from every canonical read. Recovery verifies exact draft equality and publishes/commits idempotently; it never re-infers prepared work.
3. **Foreground races could publish stale offscreen work.** Candidate sources, participant/Room revisions, consent, open-loop/intention state, and newer foreground events are checked before inference, preparation, and the atomic status transition. A race injected during the model call cancels without occurrence publication.
4. **Prompt output could assign authority.** Code fixes actor/witness identity and validates affected participants, exact sources and optional invitee. User participation/action claims fail closed. Invitees receive only their entitled compiled perspective and the direct proposal; lead private disclosure text is rejected if copied into shared action/message output.
5. **Declining invitees were incorrectly counted as action actors.** A decliner remains a witness and message actor but is not listed in `occurrence.payload.actorIds`. The intention becomes revised rather than falsely completed.
6. **Repeated “wait” risked polling and unfairness.** Each job can defer once and retry once after a durable 60-second backoff. The second wait is terminal. Agent-interest selection then advances fairly to another grounded person unless the trigger already produced an intention.
7. **Background work could compete with foreground.** The existing LLM router now has explicit foreground/background queue priority. V09 permits one global autonomy inference and joins concurrent same-Room triggers. Scheduler work is capped and round-robin.
8. **Crash after occurrence commit could miss V08 consequences.** Startup revisits a bounded newest set of committed episode Rooms; ordinary V08 markers make the healing pass idempotent.
9. **Small-model schema retries repeated the same V08 prompt.** The existing three-attempt V08 bound remains unchanged, but repair attempts now explicitly require exact IDs/citations and complete relationship fields. Validation was not loosened.
10. **Mounted evidence harnesses leaked interrupted Electron groups.** Explicit SIGINT/SIGTERM teardown was added. All three identified disposable groups were stopped, the final harness teardown completed, and a process check found zero V09 Electron instances.

## Production behavior and bounds

- Eligibility is deterministic and requires a real foreground user/character exchange. Candidate families are agent interest, active intention follow-through and structurally open loops.
- Intentions are owner-private lifecycle events with grounding/source provenance. Episodes affect at most the lead and one invited participant. No cast creation, external action, user contact or background learner-evidence fabrication is permitted.
- One Room pass considers one job. The scheduler considers two Rooms per reconciliation; startup heals four. Context/source/output/model-repair/durable-retry/follow-through/catch-up limits are named constants and exercised by tests.
- A separate persisted `worldAutonomyEnabled` pause is enforced under the existing `livingWorldEnabled` outer consent gate. Details exposes operational status and pause/resume, not private thoughts or model prompts.
- Actual simulated occurrences enter only entitled participants' later `witnessedOccurrences`. Corrections/tombstones remove the occurrence and its V08 descendants from canonical projections without rewriting raw history.

## Evidence

- Focused final regressions: 50/50 autonomy/runtime/scheduler/router and 44/44 autonomy/V08-reflection after repair-prompt hardening.
- Full suite: **443 passed / 1 skipped files; 7,277 passed / 9 skipped tests**, 40.63 seconds on the final documented tree.
- Both TypeScript configurations pass. Production build passes with existing Vite import/chunk warnings only.
- `verify-v09-authority.cjs`: PASS for joined concurrency, grounded intention/episode, exact certification, witnesses/privacy, forged provenance, no-work, malicious user and stale completion.
- `verify-v09-crash.cjs`: A/B/C PASS across inference SIGKILL, partial physical publication and post-atomic-commit SIGKILL; recovery/replay yields one occurrence and four certified rows exactly once.
- `verify-v09-real-model.cjs`: structural and semantic PASS with installed `gemma4-e4b-q4:latest`; profile `v09-real-model-xy2F2S`; exact occurrence-citing V08 resolution and later grounded recall.
- `v09-mounted-electron.cjs`: PASS on disposable profile `v09-mounted-pSa2NB`; real main/preload/renderer/bridge/provider; foreground 6,324 ms, closed-window episode, V08 consequence, full termination with byte-stable journal, restart, persisted UI pause, later recall 12,332 ms, no proactive rows. Record `os.tmpdir()/v09-mounted-record.json`.

## Scope boundary and residual risk

The real model may validly wait, abandon or decline; several disposable runs demonstrated those fail-safe branches before the successful mounted sample. This is not hidden as deterministic behavior. The final semantic sample is evidence that a grounded path works, while deterministic tests establish authority and failure behavior.

This PASS does not certify the entire A01–A45 program. It does not add or authorize V10 proactive messages, notifications, incoming calls, voice/audio transport, Mission/Campaign machinery, human group transport, or migration of unreleased intermediate formats. No original profile was written. No commit, push or deployment occurred.

HANDOFF_VERDICT=PASS
