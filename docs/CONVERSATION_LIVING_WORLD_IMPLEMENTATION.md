# Living-world implementation and evidence ledger

Target: [CONVERSATION_LIVING_WORLD_SPEC.md](CONVERSATION_LIVING_WORLD_SPEC.md), unchanged copy of the supplied design document. Full target remains active; no acceptance case is certified by a helper test.

Status vocabulary: **reported** (historical claim), **unverified** (no current sufficient evidence), **implemented** (live code exists), **fixture-verified** (controlled production-path test), **live-verified** (appropriate real runtime proof), **failed** (counterexample), **externally blocked** (specific prerequisite missing). Partial evidence does not close an entire requirement.

## Dependency-aware execution

1. Ownership and creation: scoped bindings and revision-pinned baselines; validated integration; atomic Director staging/activation; persist and consume scenarios; usable scope/creation/editing/integration paths. A01–A09.
2. Perspective and memory: information events, directional state, automatic scoped reflection, bounded retrieval, correction and erasure. A10–A13, A19–A21, A44–A45.
3. Autonomous world: main-owned durable eligible jobs, bounded individual episodes, causal development and foreground reconciliation. A14–A18, A28–A29, A43.
4. Contact and voice: recoverable event-to-delivery handoff, conservative controls, notification activation, incoming call lifecycle, actual audio and identity continuity. A22–A27.
5. Learning and shared situations: canonical observed production evidence, media ingress, real human authority/transport, Mission and Campaign entry/continuation, optional audio retention. A32–A36, A41.
6. Closure: mounted Electron UX, migration on clones, failures and privacy, resource measurements, real-model evaluation and all connected proof bundles. A30–A31, A37–A40, A42; regress every earlier case.

## Current production ownership map

- `NewConversationModal.tsx` routes selected existing people without intent through main-owned `createSandbox`; intent requests use `scenarioDirector.prepareScenario` → owner preview → `activateScenario`. Both publish independent Thread casts atomically. Generated people stay local; no request-as-persona or permanent scaffolding fallback remains. Persistent entry, grounding and scenario evolution still need this boundary.
- `worldIpc.ts` owns entity commands through `worldStore.withWorldMutation`; JSON save uses rename. Since V07, integration runs through `integration.ts` inside that same world queue: main-owned derivation from the thread journal (no caller-supplied witnesses/payloads), a private prepared ledger record, gated journal preparation and an atomic world-state logical commit with startup reconciliation (corrected in the V07 review).
- `journalService.ts` owns serialized Sea/Thread NDJSON writes and erasure; append IPC remains a broad boundary requiring authority validation. Entity and journal files do not yet share a transaction.
- `App.tsx` → `runRoomTurn` → per-person `compileContext` → existing agent inference. Text and voice share this path. Compiler filters witness/absence and reads scoped memories. Preserve these semantics; live proof is still required.
- `dreamerRuntime.ts` runs policy-gated consolidation only following integration, with in-memory in-flight exclusion. Durable automatic post-encounter reflection is incomplete.
- `main.ts` starts `schedulerRuntime`; main-owned scheduler reconciles persistent Rooms each minute and on resume. Notifications open Room; autonomous episode generation and full delivery/call lifecycle remain to implement.
- Historical consolidation evidence is in `CONVERSATION_ARCHITECTURE_VERIFICATION.md`. Its forced hierarchy interpretation is superseded by the target spec. Earlier counts/screenshots are reported evidence, not current verification.

## Requirements

| ID | Requirement | Status | Current evidence / next proof |
|---|---|---|---|
| MODEL-01 | Stable concepts. | unverified | Full condition retained in target; verify through the connected wave above. |
| MODEL-02 | No forced containment tree. | unverified | Full condition retained in target; verify through the connected wave above. |
| MODEL-03 | Agent does not mean prompt-only. | unverified | Full condition retained in target; verify through the connected wave above. |
| MODEL-04 | Namespace and ownership. | unverified | Full condition retained in target; verify through the connected wave above. |
| SCOPE-01 | A saved sandbox is still a sandbox. | unverified (partial V03 evidence) | V03 adds generated local casts and persisted Scenario; automatic local reflection and full isolation lifecycle remain open. |
| SCOPE-02 | Persistent Room activity is world activity. | unverified | Full condition retained in target; verify through the connected wave above. |
| SCOPE-03 | Temporary creation must not change permanent topology. | unverified (partial V03 evidence) | V03 replaces unresolved intent scaffolding with staged generation and atomic independent Thread publication; controlled tests verify unchanged permanent topology on success, failure and cancellation. |
| SCOPE-04 | Isolated bindings. | unverified (partial V02 evidence) | V02: explicit origin IDs, pinned Participant baselines and per-Room journal heads; local override editor. Compiler rejects unbound callers and later Sea history. Correction/erasure propagation remains incomplete. |
| SCOPE-05 | Scope is enforced below the UI. | unverified (partial V02 evidence) | V02: compiler/orchestrator and journal writer enforce standalone sandbox bindings. Full authority, tools, reflection, deletion/profile races and background jobs remain open. |
| SCOPE-06 | Selective integration. | partial (V07 reviewed) | Room or world-continuity preview/commit; people and memories require no fabricated Room membership. Situation adoption requires a Room. New operation flow verified in Electron; legacy recovery blocks an unqualified V07 verdict. |
| SCOPE-07 | Identity and conflict resolution. | partial (V07 reviewed) | New adoptions use immutable source/baseline links independent of current persona. Witnesshood is not current membership; selection identity conflicts and pending reservations are explicit. Old adoptions without that link need migration. |
| SCOPE-08 | Atomic and idempotent admission. | partial (V07 reviewed) | Corrected new-operation protocol gates prepared Sea rows and atomically publishes topology plus committed status. Five actual process-crash boundaries pass. Old prefixes without before-images remain unresolved; the original atomicity claim was false. |
| SCOPE-09 | Honest erasure choices. | partial (V07 reviewed) | New prepared operations recover even after source deletion; committed retries preserve history. Old unrecoverable prefixes expose their current affected topology but have no deterministic resolution contract. Full erasure controls remain open. |
| IDENTITY-01 | Resolve before creating. | implemented (partial V07 evidence) | Persistent creation resolves exact selected IDs. New integration adoptions preserve identity across later persona edits and reject tampered sources; old adoption-link migration remains open. See V07 review. |
| IDENTITY-02 | Starting material is not lived state. | unverified | Full condition retained in target; verify through the connected wave above. |
| IDENTITY-03 | Grounding modes remain distinguishable. | unverified | Full condition retained in target; verify through the connected wave above. |
| IDENTITY-04 | Temporal and spoiler boundaries. | unverified | Full condition retained in target; verify through the connected wave above. |
| IDENTITY-05 | Lived continuity survives re-grounding. | unverified | Full condition retained in target; verify through the connected wave above. |
| IDENTITY-06 | Timeskips and rewinds. | unverified | Full condition retained in target; verify through the connected wave above. |
| IDENTITY-07 | Editing remains canonical. | unverified (partial V02 evidence) | V02: real Electron local persona save changes only the Thread override; persistent people remain unchanged. Source editing, revision conflicts and scheduled revalidation remain open. |
| IDENTITY-08 | First-use creation actually works. | unverified (partial V03 evidence) | V03 wires empty-world generation, preview, acceptance and recovery. Real-model runs exposed invalid output; validation preserved empty topology. Native end-to-end proof is pending. |
| ROOM-01 | More than a roster and transcript. | unverified | Full condition retained in target; verify through the connected wave above. |
| ROOM-02 | Membership, presence, and knowledge are different. | unverified | Full condition retained in target; verify through the connected wave above. |
| ROOM-03 | Catching up is an information event. | unverified | Full condition retained in target; verify through the connected wave above. |
| ROOM-04 | Social continuity crosses encounters. | unverified | Full condition retained in target; verify through the connected wave above. |
| ROOM-05 | Rooms can connect through people. | unverified | Full condition retained in target; verify through the connected wave above. |
| ROOM-06 | Room culture is earned. | unverified | Full condition retained in target; verify through the connected wave above. |
| KNOW-01 | Separate occurrence, assertion, and belief. | unverified | Full condition retained in target; verify through the connected wave above. |
| KNOW-02 | Every person's context is scoped. | unverified | Full condition retained in target; verify through the connected wave above. |
| KNOW-03 | Information transmission is causal. | unverified | Full condition retained in target; verify through the connected wave above. |
| KNOW-04 | Relationships are directional. | unverified | Full condition retained in target; verify through the connected wave above. |
| KNOW-05 | Absence and negative knowledge. | unverified | Full condition retained in target; verify through the connected wave above. |
| KNOW-06 | Administrative visibility is not in-world witnessing. | unverified | Full condition retained in target; verify through the connected wave above. |
| KNOW-07 | Correctness is structural as well as generative. | unverified | Full condition retained in target; verify through the connected wave above. |
| EVENT-01 | One authoritative event/projection family. | unverified | Full condition retained in target; verify through the connected wave above. |
| EVENT-02 | Stable meaning. | unverified | Full condition retained in target; verify through the connected wave above. |
| EVENT-03 | Different kinds of statements. | unverified | Full condition retained in target; verify through the connected wave above. |
| EVENT-04 | Authorized commit boundary. | implemented (V07 fixture evidence) | Integration content is derived main-side from the canonical thread journal (witnesses/owners/payloads cannot be fabricated by callers); validation covers source scope, retraction, canonical identity dependencies, destination situation conflicts and selected-consequence claims before preparation. Generic journal IPC still requires a complete trusted authority boundary. See verification record V07. |
| EVENT-05 | No fabricated human actions. | unverified | Full condition retained in target; verify through the connected wave above. |
| EVENT-06 | Concurrency and idempotency. | partial (V07 reviewed) | Global operation ID plus normalized selection hash; identical renderer submissions serialize. Actual second Electron process exits under the single-instance lock. Independent external profile writers are unsupported; other operation families remain unaudited. |
| EVENT-07 | Causal invalidation. | unverified | Full condition retained in target; verify through the connected wave above. |
| DIRECTOR-01 | A live canonical entry boundary. | unverified (partial V03/V06 evidence) | V03 main-owned staging handles selected IDs plus intent for sandboxes; V06 adds the persistent Room choice through the same staging/activation. Source/media and educational adapters remain open. |
| DIRECTOR-02 | Separate participants from intent. | unverified | Full condition retained in target; verify through the connected wave above. |
| DIRECTOR-03 | Materialize actual situations and casts. | unverified (partial V03 evidence) | V03 validates distinct local profiles, goals, knowledge audiences and directional relationships. Source grounding, persistent cast and open-loop materialization remain open. |
| DIRECTOR-04 | Persist and consume Scenario state. | unverified (partial V03 evidence) | V03 persists Scenario and reference on Thread; actual compiler and turn path consume shared facts and scoped private state. Subsequent evolution remains open. |
| DIRECTOR-05 | Coherent creation lifecycle. | unverified (partial V03/V06 evidence) | V03 fixture proof: durable staging, cancellation, failed retry, reload, baseline conflict and idempotent atomic acceptance. V06: persistent activation is atomic, idempotent and leaves no permanent topology on failure. Full crash/profile/permission matrix remains open. |
| DIRECTOR-06 | Deterministic when appropriate, generative when useful. | unverified (partial V03/V06 evidence) | Deterministic selected-person entry and persistent Room creation need no model call; intent-based generation keeps the bounded provider queue. Native reliability of generated proposals remains under evaluation. |
| DIRECTOR-07 | Evolving orchestration. | unverified | Full condition retained in target; verify through the connected wave above. |
| DIRECTOR-08 | Keep the Director out of the cast. | unverified (partial V03 evidence) | V03 separates main-owned proposal generation from character turns; setup creates no user message. Compiler excludes owner private objective and other-person private facts. |
| DIRECTOR-09 | One policy boundary for entry and continuation. | unverified (partial V06 evidence) | Sandbox and persistent Room entry now share the canonical New Conversation staging/activation; the legacy Room-linked createThread entry is removed. Voice, media, Mission and Campaign entries still need this boundary. |
| TURN-01 | Bounded orchestration. | unverified | Full condition retained in target; verify through the connected wave above. |
| TURN-02 | Individual generation. | unverified | Full condition retained in target; verify through the connected wave above. |
| TURN-03 | Non-speakers still exist. | unverified | Full condition retained in target; verify through the connected wave above. |
| TURN-04 | No inference explosion. | unverified | Full condition retained in target; verify through the connected wave above. |
| TURN-05 | Human floor and stopping. | unverified | Full condition retained in target; verify through the connected wave above. |
| TURN-06 | Candidate actions are validated. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-01 | Autonomy is required. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-02 | User-centred relevance, not user-only existence. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-03 | Eligible triggers. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-04 | Real episode path. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-05 | Causal consequences. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-06 | No invented user participation. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-07 | Event generation and reflection are distinguishable. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-08 | Rich but bounded change. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-09 | Foreground/background reconciliation. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-10 | Observable without requiring supervision. | unverified | Full condition retained in target; verify through the connected wave above. |
| LIFE-11 | Agent-originated intentions. | unverified | Full condition retained in target; verify through the connected wave above. |
| SOCIAL-01 | Episodes drive development. | unverified | Full condition retained in target; verify through the connected wave above. |
| SOCIAL-02 | Preserve asymmetry and disagreement. | unverified | Full condition retained in target; verify through the connected wave above. |
| SOCIAL-03 | Short- and long-horizon state. | unverified | Full condition retained in target; verify through the connected wave above. |
| SOCIAL-04 | Rich representation, restrained display. | unverified | Full condition retained in target; verify through the connected wave above. |
| SOCIAL-05 | Affect has a subject and cause. | unverified | Full condition retained in target; verify through the connected wave above. |
| SOCIAL-06 | Emergent lore is first-class history. | unverified | Full condition retained in target; verify through the connected wave above. |
| SOCIAL-07 | No mandatory drama. | unverified | Full condition retained in target; verify through the connected wave above. |
| SOCIAL-08 | User agency and boundaries. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEM-01 | Canonical memory family. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEM-02 | Automatic permitted reflection. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEM-03 | Reflection output. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEM-04 | No sandbox promotion through reflection. | implemented (partial V07 evidence) | Explicit integration is now the only promotion route: the standalone `WORLD_PROMOTE_PARTICIPANT` side door was removed; adoption runs inside the integration operation with provenance and destination mapping. Thread-local reflection remains local. |
| MEM-05 | Repeated reflection is not repeated learning. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEM-06 | Bounded useful memory. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEM-07 | Relevance does not grant access. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEM-08 | Forgetting and archival are not falsification. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEM-09 | Corrections and erasure propagate. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEM-10 | Selective VoiceMem-inspired improvements. | unverified | Full condition retained in target; verify through the connected wave above. |
| CTX-01 | One compiler for identity and continuity. | unverified | Full condition retained in target; verify through the connected wave above. |
| CTX-02 | Inputs have explicit authority. | unverified | Full condition retained in target; verify through the connected wave above. |
| CTX-03 | Stable snapshot. | unverified | Full condition retained in target; verify through the connected wave above. |
| CTX-04 | Bounded selection and graceful uncertainty. | unverified | Full condition retained in target; verify through the connected wave above. |
| CTX-05 | Separate pedagogical policy from character knowledge. | unverified | Full condition retained in target; verify through the connected wave above. |
| CTX-06 | Scoped capabilities. | unverified | Full condition retained in target; verify through the connected wave above. |
| CONTACT-01 | Contact has a cause. | unverified | Full condition retained in target; verify through the connected wave above. |
| CONTACT-02 | Proactive messages are world/Room events. | unverified | Full condition retained in target; verify through the connected wave above. |
| CONTACT-03 | One durable lifecycle. | unverified | Full condition retained in target; verify through the connected wave above. |
| CONTACT-04 | Conservative policy. | unverified | Full condition retained in target; verify through the connected wave above. |
| CONTACT-05 | Commit and delivery cannot diverge silently. | unverified | Full condition retained in target; verify through the connected wave above. |
| CONTACT-06 | Real notification/deep-link path. | unverified | Full condition retained in target; verify through the connected wave above. |
| CONTACT-07 | Real incoming call lifecycle. | unverified | Full condition retained in target; verify through the connected wave above. |
| CONTACT-08 | Privacy-aware presentation. | unverified | Full condition retained in target; verify through the connected wave above. |
| CONTACT-09 | No manipulative pressure or unauthorized external action. | unverified | Full condition retained in target; verify through the connected wave above. |
| TIME-01 | Separate clocks. | unverified | Full condition retained in target; verify through the connected wave above. |
| TIME-02 | Main-owned lifecycle. | unverified | Full condition retained in target; verify through the connected wave above. |
| TIME-03 | Honest background support. | unverified | Full condition retained in target; verify through the connected wave above. |
| TIME-04 | Bounded resume and catch-up. | unverified | Full condition retained in target; verify through the connected wave above. |
| TIME-05 | Priority and capacity. | unverified | Full condition retained in target; verify through the connected wave above. |
| TIME-06 | Local/cloud policy. | unverified | Full condition retained in target; verify through the connected wave above. |
| TIME-07 | Measured boundedness. | unverified | Full condition retained in target; verify through the connected wave above. |
| VOICE-01 | Shared identity and context. | unverified | Full condition retained in target; verify through the connected wave above. |
| VOICE-02 | Complete real exchange. | unverified | Full condition retained in target; verify through the connected wave above. |
| VOICE-03 | Speaker-specific multi-person presentation. | unverified | Full condition retained in target; verify through the connected wave above. |
| VOICE-04 | Barge-in and cancellation. | unverified | Full condition retained in target; verify through the connected wave above. |
| VOICE-05 | Partial input is provisional. | unverified | Full condition retained in target; verify through the connected wave above. |
| VOICE-06 | Failure does not strand the conversation. | unverified | Full condition retained in target; verify through the connected wave above. |
| VOICE-07 | Optional audio evidence, not hidden surveillance. | unverified | Full condition retained in target; verify through the connected wave above. |
| LEARN-01 | Tier-2 is authoritative. | unverified | Full condition retained in target; verify through the connected wave above. |
| LEARN-02 | Evidence describes what was observed. | unverified | Full condition retained in target; verify through the connected wave above. |
| LEARN-03 | Keep capabilities separate. | unverified | Full condition retained in target; verify through the connected wave above. |
| LEARN-04 | Context matters. | unverified | Full condition retained in target; verify through the connected wave above. |
| LEARN-05 | Fictional admission and learning are independent. | unverified | Full condition retained in target; verify through the connected wave above. |
| LEARN-06 | Adaptation actually influences situations. | unverified | Full condition retained in target; verify through the connected wave above. |
| LEARN-07 | Feedback is usable and revisable. | unverified | Full condition retained in target; verify through the connected wave above. |
| LEARN-08 | Domain and language openness. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEDIA-01 | A usable bridge. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEDIA-02 | Preserve grounding and limits. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEDIA-03 | Close the learning loop. | unverified | Full condition retained in target; verify through the connected wave above. |
| MEDIA-04 | Watch Together is an adapter, not the same entity by name. | unverified | Full condition retained in target; verify through the connected wave above. |
| GROUP-01 | Real humans remain real identities. | unverified | Full condition retained in target; verify through the connected wave above. |
| GROUP-02 | A working shared text route. | unverified | Full condition retained in target; verify through the connected wave above. |
| GROUP-03 | Shared authority is explicit. | unverified | Full condition retained in target; verify through the connected wave above. |
| GROUP-04 | Same turn machinery. | unverified | Full condition retained in target; verify through the connected wave above. |
| EDU-01 | Mission is a real objective-driven situation. | unverified | Full condition retained in target; verify through the connected wave above. |
| EDU-02 | Campaign carries continuity. | unverified | Full condition retained in target; verify through the connected wave above. |
| EDU-03 | Templates are not shared biographies. | unverified | Full condition retained in target; verify through the connected wave above. |
| EDU-04 | Institutional and personal ownership are separate. | unverified | Full condition retained in target; verify through the connected wave above. |
| EDU-05 | Integration and portability are intentional. | unverified | Full condition retained in target; verify through the connected wave above. |
| EDU-06 | Minimal usable entry surfaces. | unverified | Full condition retained in target; verify through the connected wave above. |
| EDU-07 | Evidence, not automatic certification. | unverified | Full condition retained in target; verify through the connected wave above. |
| UX-01 | Conversation remains primary. | unverified | Full condition retained in target; verify through the connected wave above. |
| UX-02 | World entry and temporary entry are understandable. | unverified (partial V02/V06 evidence) | V02: selected-person practice labeled separately in creation, sidebar and Details. V06: explicit scope choice between temporary practice and persistent world entry, with a persistent consequence hint, exercised natively. |
| UX-03 | New Conversation is structured and robust. | unverified (partial V03 evidence) | V03 provides preview, explicit acceptance, change setup, cancel and retry; introductory dialog ordering and preview accessible name fixed. Full entry/recovery matrix remains open. |
| UX-04 | Details describes the actual context. | unverified | Full condition retained in target; verify through the connected wave above. |
| UX-05 | Character editing is comfortable. | unverified (partial V02 evidence) | V02: editor saves a sandbox-local override; production Electron exercised persona save. Full focus/cancel/source/voice editing matrix remains open. |
| UX-06 | Preserve Memory Browser quality. | unverified | Full condition retained in target; verify through the connected wave above. |
| UX-07 | Integration is discoverable and reviewable. | implemented (V07 native evidence) | Details offers selective integration with world/Room destination, dependency preview and situation choice. Pending operations have durable Retry; interrupted records expose affected current topology. Native failure/retry, destination, Memory Browser and reopen path exercised. Old-state resolution remains open. |
| UX-08 | Activity and contact are usable. | unverified | Full condition retained in target; verify through the connected wave above. |
| UX-09 | Shared intelligent text. | unverified | Full condition retained in target; verify through the connected wave above. |
| UX-10 | Tokenization lifecycle is reliable. | unverified | Full condition retained in target; verify through the connected wave above. |
| UX-11 | Header and controls actually work. | unverified | Full condition retained in target; verify through the connected wave above. |
| UX-12 | No leaked implementation UI. | unverified | Full condition retained in target; verify through the connected wave above. |
| UX-13 | Layout, localization, and responsiveness. | unverified | Full condition retained in target; verify through the connected wave above. |
| DATA-01 | Preserve existing work and data. | unverified (partial V06 evidence) | The legacy Room-linked Thread creation entry was removed, but existing room-linked Threads (including legacy-migrated archived ones) still load, list and select; read paths unchanged. Full clone migration proof remains A40. |
| DATA-02 | Deliberate one-way compatibility. | unverified | Full condition retained in target; verify through the connected wave above. |
| DATA-03 | Do not guess away old continuity. | unverified (partial V06 evidence) | Removing the old creation entry preserved all saved records; no journal or world data was rewritten. Reasoning-marker sanitation filters projection output only — persisted rows are never rewritten, and human text is never altered. |
| DATA-04 | Crash-safe lifecycle. | partial (V07 reviewed) | New integration preparation is invisible until atomic world publication; SIGKILL/restart matrix passes, including source deletion. Old W1 prefixes lack rollback data and can still leave half-adopted topology. Other lifecycle families remain open. |
| DATA-05 | Per-profile and institutional isolation. | unverified | Full condition retained in target; verify through the connected wave above. |
| DATA-06 | Erasure is end-to-end. | unverified | Full condition retained in target; verify through the connected wave above. |
| DATA-07 | Trust untrusted input appropriately. | unverified | Full condition retained in target; verify through the connected wave above. |
| DATA-08 | Preserve existing safety and provider boundaries. | unverified | Full condition retained in target; verify through the connected wave above. |
| DATA-09 | Minimize private logging. | unverified | Full condition retained in target; verify through the connected wave above. |
| OPS-01 | Background work is subordinate. | unverified | Full condition retained in target; verify through the connected wave above. |
| OPS-02 | Incremental processing. | unverified | Full condition retained in target; verify through the connected wave above. |
| OPS-03 | Explicit error states. | unverified | Full condition retained in target; verify through the connected wave above. |
| OPS-04 | No infinite repair loop. | unverified | Full condition retained in target; verify through the connected wave above. |
| OPS-05 | Availability is not consent. | unverified | Full condition retained in target; verify through the connected wave above. |
| OPS-06 | Debugging is explanatory, not a second implementation. | unverified | Full condition retained in target; verify through the connected wave above. |
| VERIFY-01 | Four evidence layers. | unverified | Full condition retained in target; verify through the connected wave above. |
| VERIFY-02 | Deterministic tests use production machinery. | unverified | Full condition retained in target; verify through the connected wave above. |
| VERIFY-03 | Real-provider tests are separately labeled. | unverified | Full condition retained in target; verify through the connected wave above. |
| VERIFY-04 | Inspect semantic boundaries. | unverified | Full condition retained in target; verify through the connected wave above. |
| VERIFY-05 | Production UI interaction. | unverified | Full condition retained in target; verify through the connected wave above. |
| VERIFY-06 | Environment limits stay visible. | unverified | Full condition retained in target; verify through the connected wave above. |
| VERIFY-07 | Test semantic quality without exact-script dependence. | unverified | Full condition retained in target; verify through the connected wave above. |
| VERIFY-08 | No destructive verification. | unverified | Full condition retained in target; verify through the connected wave above. |

## Acceptance cases

| ID | Case | Status | Evidence / remaining proof |
|---|---|---|---|
| A01 | Persistent people survive encounters | unverified (partial V06 evidence) | V06: a persistent person created through production APIs joined a persistent Room roster, spoke in a Sea-scoped encounter, and the room/person/reply survived reload natively. Scoped knowledge, cross-room continuity and full witness semantics remain open. |
| A02 | Empty-world Director creation | unverified (partial V03 evidence) | V03 production staging and renderer tests pass. Real local model failed witness/direction schema checks without phantom topology; corrected prompts are being evaluated. Case remains open. |
| A03 | Structured selection end to end | unverified (partial V02 evidence) | V02: exact selected IDs verified through sandbox publication, UI text dispatch, pinned persona, journal and reload. Persisted Scenario and its full consumption still missing. |
| A04 | Source grounding and adaptation | unverified | Production workflow and specified evidence layer required. |
| A05 | No future-canon leakage | unverified | Production workflow and specified evidence layer required. |
| A06 | Same individual through time; safe rewind | unverified | Production workflow and specified evidence layer required. |
| A07 | Sandbox isolation despite real use | unverified (partial V02 evidence) | V02: no permanent topology writes; pinned baseline and local memory compiler tests; Electron local edit and reload. Automatic local reflection, relationship/commitment episode and downstream erasure still missing. |
| A08 | Selective integration with a new and existing person | unverified (stronger V07 evidence) | Domain and actual cloned-profile Electron flow cover selected A/B material, C exclusion, stable identity, destination Room/person/Memory Browser and source reopen. Real-model episode and full connected acceptance scope remain open. |
| A09 | Integration conflict and crash recovery | unverified (V07 blocker confirmed) | Actual process-crash matrix and native injected-failure/Retry pass for new preparations. Old prefixes without before-images have no deterministic resolution; notices expose rather than conceal this state. See V07 review. |
| A10 | Private disclosure and absent participant | unverified | Production workflow and specified evidence layer required. |
| A11 | Room history access is not universal witnessing | unverified | Production workflow and specified evidence layer required. |
| A12 | Belief is not fact | unverified | Production workflow and specified evidence layer required. |
| A13 | Directional relationships and non-speakers | unverified | Production workflow and specified evidence layer required. |
| A14 | The autonomous living-world loop | unverified | Production workflow and specified evidence layer required. |
| A15 | No eligible work means no fabricated life | unverified | Production workflow and specified evidence layer required. |
| A16 | Offscreen activity does not impersonate the user | unverified | Production workflow and specified evidence layer required. |
| A17 | Foreground resolves a queued background problem | unverified | Production workflow and specified evidence layer required. |
| A18 | Emergent lore and Room culture survive | unverified | Production workflow and specified evidence layer required. |
| A19 | Automatic reflection actually runs | unverified | Production workflow and specified evidence layer required. |
| A20 | Long-memory retrieval under a budget | unverified | Production workflow and specified evidence layer required. |
| A21 | Correction/erasure invalidates derived state | unverified | Production workflow and specified evidence layer required. |
| A22 | Meaningful proactive message | unverified | Production workflow and specified evidence layer required. |
| A23 | Quiet hours, mute, budgets, and stale contact | unverified | Production workflow and specified evidence layer required. |
| A24 | Durable delivery failure boundary | unverified | Production workflow and specified evidence layer required. |
| A25 | Real incoming voice call | unverified | Production workflow and specified evidence layer required. |
| A26 | Voice/text continuity, attribution, and interruption | unverified | Production workflow and specified evidence layer required. |
| A27 | Speculative work cannot commit provisional speech | unverified | Production workflow and specified evidence layer required. |
| A28 | Pause, full quit, and bounded catch-up | unverified | Production workflow and specified evidence layer required. |
| A29 | Multiple windows and concurrent writes | unverified (partial fixture evidence) | Partial fixture proof: concurrent integration requests use one world queue. Mounted windows, foreground/background jobs and crash cases remain unverified. See verification record V01. |
| A30 | Tokenized messages remain usable | unverified (partial V02 evidence) | V02: standalone sandbox reload restored 2 bubbles / 17 interactive tokens in Electron. Full required stale/edit/readiness matrix remains open. |
| A31 | Production UI controls and editing | unverified (partial V02/V06 evidence) | V02: native creation at 1100/420 px, selected-person text, Details/edit, reload and sidebar; sidebar overflow fixed. V06: persistent scope choice, person selection and creation driven by normal clicks natively; no overflow at 420 px. Full product controls and locales matrix still open. |
| A32 | Capability-specific learner evidence | unverified | Production workflow and specified evidence layer required. |
| A33 | Media-to-conversation-to-learning loop | unverified | Production workflow and specified evidence layer required. |
| A34 | Two humans and AI share one Room | unverified | Production workflow and specified evidence layer required. |
| A35 | Mission and personal world remain separate | unverified | Production workflow and specified evidence layer required. |
| A36 | Campaign develops instead of resetting | unverified | Production workflow and specified evidence layer required. |
| A37 | Provider/resource failures are real states | unverified | Production workflow and specified evidence layer required. |
| A38 | Scope and prompt-injection resistance | unverified | Production workflow and specified evidence layer required. |
| A39 | Profile and institutional isolation | unverified | Production workflow and specified evidence layer required. |
| A40 | Saved-profile migration and original-data integrity | unverified | Production workflow and specified evidence layer required. |
| A41 | Optional audio retention is reversible | unverified | Production workflow and specified evidence layer required. |
| A42 | Real-model social quality, not just fixtures | unverified (partial V06 evidence) | V05 recorded reasoning-marker leakage into committed speech. V06 fixes it at the canonical model-content boundary with a live regression on the same leaking model: streamed, persisted and reloaded replies are clean. The full quality matrix (corrections, learner evidence, trust) remains open. |
| A43 | Autonomous interests, not only user reminders | unverified | Production workflow and specified evidence layer required. |
| A44 | Owner inspection does not rewrite perspective | unverified | Production workflow and specified evidence layer required. |
| A45 | Affect and development are consumed, not decorative fields | unverified | Production workflow and specified evidence layer required. |

## Checkpoint — 2026-09-14, V01

Completed: full target read; clean initial worktree inspected; unchanged target copy; all 173 requirement IDs and A01–A45 enumerated; creation/writer/compiler/orchestrator/reflection/scheduler entry paths traced; source-scoped integration admission and concurrent retry defects reproduced and fixed.

All A01–A45 remain open at their full acceptance scope. No real provider, Electron interaction, audio, notification activation, two-endpoint group, cloned-profile migration, or performance proof has been claimed in this pass. No external blocker has yet been established. No original profile was read or modified by tests; tests use disposable temporary directories.

Next concrete step: replace renderer multi-write creation with a main-owned canonical creation boundary. Add independent Thread-local cast bindings with pinned persistent origins; make selection, compiler, journal, editor and roster consume that scope without creating a permanent Room. Persist and consume Scenario via the existing contracts, with deterministic selected-person entry and permitted generative intent creation. Trace `participantConstruction.ts`, App selection/voice ingress, sidebar and bridge contract before editing. In parallel conceptually (not another agent), design recoverable transaction publication for Scenario/identity/journal and integration; current sequential memory/entity/marker writes do not satisfy A09.

Known remaining admission risks: raw journal IPC can bypass domain checks; room membership is still a legacy proxy for Thread cast; entity and journal writes lack atomic publication; erasure/profile switches outside the world queue can race; memory-content semantic conflict review is absent. These are required work, not deferred optional features.

## Checkpoint — 2026-09-14, V02

Previous goal turn was progress; this turn adds a usable selected-person sandbox path. Main owns atomic Thread publication and retry identity; the cast pins origin IDs, personas and baseline journal heads. Shared compiler/orchestrator, renderer text/voice context, sidebar, Details, local editor and journal routing now consume this scope. Invalid direct sandbox Sea writes/unbound actors are rejected. New sandbox scope cannot be replaced through updateThread. Creation no longer starts a synthetic intent turn. Six locale dictionaries include the new scope labels.

Verification: full suite 424 passed / 1 skipped files, 6,717 passed / 9 skipped tests; both TS configurations and production build passed. Subsequent sidebar/label adjustment passed 32 targeted UI tests and production build; native Electron confirmed the fix. Controlled-model Electron proof is V02 in the verification record. No claim of real-model quality or voice verification.

Next concrete step: implement live Director staging/materialization for **intent-only and generated temporary casts**, reusing existing ScenarioSpec/grounding/provider policy. Remove the remaining request-as-persona/global-temporary fallback only after its replacement is wired and tested. Extend the same main-owned creation boundary for explicit persistent Room creation/return and persisted, perspective-consumed Scenario state. Then complete destination-aware selective integration and atomic multi-file recovery before autonomous/reflection/contact work. Avoid treating the read-only transient sandbox roster view (`sandboxContext`) as a stored Room.

Exact full acceptance remainder: **A01–A45 remain open**. V02 proves selected-person creation/text/edit/reload only. A02/A04–A06/A08–A09 still need generated/grounded Director, time branches and usable integration. A07 still needs automatic local reflection and episodes. A14–A29/A43 still need main-owned autonomous episodes, scoped reflection, durable contact and real voice. A32–A42/A44–A45 still need the specified production-learning/media/group/education/privacy/migration/audio/model/perspective/development proofs.

Remaining risks: the unresolved free-text bootstrap still creates permanent scaffolding; copied baseline persona data requires erasure propagation; pinned history heads need correction/invalidation handling; generic journal authority remains too broad; deleting a sandbox can race with queued journal work; no destination-aware integration UX; entity/journal transaction recovery absent. The native test main-process logs also report missing `dist-electron/env/bin/pip3` during dependency reconciliation, although the running backend tokenized the tested messages; investigate before certifying fresh-install/voice/provider readiness. No global external blocker has been established.

## Checkpoint — 2026-09-14, V03

Main-owned Director staging now replaces the remaining generated-cast bootstrap. Exact selected IDs stay pinned; new individuals stay in Thread-local bindings. Generated proposals explicitly lack researched grounding. Validation rejects runtime authority, user/harness cast IDs, invalid audiences and non-directional relations. Owner review is distinct from in-world witnessing. Activation publishes Scenario, cast and operation acknowledgement in one world JSON save. Compiler consumes actual persisted shared facts and each individual's private goals/knowledge; no synthetic setup utterance is emitted.

The existing provider queue now supports main-owned cancellable bounded completions, queued cancellation isolation and routing revalidation before dispatch. Creation stages survive restart; cancellation and invalid proposals leave no Room/Participant/Thread scaffolding. First-run setup waits for the existing introductory dialog; generated-only worlds can resume. Preview acceptance has the matching accessible name.

Verification: 425 passed / 1 skipped files, 6,724 passed / 9 skipped tests; both TS configurations passed. Following the accessible-name fix, all 9 creation/sidebar tests passed. Production builds passed. These are controlled tests, not full native or model acceptance. Native local gemma4-e4b-q4:latest proposals exposed invalid witness references and then a false directional flag. Both were rejected before publication. Prompt requirements were clarified without loosening validation. The current native retry is recorded in `/tmp/living-world-v03-electron.log`; capture `/tmp/living-world-v03-model-proposal.txt` contains only synthetic test output.

Native follow-up verified actual replies from both distinct local actors, scoped journals and reload. V03 records exact event IDs and screenshots. A real-model tool-output defect remains: malformed correction syntax reached committed display text.

Next concrete step: reproduce the captured malformed correction output at the production provider/agent parsing boundary, prevent control syntax and self-authored corrections from becoming user-facing text or learner evidence, and verify with the real-model saved Thread. Then extend the canonical creation command to explicit persistent Room entry/return and grounding/time semantics; implement destination-aware integration with crash-safe multi-file publication before the connected autonomous/reflection/contact loop.

Exact full remainder: **A01–A45 remain open**. No global external blocker has been established. Known risks remain: broad generic journal authority, profile/deletion/erasure races, no scoped automatic reflection or causal autonomous episode pipeline, no complete selective integration UX/transaction, missing source/time branches and scenario evolution, pending notification/audio/two-endpoint and migration proof. This checkpoint does not reduce the target to Director work.

Latest verification is progress, not completion: native creation/retry/acceptance and two-person text/reload now have real local-model evidence; A42 remains failed/open for malformed tool output. No global external blocker exists.

## Checkpoint — 2026-09-14, V04

Previous turn was progress. This turn reproduced and fixed the V03 malformed tool-output leak at the existing shared conversation agent boundary, preserved valid nested tool execution, and validated observed human spans before correction widgets/grammar writes. Actual human input now comes from the current canonical journal event rather than inference history roles. Native real-model follow-up produced two clean, distinct replies with saved continuity. Evidence and precise validation ordering are in V04 verification.

Next concrete step: return to the creation/ownership wave: reconstruct persistent Room entry/return, foreground journal scopes and membership/presence routes, then add an explicit usable persistent-context path through the canonical creation boundary. Current App requires a Thread and journals every foreground exchange as Thread-scoped; that still violates persistent Room world-activity semantics. Keep independent sandboxes isolated. Follow with source grounding/time semantics and transactional selective integration, then scoped automatic reflection, causal autonomy and contact. The tool fix must not become a substitute for these central missing capabilities.

All 173 requirements and A01–A45 retain their full scope; no acceptance case is newly closed. No global external blocker exists. Remaining waves and known authority/erasure/profile/transaction risks from V03 still apply, alongside voice/media/group/education/migration and real notification/audio proof.

## Checkpoint — 2026-09-14, V05

Previous turn was progress. Existing persistent Room entry now opens a direct Sea conversation; returning no longer manufactures/selects a disposable Thread. Foreground user/character/memory/checker paths share selected scope; saved Threads remain explicitly accessible and isolated from this admission. Details renders the actual Room title. Full suite passes with 6,731 tests and 9 skipped; TS/build pass. V05 verification documents regressions and remaining limits.

Native Room Sea text/reload now passed in session 49004; exact IDs and screenshots are in V05 verification. Actual model thinking/channel markers leaked into normal content, so output-quality acceptance remains failed/open.

Next concrete step: trace provider thinking fields and inline thinking/channel delimiters through the shared agent finalization/journal boundary; add a regression from V05 synthetic output and fix both streaming and persisted speech without interpreting thinking as actions or evidence. Then extend main-owned creation/Director staging with an explicit persistent Room choice and atomic permanent cast/Room/Scenario activation. Replace the live sidebar's old Room-linked createThread entry with isolated scoped creation, preserving old saved records through an explicit migration boundary. This legacy path has been identified, not silently deleted.

Full remainder is unchanged: A01–A45 open. Persistent foreground is only part of Room semantics; presence/information transfer, transactional integration, grounding/time, automatic scoped reflection, causal autonomous episodes, durable contact/real audio, canonical learning/media/group/education/migration are still required. No global external blocker exists.


## Checkpoint — 2026-09-14, V06

Previous turn was progress. This turn fixed the V05 recorded thinking/reasoning-marker leak and completed the persistent Room creation wave.

**Reasoning-marker boundary.** One canonical transform (`src/shared/modelContent.ts` `sanitizeModelSpeech`) now filters model output at every point where it becomes character speech: agent streaming/finalization/timeout, the orchestrator's journal draft, the model-history projection, and both display projections for persisted rows (idempotent, so pre-boundary rows render clean; journal files are never rewritten and human text is never altered). Provider `message.thinking` remains `<think>` transport metadata by design (documented; a think-tag consumer depends on it). Red/green regressions cover the exact V05 synthetic output, split-chunk streaming, and human-text exemption; the live regression on the same leaking local model (`gemma4-e4b-q4:latest`) produced clean streamed, persisted and reloaded speech.

**Persistent Room creation.** The New Conversation boundary gained an explicit scope choice. Persistent + selection is deterministic (`worldIpc.createPersistentRoom`, one world-mutation save publishing Room + roster + `createdByOperation` retry identity; membership events drafted against the pre-membership roster). Persistent + intent reuses Director staging (`scope: 'persistent'`) and `activateScenario` publishes Room, permanent cast, memberships and the Scenario on a room-linked Thread in one atomic save; the shared compiler and turn engine consume it unchanged. The sidebar's legacy Room-linked `New Thread` entry and `WORLD_CREATE_THREAD` are removed end to end; existing room-linked threads (including legacy-migrated archived ones) still load, list and select — records preserved, read paths untouched.

Verification: full suite 426 passed / 1 skipped files, 6,758 passed / 9 skipped; both TS configurations and the production build pass. Native Electron run (fresh disposable profile, real local model): persistent scope radio → person → Start published `room-2c60d772…` with `createdByOperation`, roster of one, **zero Threads**, one membership Sea event; the conversation wrote Sea-scoped user/character events with no control syntax; reload restored clean speech; no page errors; no overflow at 420 px. Evidence and exact IDs are in V06 of the verification record; harness `/tmp/living-world-v06-electron.cjs`.

Next concrete step: destination-aware selective integration with crash-safe multi-file publication (V01's admitted gap), then scoped automatic reflection and the causal autonomous episode pipeline (waves 2–3 of the dependency order). Generated-intent persistent activation should get a native pass once Director proposal reliability allows; voice/media/group/education and real notification/audio proof remain later waves.

Full remainder is unchanged: A01–A45 remain open at full acceptance scope (V06 only adds partial evidence to A01/A31/A42). No global external blocker exists.
## V06 review correction — 2026-09-14

The adversarial review falsified the latest checkpoint's persistent-intent conclusion: its room-linked Thread selected Thread journal scope and owned the only Scenario copy. Ordinary Room return lost both the Scenario context and those exchanges. This was a Living World semantic defect, despite correct Room membership and permanent person creation.

The directly related repair publishes persistent Scenario state on Room, returns the Room from activation and opens its Sea conversation. The compiler/orchestrator and mounted App consume it on later Room turns without a Thread. Sandbox and historical Thread scope remain unchanged; no automatic migration of old V06 Scenario Threads was performed. Native real-local-model generated intent, acceptance, two Sea exchanges separated by reload/Room return now pass. Full suite: 6,763 passed / 9 skipped; TS/build pass. Details and limits are in `CONVERSATION_LIVING_WORLD_V06_REVIEW.md`.

This task ends at V06 review and repair. **Do not interpret the preceding checkpoint's next-step paragraph as authorization to begin selective integration.** Later waves and full acceptance cases remain open.

## Checkpoint — 2026-09-15, V07 adversarial review (latest)

**V07 still architecturally incomplete.** The original report's “complete production capability” and crash-safety claims are withdrawn. W1–W3 were canonical before the alleged W4 logical commit; permanently interrupted recovery could leave half-adopted topology.

New operations now use a private prepared record and journal rows hidden from every canonical Sea read API. One final atomic world save publishes the adopted people/selected situation/declared situation cast and committed status together. Recovery uses prepared content, survives source erasure, validates the current destination and resumes matching rows without duplication. The marker is preparation, not the logical commit. Ordinary selected memories and person adoption do not fabricate membership; world-continuity integration creates no Room. Adoption identity is independent of current persona. The UI supports pending Retry and shows the current affected topology for interrupted records.

Actual process-crash tests and the cloned-profile Electron flow establish the corrected new-operation behavior. The native path included a marker-append I/O failure, zero pre-commit canonical effects, Retry, destination inspection, Memory Browser and original Thread reopen. See [current verification](CONVERSATION_LIVING_WORLD_VERIFICATION.md#v07--adversarial-selective-integration-review-2026-09-15-current) and [detailed review](CONVERSATION_LIVING_WORLD_V07_REVIEW.md).

**Exact V07 remainder:** old pending/interrupted prefixes have no reliable before-image and may have lost their source. Their published topology cannot be rolled back or completed safely by guessing. Older adopted identities lacking an immutable source guard require migration when their current persona no longer matches the pinned baseline. Current notices expose these limitations; they do not constitute world consistency. A deterministic legacy resolution/migration contract is required before calling V07 sound. Full A08/A09 acceptance and real-model material remain unclosed.

**Stop boundary:** no autonomous lives, Dreamer expansion, initiative, Scenario evolution or V08. Existing reflection was only exercised for isolation; its implementation is unchanged. Other A01–A45 acceptance cases remain open.
