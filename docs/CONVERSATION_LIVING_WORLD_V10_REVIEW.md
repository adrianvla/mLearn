# V10 adversarial review — 2026-09-21

**Current verdict: PASS.** V10's proactive contact and incoming-call wave is production-path complete within its defined boundary. V08 remains interpretation/reflection authority; V09 remains the only new simulated-occurrence authority; V10 may derive a contact only from existing authoritative state and may not manufacture a second social world.

## Architecture reviewed

The review traced scheduler ownership, foreground/background model priority, settings/consent revalidation, per-participant context compilation, canonical journal projection, atomic world persistence, Electron notification lifecycle, custom-protocol activation, preload/bridge authority, Conversation renderer ingress, existing voice transport, erasure, app quit/restart, and actual macOS delivery.

The production flow is:

`schedulerRuntime` → deterministic cause eligibility → `contactRuntime` → `contactService` → existing `compileContext` → shared background `llmRouter` → strict proposal validation → hidden prepared Room row → exact contact-ledger commit → bounded Electron `Notification` delivery → notification/deep-link activation → exact existing Room/event or incoming offer → explicit accept → existing `VoiceTab`/`runConversationTurn`/journal.

Legacy unreleased scheduler/contact event formats were removed rather than migrated or wrapped. There is one durable contact family and no notification-only dialogue or voice-only identity/memory store.

## Adversarial findings repaired

1. **Canonical contact had to precede OS delivery.** Contact preparation now persists an exact draft privately, appends idempotently, and publishes authority only by atomically recording the exact event ID. Physical partial rows are filtered from all canonical readers.
2. **A contact ID alone was insufficient authority.** Canonical contact rows require a nonterminal/committed contact record and exact membership in `eventIds`. Renderer journal IPC rejects contact event/provenance authority and snapshots never expose prepared drafts.
3. **External display cannot honestly be exactly once.** Known interruption before the external call may retry once under the same stable notification ID. Once display is `delivery-unknown`, it is not replayed. Canonical contact is exactly-once and remains usable when notification is denied or unsupported.
4. **Generation could have become engagement prompting.** Eligibility requires a real relationship exchange plus a committed occurrence, active intention, or open loop. `nothing` is durable. The prompt and structural validation reject generic return prompts, crisis, urgency, guilt, jealousy, dependency, relationship pressure, false user action, and external-action requests.
5. **Private world text could have leaked through prompts or previews.** Generation uses the contacting participant's existing compiled view and exact visible sources. Unrelated private disclosure copying fails. Notification preview contains only display name and message/call kind.
6. **Queued contact could become stale.** Candidate source hash, semantic Room/person revisions, foreground head, exact source presence, correction/retraction state, active loop/intention and all controls are checked at preparation, atomic publication and delivery. Foreground activity supersedes stale work.
7. **Retry could create another Room or invitation.** Cause-derived operation/contact ID, per-Room in-process joining, serialized world mutation and exact prepared replay yield one existing Room, one contact and one journal event across concurrency/restart.
8. **Calls initially entered voice without explicit consent.** `callId` ingress now renders an incoming offer only. The renderer calls main to accept/decline; VoiceTab mounts only after successful acceptance. Microphone permission is requested by ordinary voice start after that point.
9. **Expiration left a stale live notification.** Delivery reconciliation now closes/removes notifications when contact expires or is suppressed. Delivered/opened calls transition to missed after timeout and late acceptance fails.
10. **Mounted activation exposed a delivery race.** In a real dev-shell run, deep-link activation reached `opened` while startup delivery still held a stale `ready` snapshot; its mutation overwrote the state to `attempted`/`delivery-unavailable`. Final code computes the transition under the serialized live mutation, refuses opened/terminal downgrades, and emits externally only if that live transition actually began. A shown/unknown/unavailable contact also cannot be moved back to scheduled by a later quiet-hours/clock change. Two regressions and a corrected mounted replay pass.

## Durable model and bounds

- `ContactRecord` persists contact/operation ID, Room, participant, target actor, cause kind, exact source IDs/hash, semantic revisions, foreground head, effective/created/ready/attempted/delivered/opened/settled times, expiry, modality/call/message identity, delivery state/attempt count, current revision and transition history.
- Statuses cover proposed, ready, scheduled, attempted, delivery-unknown, delivery-unavailable, delivered, opened, accepted, declined, missed, expired, cancelled and superseded.
- One fair Room and one cause are considered per scheduler pass; one global contact inference is active. Input is capped at 12 source events/18,000 characters, output at 2,000 characters, schema repair at two attempts, delivery at two known-safe attempts, message expiry at 24 hours, call expiry at 60 seconds, cooldown at four/24 hours, and frequency at two contacts/person/day.
- Main delivery reconciliation runs before new V09/V10 inference. Full termination creates no local work. Resume expires stale records and cannot generate a backlog storm in one pass.
- Settings authority is layered: Living World consent, proactivity, LLM/provider policy, Room mute, person mute, call permission, quiet hours, destination/cause validity, then explicit call acceptance. Availability never substitutes for consent.

## Evidence

- Focused final contact service/runtime tests: **20/20**, including explicit backward-clock and multiple-expired-resume probes. Full final suite: **444 passed / 1 skipped files; 7,293 passed / 9 skipped tests**, 40.83 seconds.
- Both TypeScript configurations pass. Production build passes with only existing Vite import/chunk warnings. Signed packaged directory build completed for native notification evidence.
- `verify-v10-authority.cjs`: PASS for joined servicing, exact canonical identity/cause, privacy partitioning, stable bounded delivery, safe preview and idempotent activation.
- `verify-v10-crash.cjs`: B/C PASS for actual SIGKILL at partial journal publication and after atomic ready commit; one contact/event/attempt and repeated activation after recovery.
- Fresh real-model message through installed `gemma4-e4b-q4:latest`: Mara reports a specific duplicated seed accession grounded in the exact witnessed occurrence, discloses no Noa/private state, applies no pressure, and later continues the same resolution task. Separate forced-call seed produces a plausible in-app live pronunciation rehearsal call.
- Signed packaged macOS `mLearn.app`: actual Electron notification reached `show`/durable `delivered` with the safe preview. This native-display probe preceded the final activation-transition race repair; final source was rebuilt and the corrected race was replayed in mounted Electron. An automated literal Notification Center click could not be retained; production click callback and exact target are regression-tested, and real deep-link activation was mounted.
- Mounted disposable call snapshot `/tmp/v10-mounted-evidence.rw0Etu`: contact `contact_fa2aa17d630feef70fdb3d4bb431f5e0`, invitation in `room-v10-real`, Mara, explicit acceptance, acoustic speech, mlx Whisper final text, production model reply, persisted voice rows and audible system TTS. `verify-v10-mounted.cjs` passes all eight checks.
- Corrected mounted race: `contact_e1dcbedc15ccf3287fccc84a5b61e886` remained `opened`, `deliveryAttempts: 0` when startup reconciliation and deep-link activation overlapped.
- Six locale JSON files parse; V10 scripts syntax-check; `git diff --check` passes. Original profile was never written.

## Acceptance interpretation

- **A22:** exact-cause message, canonical persistence, real OS display, exact activation wiring/deep link, and meaningful same-situation continuation are established. The physical macOS click itself is composite evidence rather than one captured retained gesture.
- **A23:** quiet hours, mute, notification denial, resource denial, foreground resolution, clock/quiet transition, expiration/resume, bounded ringing/frequency and no decline relationship punishment pass.
- **A24:** actual process crashes prove hidden partial rows, exact recovery, no duplicate Room/message/invitation, bounded delivery, idempotent activation and safe erased/expired targets.
- **A25:** actual incoming offer and explicit acceptance continue the same participant/Room/situation/history through spoken input → STT → model → TTS → audible output. Decline, miss/timeout, cancellation, expiry, microphone denial and stale/superseded acceptance are covered by production-path regressions.
- **A26/A27:** V10 reuses the existing text/voice context and journal machinery. It does not newly certify every general multi-person voice capability.
- **A28/A29:** contact inference/delivery is bounded, fair, serialized, foreground-subordinate, exact-membership authoritative and crash/concurrency tested.

## Scope boundary and residual risk

The one explicit evidence limitation is the literal signed macOS Notification Center click. Actual OS display, actual product deep-link activation, actual incoming-call acceptance, and the exact production click callback each pass, but macOS did not keep a UI item accessible for automation. The V10 mounted stop condition allows notification activation **or** incoming-call acceptance; the complete accepted-call path passes.

No external email, SMS, telephone, messaging, purchase or app action exists. No V08/V09 semantics were redesigned. No compatibility layer for unreleased formats, original-profile write, commit, push or deployment occurred.

HANDOFF_VERDICT=PASS

## Final independent adversarial review — 2026-09-21

This review treated the implementation report above as a claim, reconstructed the live V08/V09/V10 ownership path, and introduced failing production-path regressions before repairing confirmed V10 defects. It did not alter V08/V09 authority, add a successor wave, or broaden product scope.

### Counterexamples found and repaired

1. **Competing Accept/Decline responses could both succeed.** Each response had read a stale `opened` snapshot before entering the world mutation, so the later save could overwrite the first terminal choice. Response validation and transition now happen in one serialized live mutation; exactly one terminal choice wins.
2. **A provider-policy change during contact generation could still publish.** The final settings check covered coarse enablement but did not recompute the real proactive/deferred inference policy. Publication, delivery, activation, and call response now re-evaluate the current application inference policy and fail closed.
3. **The structural pressure/action filter admitted concrete prohibited text.** `Everyone is waiting on you; don't let us down`, third-party phone requests, cash transfers, and external messaging-service instructions supplied reproducible counterexamples. The bounded validator now rejects those classes, while the prompt remains conservative and `nothing` remains first-class.
4. **Resume reconciliation scaled delivery work with every Room and could perform two external attempts for one selected Room in one pass.** Contact reconciliation is now round-robin bounded to one Room per pass, each Room reconciliation emits at most one external side effect, and recovery plus newly generated work share that one-attempt budget.
5. **A call from the second person in a multi-person Room could fall back to the first roster person's model, name, photo, and voice.** Successful acceptance now pins the authoritative `contact.participantId` through VoiceTab and the first `runRoomTurn` speaker. A renderer regression and an orchestrator regression prove that another roster person cannot replace the caller.
6. **An already-opened offer could be accepted after its cause was superseded or call consent was revoked.** Activation and response now revalidate expiry, exact destination, current policy, immutable source snapshot, correction state, active cause, Room/person revisions, and newer foreground activity inside the serialized mutation. Stale offers settle as `superseded` or `cancelled`; they do not start voice.

The source snapshot is retained exactly from candidate construction through publication and checked by hash, so a model-selected citation subset cannot silently weaken the authoritative cause. The mounted evidence verifier was also strengthened: same-person now requires the persisted voice reply actor, not merely the invitation actor.

### Independent evidence

- Red phase: five focused failures reproduced terminal-response overwrite, provider-policy bypass, group-guilt output, all-Room resume reconciliation, and wrong-person voice routing. Source tracing then identified two additional concrete counterexample classes—external phone/payment/messaging output and acceptance after foreground supersession—which received explicit final regressions.
- Final focused adversarial matrix: **71/71** across contact service/runtime, scheduler runtime, Conversation ingress, and Room orchestration.
- Final full suite: **444 passed / 1 skipped files; 7,300 passed / 9 skipped tests**.
- Both TypeScript configurations pass. The production build passes with only the pre-existing Vite dynamic-import/chunk warnings.
- Fresh built-runtime evidence: V08 authority PASS; V09 authority and A/B/C SIGKILL recovery PASS; V10 authority PASS; V10 B/C SIGKILL recovery PASS.
- Fresh `gemma4-e4b-q4:latest` message and forced-call samples pass structural checks and semantic inspection: exact committed occurrence, correct Mara/Room identity, no unrelated Noa disclosure, no manipulative pressure, sensible message continuation, and a justified in-app voice rehearsal.
- Retained mounted accepted-call evidence passes all eight strengthened checks, including caller identity on the persisted voice reply, acoustic input → mlx Whisper STT → production model → canonical voice reply → audible TTS.
- Six locale files parse; all V10 evidence scripts syntax-check; `git diff --check` passes. No original profile, commit, push, or deployment was touched.

### Acceptance judgment

The missing literal Notification Center mouse click is not an independent semantic gap. The signed app demonstrated actual macOS display; the production click callback is exercised with the exact stable contact target; mounted real deep-link activation handles current/expired/erased state; and mounted explicit incoming-call acceptance completed the actual voice path. Requiring one more physical gesture would duplicate already-separated evidence without testing an uncovered authority or integration boundary.

No remaining reproducible V10 counterexample violates CONTACT-01–09, the V10 portions of TIME/VOICE, or A22–A29. V08 interpretation authority and V09 exact committed-occurrence authority remain intact.

INDEPENDENT_REVIEW_VERDICT=PASS
