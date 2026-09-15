# Conversation AI verification and consolidation

Verified 2026-09-14 against runtime callers, persisted data, tests, and the mounted production renderer.

**Verdict: still materially Frankenstein relative to the intended Director / Thread / Room architecture.**

The old persona runtime, duplicated voice prompt, obsolete conversation analytics, and custom token hover stack have been consolidated. There is now one understandable execution path for an existing individual's text and voice turns. However, the intended overhaul did not fully happen: live creation has no Director, Rooms directly contain individual Participants, disposable Threads use persistent Room membership, and incoming Sea events are not the conversation transcript displayed by the window. These are missing domain foundations, not naming problems. Implementing a new hierarchy or school system merely to claim completion would exceed a consolidation pass.

## Actual runtime map

```text
Startup legacy data
  main.runLegacyMigration
    → world.json + per-room Sea / per-Thread journals

New Conversation
  selected Participant IDs + separate intent
    → world.createRoom → applyMembership per ID → createThread/updateThread
    → selectRoom → runConversationTurn(contextOnly)
  DIVERGENCE: free-text resolution/bootstrap; no live Director or Scenario store

Resume / reload / external open-room
  saved selection or structured roomId/threadId
    → selectRoom → world snapshot + Thread events + world Sea events
    → displayMessages → ChatBubble → SubtitleWord

Send text / voice final transcript / greeting / intent / voice nudge
  runConversationTurn
    → runRoomTurn (roster, speaker selection, witnessed history)
    → compileContext per Participant ID
       [persona + canon + lived memory + Thread intent/media + learner projection]
    → conversationAgent.buildSystemPrompt → LLM router
    → streamed response → message.character in the same Thread journal
    → canonical tokenizer / SubtitleWord; optional speech output
  Voice prefetch caches the same typed CompiledContext, scoped/versioned by state

Open Room
  openRoomAt → selectRoom → selected/latest/new Thread
  DIVERGENCE: there is no distinct persistent Room conversation view

Persistent memory
  explicit rememberThis / integrateThread → Sea journal
    → memoryProjection / contextCompiler / Dreamer / Memory Browser
  save_memory during a Thread → Thread-local memory event, not Sea

Participant editing
  ParticipantEditorModal → world.updateParticipant → world.json
    → invalidate cached runner → compile updated identity on next turn

Learning
  media candidates + explicit practice selections
    → canonical FlashcardContext settled-state filter → prediction-labelled context
  correction / grammar quiz → FlashcardContext grammar evidence append → replay
  reader interaction → shared SubtitleWord / canonical learning controls
```

Primary source locations: `src/renderer/windows/conversationAgent/App.tsx`, `journalRuntime.ts`, `roomMessages.ts`; `src/shared/roomOrchestrator.ts`, `contextCompiler.ts`, `memoryProjection.ts`, `world.ts`; `src/renderer/services/conversationAgent.ts`; `src/electron/services/worldIpc.ts`, `worldStore.ts`, `journalService.ts`, `legacyMigration.ts`.

## Meaningful remnants and disposition

| Finding | Was it live? | Disposition and reason |
|---|---|---|
| Renderer AgentConfig service, original single-agent to multi-agent migration, legacy voice identity fallback | Yes: startup migration/fallback remained after world migration | Removed renderer service and fallback. Main startup now imports both original single-agent and later multi-agent saved formats directly into the world model; preserves IDs and avoids duplicate imported events on retry. |
| AgentSetupModal, RoleplayQuickStart, wikiExplorationAgent | No reachable product caller after the prior cleanup | Deleted dead UI/runtime and tests exclusively asserting those deleted paths. Reusable wiki research and scenario/canon contracts remain. |
| Legacy persona/backstory/memory prompt branches and separate voice system prompt | Runtime branches remained in the shared agent engine | Removed AgentConfig/AgentMemory dependencies and old-only tools. Text and voice now use one world-grounded prompt; speech rules are modality instructions. |
| Frequency-level response reformulation and get_media_stats | Yes | Removed from conversation generation. Removed MediaStatsTab from Details. Media analytics elsewhere remain a separate, legitimate product capability. |
| AI-specific ChatToken knownness and hover implementation | Yes | Replaced with the shared SubtitleWord component. Agent widget tokenization now uses the injected canonical tokenizer too. |
| Thread save_memory automatically writing Sea | Yes | Changed to Thread-scoped witnessed notes with source event IDs. Explicit promotion remains the persistence boundary. |
| History bypassing witness filtering; comparison of independent Sea/Thread sequence numbers; active-room-only memory | Yes | Filtered actual LLM history, separated stream visibility, applied membership time to Thread visibility, and loaded persistent history across world rooms for the same individual. |
| Duplicate current user message in model history | Yes | Current message is supplied once through the shared turn path. Real requests verified system + preceding character + current user, without a second current-user copy. |
| Cached runner keeping old edited persona; late append/tokenization completing into another selection | Yes | Invalidate edited runners; selection-session guards protect response and token state. |
| Concurrent world mutations overwriting each other | Yes, reproducible with concurrent room creation | Serialized complete read-modify-write operations across world IPC and scheduler mutations. Regression reproduced failure before the fix. |
| Journal treating a normal trailing newline as damaged data | Yes | Recovery now runs only for an actually malformed final record; missing streams load as empty without noisy errors. |
| Memory Browser provider ancestry | Yes, actual mounted window failed despite mocked tests | Moved content under WindowWrapper and strengthened the provider test. Preserved the existing browser UX. |
| Internal participant-picker scrollbar | Yes, visible at 420px | Fixed fieldset minimum size and actual Btn content sizing; verified nested containers, not only document width. |
| ScenarioSpec / materializeScenario / canon advancement helpers | Contract/library code, not live orchestration | Retained as unwired domain work, explicitly not counted as a Director implementation. No v3 wrapper added. |
| Legacy persisted interfaces and Chinese-variant session cleanup | Compatibility only | Retained at data migration boundaries. They no longer drive the conversation runner; the marker-gated language cleanup can still merge old saved session keys. |

## Domain assessment

| Concept | Verified state |
|---|---|
| Sea / world | Real durable event storage and persistent identities. Witnesses, memory kinds, open loops, relationships and consolidation exist. Thread-generated notes no longer automatically enter Sea. Persistence is still imperfect at the entity/membership level because new disposable interactions create persistent Rooms. |
| Rooms | Durable room records and journaled membership exist; multi-AI turn selection is real. Opening one still opens a Thread. Sea proactive messages do not appear in the current Thread-only display. |
| Threads | Separate event streams and real erasure; intent and media context persist. They are not merely a persistence boolean. However, their roster comes from the associated persistent Room, and temporary Participants are global world records rather than owned by a disposable workspace. |
| Director | Absent from live creation. Structured IDs survive, but the modal itself creates entities. Text-only bootstrap still uses simple name resolution and intent as persona material; now creates a temporary person. No persisted Scenario or canonical Director ingress exists. |
| Agents | AgentConfig is now a legacy import schema; AgentInstance is a transient per-person execution object. Neither implements the intended Agent containing multiple Characters. |
| Characters | The live equivalent is one Participant with ID, personaText, optional canon anchor, photo and voice sample. It supports user-defined material, not only built-in tutors. The intended Room → Agents → Characters ontology is missing. |
| Participant identity | Selected IDs remain structured through storage, roster, compilation and journal actors. Text/voice reuse the same IDs. Explicit selection does not regenerate a person. Free-text resolution remains name-based and incomplete. Canon and lived memory are supplied separately; prompt instructions preserve lived continuity. Forward-time/snapshot helpers are not a finished user flow. |
| Memories | One journal/projection family; no active old AgentMemory store writes from conversation. Sea memory follows the same individual between rooms; disposable notes stay local. Memory Browser reads that journal, not an unrelated cache. It is a room-scoped browser, while compilation can retrieve that person's witnessed memories across rooms. |
| Relationships | Derived from owner/toId memory events; corrected projection ownership so the harness is not shown as the relationship subject. Per-turn affect used for speech is ephemeral, not another durable relationship database. |
| Text / voice | Shared identity, compiler, prompt and turn engine. STT/TTS are modality adapters. Multi-person voice presentation/default sample still follows the first roster member; a complete speaker-specific call presentation and incoming-call lifecycle are not finished. |
| Tier-2 | Canonical settled-state filtering and evidence/replay writers are used; no frequency-derived knowledge mutation remains in the conversation engine. Media candidate rankings are predictions, not evidence. This is not yet a full capability-aware production loop: grammar failures still use the generic grammar-recognition rollup, and fluent vocabulary production does not automatically become canonical production evidence. |

`WatchTogetherRoomState` was not deleted: it represents cloud playback state, permissions and socket transport, not a second AI memory/person model. It is also not already connected to the conversational Room domain.

## Product surfaces

- **New Conversation:** real structured multi-selection, separate persisted intent, no duplicate people in the exercised flow, no horizontal overflow at 420px. It is not a Director UI merely because it looks like one.
- **Conversation Details:** title/rename, intent, participants, media context and deletion; obsolete Words/Grammar/Levels analysis removed. Describes the actual flat Participant model, not the missing Agent/Character hierarchy.
- **Editing:** saves the canonical Participant by ID; subsequent model compilation uses the edit. Save failures remain visible in the editor.
- **Memory Browser:** existing perspective UI preserved, provider bug fixed, actual explicitly promoted journal memory displayed successfully.
- **Messages:** primary surface; canonical intelligent-text interaction. A → B → A and reload restore token nodes without requiring another streamed response. Internal hover trigger names and production debug statistics are absent from the primary conversation surface; the voice debug pipeline is development-only.

## Future architecture tests, without implementing those products

| Capability | Can it follow naturally from current foundations? |
|---|---|
| Multiple AI participants / sequential turn-taking | Yes, existing roster and orchestrator already support it. |
| Human + AI Rooms | Not yet. The runtime has one reserved USER_ACTOR and otherwise treats roster Participants as AI individuals. Human membership/transport and Agent → Characters ownership are missing. |
| Missions | Separate Thread storage and persisted intent help, but a Director, school ownership/isolation and appropriate production evidence are missing. School activity must not reuse permanent personal Room membership by accident. |
| Campaigns | Sea memory and durable Rooms help; persistent Room interaction and scenario/campaign lifecycle remain incomplete. |
| Proactive calls | Scheduler uses persistent IDs and Sea events. Opening an incoming call now selects that room/person and voice UI, but acceptance/end lifecycle and Sea-to-conversation presentation are not fully converged. |
| Persistent social continuity | Witnessed memories, relationships, canon separation and recurring IDs are real. Explicit integration is API-only; membership contamination, stale cross-window snapshots and incomplete Room interaction prevent claiming the full social world is finished. |
| Media → conversation → learning | Media/practice input and canonical learner filtering are real; canonical reader interactions and grammar event writes connect back. Automatic, capability-specific production evidence is incomplete. No new shadow learner model was introduced. |

The world/journal Capacitor bridges currently return empty reads or reject mutations. Desktop verification must not be mistaken for mobile parity.

## Verification actually performed

- `npm run typecheck`: passed both renderer/shared and Electron configurations.
- `npm run build`: passed production build, Electron compilation and preload bundling. Existing large-chunk warning remains.
- `npm run test`: **424 files passed, 1 skipped; 6,710 tests passed, 9 skipped**. Earlier failures exposed ingress races and a deleted-module-only test; fixed before this full run.
- Subsequently added one explicit-promotion witness regression and ran `npx vitest run src/electron/services/worldIpc.test.ts`: **10 passed**. No claim that the full-suite count includes this later test.
- Migration tests exercised original single-agent data, later multi-agent data, existing saved data, retry without completion marker and duplicate prevention.
- Targeted mounted tests exercised Thread memory isolation, independent stream visibility, cross-room memory, stale append protection, original A → B → A token restoration, context ingress, shared voice/text context, and provider ancestry.
- Real Electron used production `dist` pages, actual preload/IPC/world/journal repositories and the Python tokenizer with installed language data. A cloned existing profile started with **4 Participants, 4 Rooms and 41 Threads**. All edits, extra Rooms, messages and promoted test memory were confined to that clone.
- LLM output used a deterministic local Ollama-compatible HTTP endpoint. This verified dispatch/streaming/storage/rendering rather than a commercial model's reasoning or tool-selection quality. No cloud attestation was accepted and no cloud conversation was sent.
- Exercised creation selecting two saved people; verified exact IDs and unchanged Participant count; persisted optional intent; sent Japanese text and received/tokenized Japanese output; edited the same Participant; inspected Details at narrow width; reloaded; switched A → B → A; explicitly promoted a source-witnessed memory via real IPC and viewed it in Memory Browser; opened voice until the call UI was ready.
- Reload restored **3 bubbles / 28 tokens**; A → B → A restored **28 tokens**. At **420px**, document width matched viewport and all inspected modal containers had no horizontal overflow. Memory Browser showed **3 tabs / 4 sections** and the promoted text.
- Voice readiness used fake microphone permission/device and muted audio. A completed real spoken STT → response → TTS exchange, speaker-specific multi-person synthesis, and proactive acceptance/end were **not verified**.
- No uncaught page errors/rejections occurred in these flows. The unpackaged harness initially opens source HTML before navigating to built `dist` HTML; its initial source module produces a MIME-type console error. This is not reported as a clean console for the entire launch. The recorded error was specifically `src/html/main.html` loading `src/renderer/windows/main/index.tsx`; no console errors were recorded from the built Conversation or Memory Browser pages.
- Original `world.json` and `kv-store.json` SHA-256 hashes were unchanged after verification. No original-profile data was erased or edited. Existing unrelated graph changes were preserved.

Local evidence from this pass: `/tmp/conversation-full-test-final.log`, `/tmp/conversation-final-typecheck.log`, `/tmp/conversation-final-build.log`, `/tmp/conversation-final-world-test.log`, `/tmp/conversation-electron-final.log`, `/tmp/conversation-electron-errors.json`, `/tmp/conversation-console-errors.json`; screenshots `/tmp/conversation-electron-{new-420,details-420,memory,voice}.png`. Temporary evidence files are not durable repository artifacts.

## Remaining architectural debt

1. Implement the intended domain ownership and Director ingress deliberately: Room → Agents → Characters, human participants, structured scenario construction and independent disposable workspace rosters. Do not relabel the flat Participant array as completion.
2. Complete explicit integration UX and persistent Room/incoming-event interaction. Thread memory isolation is fixed, but persistent membership/world records still outlive disposable creation. Integration's multi-step journal/participant operation also lacks a full transaction/concurrent-request boundary.
3. Finish incoming-call lifecycle and speaker-specific voice presentation; the shared turn engine is now available, but a first-roster voice sample is not full multi-person modality convergence.
4. Replace prediction-era media grammar/word candidates with richer canonical target/capability projections where needed, and record production through appropriate canonical evidence. Do not interpret current grammar-recognition rollups as full speaking competence.
5. Add real world/journal change propagation across windows. The old `subscribeRoom` bridge is a snapshot API despite its name; selection reloads do not provide live social-world synchronization. Mobile world/journal transport is also absent.

No new Director, school system, campaign model, or parallel memory architecture was invented in this pass. The consolidated runtime is clearer and safer, but the repository cannot honestly be certified as the completed intended overhaul.
