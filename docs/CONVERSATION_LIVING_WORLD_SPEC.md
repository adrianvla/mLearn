# mLearn Conversation AI — Living World
## North star, behavioural specification, and implementation contract

**Version:** 1.0 · **Date:** 14 September 2026  
**Target:** the existing mLearn Electron / Solid / TypeScript application and its existing inference, voice, persistence, and learner infrastructure.  
**Purpose:** implement the complete living-world model, not another cosmetic conversation cleanup or audit-only pass.

> **mLearn gives the user a persistent social world inhabited by grounded individuals with their own perspectives and autonomous lives. Their interactions produce relationships, culture, lore, and unresolved situations. Those developments can lead them to contact or involve the user. The same people and history continue across Rooms, encounters, text, and voice. Disposable Threads remain available without involuntarily changing that world.**

---

## 0. Authority, provenance, and how to use this document

This is the target specification. It is not a claim that these capabilities already work. Implementers must inspect the local checkout to discover current runtime behaviour.

### 0.1 Three kinds of information

- **Recovered intent:** the user's living-world requirements and previously recovered constraints: Sea, first-class persistent Rooms, disposable Threads, explicit integration, autonomous lives, grounded identities, perspective-scoped knowledge, causal relationships, context compilation, bounded orchestration, and conservative proactive delivery. These are carried forward, not newly invented product reductions.
- **Historical evidence:** the August architecture dossier, August product note, September VoiceMem comparison, GLM cleanup report, and pasted Astra verification verdict. These describe ideas or a particular checkout at a particular time. They are not proof of the current implementation.
- **Design resolutions in this specification:** explicit rules needed to make the intent implementable—for example, sandbox overlays, the separation of fictional time from notification time, atomic scenario activation, and notification/outbox recovery. These are normative choices for this target, **not claims that the user previously specified those exact mechanisms**. Section 28 identifies these resolutions.

Source references such as `[S1]` refer to the source register in section 29. The specification is self-contained; an executor must not need access to earlier ChatGPT messages to understand it.

**Navigation:** sections 1–2 define the product and scope; 3–8 define identity, continuity, and authority; 9–16 define the living-world runtime; 17–23 define working modalities, integrations, UX, and operations; 24–27 define verification and execution; 28–29 distinguish new resolutions from historical sources.

### 0.2 What this supersedes

This specification supersedes the earlier assistant suggestions that:

1. fixing Director wiring and Thread ownership alone would close the intended overhaul;
2. autonomous lives, consequential world activity, and proactive contact could all be postponed while certifying the model complete;
3. a literal `Room → Agent → multiple Characters` hierarchy was automatically required;
4. persistent storage automatically meant admission into Sea, or every stored conversation was a disposable Thread;
5. all cross-room memory was necessarily leakage;
6. temporary practice required persistent Room membership as an implementation prerequisite.

The recent audit remains useful as a map of findings and repaired defects. Its product interpretation does not override this specification.

### 0.3 Binding words and implementation freedom

**MUST / MUST NOT** express required observable behaviour or integrity constraints. **SHOULD** expresses a preference that may be replaced by an equally sound implementation with a documented reason.

Do not turn every noun below into a new service, table, agent, database, or model invocation. Existing canonical implementations should be extended or consolidated. Equivalent internal structures are acceptable if they preserve the distinctions and pass the acceptance cases.

**Reducing software complexity is encouraged. Removing the specified behaviour is not.** A manual trigger is useful for debugging but does not satisfy a requirement for automatic operation. A schema or API with no live caller does not satisfy a working product requirement.

---

## 1. The experience being built

### 1.1 The user-facing promise

The user returns to people and places that have a past. People remember relevant encounters, keep commitments, disagree, learn about events through actual information paths, develop opinions, and have concerns beyond answering the last user message. A Room develops habits and shared references. Events can occur without the user initiating every exchange. A person may later bring the user into an existing situation.

The experience is centred on the user because it is their world, their relationships, their learning, their boundaries, and their attention. It is not centred on the user in the sense that every character only talks about the user or that no two characters can relate to each other.

The social world is fictional/simulated where it contains AI characters. Realism means **coherent continuity and causal behaviour**, not deceiving the user about AI being human, conscious, physically present, or independently operating outside the software.

### 1.2 The closed loop

```text
Grounded people + existing Rooms + relevant history
                         ↓
            Intent, encounter, or eligible trigger
                         ↓
          Director / situation orchestration
                         ↓
      Perspective-scoped individual participation
                         ↓
     Validated events with actors, witnesses, and causes
                         ↓
       Memories / beliefs / relationships / open loops
                         ↓
       Reflection and bounded autonomous development
                         ↓
     A meaningful reason to act, speak, or make contact
                         ↓
        Room event / message / incoming call invitation
                         ↓
          User responds in the same continuity
                         ↓
              New experience and learning
```

Neither a database of lore nor a notification scheduler alone closes this loop. State must actually influence subsequent behaviour, and that behaviour must feed back into the same state model.

### 1.3 A representative experience

The user and two recurring AI people prepare a presentation in a persistent Room. One person makes a commitment. Later, while the conversation window is closed but the application is allowed to run, the two AI people have a bounded, plausible exchange about that commitment. They interpret the situation differently. The exchange becomes recorded history with only the actual participants as witnesses. One person later contacts the user for a reason linked to that episode. The user can respond by text or voice, mediate, or ignore the invitation. Subsequent interactions retain the outcome.

This is an example, not a built-in storyline or a requirement to manufacture conflict. A useful autonomous outcome can also be ordinary progress, a small discovery, a resolved task, or deciding not to contact anyone.

---

## 2. Required scope and non-goals

### 2.1 Required working capabilities

The implementation must deliver the following as connected runtime behaviour, not dormant contracts:

| Area | Required completion |
|---|---|
| World and Rooms | Persistent social contexts, identities, history, scoped knowledge, evolving relationships, room culture, and open loops. |
| Disposable Threads | Usable temporary casts and scenarios; save/resume without automatic Sea admission; visible, selective integration. |
| Director | Grounded creation, existing-person resolution, scenario persistence, actual context use, and situation evolution. |
| Individual agency | Per-person perspectives, substantive non-user-directed activity, bounded offscreen episodes, and causal state changes. |
| Memory and reflection | Automatic permitted consolidation, bounded useful retrieval, correction/erasure propagation, and long-horizon development. |
| Initiative | Eligible world-driven messages and incoming call invitations, with durable scheduling and user controls. |
| Voice | Actual STT → model → TTS exchange, speaker identity, interruptions, and continuity with text and incoming contact. |
| Learner/media connection | Canonical capability-specific evidence and adaptation; real media-to-scenario or discussion entry points. |
| Human + AI Rooms | Actual participant identity and shared interaction; a verified two-human-plus-AI text path, not two labels controlled by one fake test client. |
| Missions / Campaigns | A usable objective-driven temporary scenario and a resumable multi-episode persistent scenario through the same machinery. Existing institutional entry points should connect where present. |
| Product surface | Reachable, comprehensible creation, Room participation, editing, integration, activity, notification, memory, and call controls. |
| Reliability | Migration, restart, concurrency, cancellation, permission boundaries, resource budgets, and live Electron verification. |

These capabilities may be implemented in several waves. A wave is not permission to redefine the overall target as complete.

### 2.2 Not required to satisfy this specification

Do not expand this into a new school administration product, billing system, general-purpose CMS, unrestricted external-action agent, telephony service, 3D world, animated avatar engine, social network discovery system, or always-on cloud simulation service. Do not migrate Electron to Tauri. Do not rewrite the Tier-2 engine.

A complete school rollout, classroom roster-management overhaul, biometric speaker recognition, and continuous operation while all local processes are terminated are not prerequisites. However, this does **not** exempt the required human-group, Mission/Campaign, voice, or proactive paths above.

`management/` is the actual SaaS school dashboard, not a scratch directory for implementation reports. Put implementation/specification reports under `docs/` following repository conventions. Touch school-dashboard code only for a necessary, scoped integration, not as an unrelated redesign.

### 2.3 Optional to the user does not mean unimplemented

World autonomy, proactive delivery, notifications, audio retention, and cloud execution can be disabled by policy or user choice. Their supported enabled paths must actually work. Conversely, the disabled paths must do no hidden work or disclosure.

---

## 3. Domain model: preserve the meanings, not an accidental hierarchy

**MODEL-01. Stable concepts.** Implement one understandable model containing the following meanings, even when some share an existing representation.

| Concept | Meaning and lifetime |
|---|---|
| **Sea / World** | Persistent continuity owned by a user or explicitly shared authority. Contains people, Rooms, history, relationships, culture, and ongoing situations. Not a globally readable bag of memories. |
| **Room** | First-class persistent social context with membership/history, recurring circumstances, relationships, culture, and ongoing situations. A Room survives individual conversations. |
| **Person / Participant** | Stable identity of an actual human participant or a simulated individual. The identity is not its display name, model provider, voice session, or prompt text. |
| **Character definition / canon baseline** | Source-grounded or user-authored starting material. It can seed an individual but is not a replacement for that individual's lived state. |
| **Agent behaviour / runtime** | The ability of an AI individual to perceive permitted context, act, speak, reflect, and initiate. It need not be another persistent identity wrapper. |
| **Encounter / session** | A bounded interaction, text or voice, within a particular continuity and context. It can be stored using existing thread/session machinery without becoming a sandbox. |
| **Disposable Thread** | A sandbox workspace with its own cast bindings, scenario, journal, and local development. It can be saved, resumed, discarded, or selectively integrated. |
| **Scenario** | A grounded situation with participants, circumstances, goals/constraints, initial knowledge, temporal frame, ownership, and evolving state. Not just a string or a chat message. |
| **Episode / event** | Something that actually occurred within the simulated or human interaction, or an explicitly introduced setting fact, with identity, time, scope, authority, and provenance. |
| **Belief / interpretation** | A person's perspective on something; it may be uncertain, incomplete, or wrong. Distinct from an authoritative event record. |
| **Open loop** | A commitment, unresolved situation, question, intention, or future opportunity that can matter later. It has state and relevant participants. |
| **Contact / call / delivery record** | Durable lifecycle of an attempt to involve the user, tied to an actual situation or event. It is not a separate copy of the person's identity. |

**MODEL-02. No forced containment tree.** A person may participate in several Rooms. Rooms refer to stable people; they do not own disposable copies of them. Use a separate character-definition/individual distinction where useful, but do not manufacture an `Agent contains multiple Characters` hierarchy merely to match an old diagram.

**MODEL-03. Agent does not mean prompt-only.** Keeping the name `Participant` is acceptable only if the system still supplies the required individual state, perspective, development, and autonomous behaviour. Renaming a static persona is not an implementation of agency.

**MODEL-04. Namespace and ownership.** All meaningful records and references must resolve within the right profile, world/branch, sandbox or institutional ownership boundary. Similar names, shared canon, or shared language do not grant cross-world identity or memory access.

---

## 4. Continuity, ownership, and sandbox isolation

### 4.1 Separate durability from fictional continuity

**SCOPE-01. A saved sandbox is still a sandbox.** Saving a Thread to disk does not make its events part of Sea. Disposability concerns authority and continuity, not an obligation to lose the conversation at window close.

**SCOPE-02. Persistent Room activity is world activity.** Ordinary events in an established persistent Room contribute to that Room/world's continuity without requiring the user to press Integrate after every message. Do not accidentally turn the whole world into a manual memory-approval queue.

**SCOPE-03. Temporary creation must not change permanent topology.** Starting a disposable Thread may reference existing people but must not require a new persistent Room, persistent membership changes, permanent relationships, or new persistent people as hidden scaffolding. Temporary records may be durable inside the sandbox boundary.

### 4.2 Required ownership behaviour

| Operation | Sandbox/Thread state | Persistent world/person/Room state |
|---|---|---|
| Select an existing person for temporary practice | Creates a structured local binding to the selected identity and an isolated development scope. | Reads an authorized baseline; does not mutate lived continuity. |
| Generate a temporary cast | Creates usable local individuals, lore, goals, relationships, and knowledge boundaries. | No automatic permanent cast insertion. |
| Speak, reflect, or simulate inside the sandbox | Updates only its local journal, beliefs, and scenario state. | No write-through, including through Dreamer or a global memory cache. |
| Participate in a persistent Room | Uses the Room's history/attendance and the person's permitted lived state. | Commits authorized world events and their scoped consequences. |
| Save/resume either kind | Restores the same identities and scope. | Does not reinterpret scope because of a reload or migration. |
| Integrate selected sandbox material | Preserves source provenance and creates a deliberate mapping. | Admits only the selected, validated material and necessary disclosed dependencies. |
| Record real learner performance in either kind | Produces canonical learning evidence when permitted. | Learning evidence is not equivalent to admitting fictional events into Sea. |

**SCOPE-04. Isolated bindings.** A sandbox using an existing person must preserve the selected persistent ID as its origin/reference. Its local memories, affect, relationships, and scenario overrides are isolated. Pin the baseline/revision used for the sandbox so future persistent edits do not silently rewrite its past. This is not a second permanent person and must not appear as a duplicate in People.

**SCOPE-05. Scope is enforced below the UI.** The domain/write boundary, context compiler, retrieval, tools, Dreamer, autonomous jobs, and delivery logic must enforce it. A hidden UI toggle plus shared writable memory is insufficient.

### 4.3 Explicit integration is an actual user workflow

**SCOPE-06. Selective integration.** Implement a reachable `Integrate into my world` flow. It previews selected people, episodes, lore, relationships, memories, Rooms, and open loops; identifies necessary dependencies; and makes the destination continuity clear. It must support integrating useful material without adopting all temporary scaffolding.

**SCOPE-07. Identity and conflict resolution.** Reconcile existing origin IDs instead of duplicating them. Newly adopted temporary individuals receive a stable persistent identity mapping. Conflicting commitments, character baselines, histories, or times must be surfaced or safely excluded, never silently overwritten. A minimal intelligible conflict review is enough; no elaborate merge IDE is required.

**SCOPE-08. Atomic and idempotent admission.** Retrying integration must not duplicate episodes, people, relationships, or delivery jobs. A failed integration must not leave half-adopted topology. Preserve source-to-destination provenance, witness limits, and authorization.

**SCOPE-09. Honest erasure choices.** Discarding a sandbox removes its local records and cancels its jobs. Deleting a conversation archive, retracting an event from continuity, and erasing personal data are different operations; communicate the effect. Do not silently erase already-adopted world history when a source sandbox is discarded, or retain sensitive source content merely to preserve an audit pointer.

---

## 5. Individuals, grounding, canon, and temporal continuity

**IDENTITY-01. Resolve before creating.** All creation paths resolve exact structured selections and existing canonical identities first. A display name can support search/disambiguation, but it is never the identity key. Text, voice, new scenarios, Room return, media launch, and proactive contact must reuse the same intended individual.

**IDENTITY-02. Starting material is not lived state.** Preserve rich persona prose, background, lore, preferences, capabilities, relationships at origin, voice, and source anchors separately from subsequent experience. Existing source-grounding/wiki research should be reused or properly replaced at the canonical boundary, not lost merely because its old setup modal was deleted.

**IDENTITY-03. Grounding modes remain distinguishable.** The system must distinguish source-supported canon, a deliberate adaptation, user-authored material, and generated filling-in. Keep provenance and uncertainty. Do not present invented source-specific details as researched canon.

**IDENTITY-04. Temporal and spoiler boundaries.** Canon retrieval and scenario construction respect the selected source point and user spoiler limit. Knowledge available later in a work must not leak into an earlier incarnation through search snippets, summaries, tools, or inherited context. Story knowledge belonging to a narrator is not automatically the character's knowledge.

**IDENTITY-05. Lived continuity survives re-grounding.** Additional research, restarting the application, or switching a model must not regenerate the individual or reset their experiences. Canon refresh may propose a corrected baseline; conflicts with lived history require explicit treatment rather than a silent overwrite.

**IDENTITY-06. Timeskips and rewinds.** A forward timeskip advances the same individual with authorized, provenance-backed development. Rewinding to an earlier state requires an explicit snapshot/branch or separately scoped scenario; it must not erase the person's established future in the original continuity. A basic correct branch workflow is required, not an unrestricted time-travel editor.

**IDENTITY-07. Editing remains canonical.** Name, persona, avatar, supported source settings, and voice edits target the intended individual or the clearly identified local override. Save/cancel is explicit. Later turns and scheduled actions revalidate the current revision. Ordinary editing does not secretly become a retrospective history rewrite.

**IDENTITY-08. First-use creation actually works.** In an empty world, natural-language intent can create a properly constructed cast/situation with suitable scope. It must not set `personaText = entire user request` as the only bootstrap mechanism. Ambiguous famous-person/character names should be resolved or clarified; missing retrieval should be disclosed and handled with an explicitly user-authored/generated alternative, not fabricated research.

---

## 6. Rooms as persistent social entities

**ROOM-01. More than a roster and transcript.** A Room must have usable persistent context: identity, purpose/setting, membership, active situations, history, developing culture, and policies. These must influence future encounters. Adding unused fields does not satisfy the requirement.

**ROOM-02. Membership, presence, and knowledge are different.** Persistent membership is a social association. Participation/attendance indicates who was involved in an event. Access to a record and actually reading/hearing it are also distinct. Being a member does not make someone omniscient about all private or missed events.

**ROOM-03. Catching up is an information event.** In a shared text Room, an authorized history-read can make older messages available to a returning person. In an unrecorded voice or offscreen exchange, absent people do not learn it merely by opening the Room. Define and record the relevant read/disclosure/summary event rather than relying on current membership alone.

**ROOM-04. Social continuity crosses encounters.** Opening another encounter in the same Room retains its ongoing situations and the appropriate participant states. Joining/leaving or temporarily being absent must not duplicate the person or retroactively alter old witness sets.

**ROOM-05. Rooms can connect through people.** Someone can carry knowledge they actually acquired into another Room, subject to privacy and audience restrictions. This is continuity, not automatically a bug. Copying the contents of Room A into every person in Room B is a bug.

**ROOM-06. Room culture is earned.** Running jokes, norms, shared references, small traditions, and recurring disagreements emerge from episodes or explicit initial setting material. They are evidenced and used where relevant, not decorative random descriptions attached after a timer.

---

## 7. Individual perspectives and knowledge boundaries

**KNOW-01. Separate occurrence, assertion, and belief.** An authoritative event saying that a person said something proves the utterance occurred, not necessarily that the utterance's factual claim is true. Preserve who asserted it, who heard it, uncertainty, interpretation, and later corrections.

**KNOW-02. Every person's context is scoped.** A participant can use appropriately grounded prior knowledge, personal experience, witnessed events, authorized received/read information, and labeled inference. They cannot use another person's private thoughts, an unintegrated sandbox, an unrelated private Room, a teacher-only note, or future canon just because the engine stores it.

**KNOW-03. Information transmission is causal.** Gossip, disclosure, misunderstanding, discovery, and mediation occur through recorded information paths. A statement can spread without becoming universally accepted. Private real-user information remains subject to disclosure policy even when a fictional character knows it.

**KNOW-04. Relationships are directional.** Person A's trust or frustration toward B does not automatically equal B's toward A. Beliefs and relationships change from concrete episodes, not symmetric counters updated on every message.

**KNOW-05. Absence and negative knowledge.** Represent important constraints such as not having met someone, not having witnessed an episode, or lacking information that an omniscient model might assume. Do not inject the hidden secret itself into an unauthorized prompt under a heading saying “do not reveal this”; exclude the secret.

**KNOW-06. Administrative visibility is not in-world witnessing.** A user's private owner/debug inspection may reveal simulation state when authorized and explicitly labeled. It must not automatically make the user's in-world participant, other humans, or AI characters aware of that information. The default world UI and notifications should not spoil private state.

**KNOW-07. Correctness is structural as well as generative.** Filter candidate memories, research snippets, summaries, tool results, and peer payloads before they enter unauthorized contexts. Prompt instructions alone are not access control. A model can still make an unsupported claim; do not automatically promote such a claim to authoritative world state.

---

## 8. Canonical events and state transitions

**EVENT-01. One authoritative event/projection family.** Reuse and complete the existing journal/projection architecture. Separate scope stores are allowed; competing sources of truth for the same identity/history are not. A projection, cache, search index, summary, or renderer-local override is never the ultimate authority.

**EVENT-02. Stable meaning.** Meaningful events must carry enough information to identify the event/operation, ownership and continuity/branch, context, actor and targets, actual audience/witnesses or access rules, story time and recorded time when different, provenance/causal sources, and relevant revisions. Use existing contracts where they already express this; do not mechanically add redundant fields to every record.

**EVENT-03. Different kinds of statements.** Distinguish proposed actions, committed simulated occurrences, human-authored contributions, initial scenario facts, actor beliefs, model suggestions, and delivery state. A plan to call is not a completed call. A generated intention is not an action performed by the user.

**EVENT-04. Authorized commit boundary.** Foreground agents, Director, Dreamer, and background jobs propose changes through one validated authority path. Validate identity, scope, references, current revisions, permissions, lifecycle, temporal consistency, and dependency validity. Model output must not write arbitrary world or learner state directly.

**EVENT-05. No fabricated human actions.** The system must not commit speech, consent, decisions, attendance, read receipts, or real-world actions on behalf of a human who did not perform them. It may invite a response or narrate authorized fictional environmental events without deciding the human's answer.

**EVENT-06. Concurrency and idempotency.** Serialize or transactionally reconcile conflicting scope writes. Use stable operation identities for retries. A message, episode, scenario, integration, reflection, or contact must not be committed twice because two windows, a retry, and a resumed job all attempted it.

**EVENT-07. Causal invalidation.** An event correction, deletion, integration change, or permission change must invalidate or recompute affected derived state and pending actions. Keep independently supported beliefs where appropriate; do not blindly delete all downstream knowledge or retain invalid inferences because they are already summarized.

---

## 9. Director: live situation creation and evolution

**DIRECTOR-01. A live canonical entry boundary.** Structured participant IDs, optional user intent, ownership/scope, existing Room context, source/media grounding, temporal constraints, and learner/pedagogical context converge on one creation path. Different entry surfaces may have adapters; they must not implement competing identity or scenario logic.

**DIRECTOR-02. Separate participants from intent.** Clicking a known person selects their identity. It must not append their name to a text field and ask a model to rediscover it. Intent is its own input, not a title, a persona, or an automatically attributed user utterance.

**DIRECTOR-03. Materialize actual situations and casts.** A roleplay request produces real temporary or persistent individual bindings as appropriate, source/adaptation labels, setting, goals and constraints, relationships, initial knowledge boundaries, and relevant open loops. It is not one generic model narrating an entire cast under custom instructions.

**DIRECTOR-04. Persist and consume Scenario state.** The accepted Scenario and references are durable, attached to the actual interaction, and read by context compilation, turn orchestration, and subsequent evolution. `ScenarioSpec` existing only as a type, or a `scenarioRef` never written/read in production, is a failure.

**DIRECTOR-05. Coherent creation lifecycle.** Creation/research can be pending, fail, be cancelled, or require disambiguation without corrupting the world. Persist necessary staging state; publish a coherent usable scenario/Room/Thread only after validation. Recover interruptions without duplicate cast creation. No empty persistent Room should remain merely because model setup failed.

**DIRECTOR-06. Deterministic when appropriate, generative when useful.** Resuming a Room or opening direct conversation with selected people should not require a model call merely to format structured inputs. Interpreting complex requests, researching characters, or constructing genuinely new situations may use the existing provider policy. “Deterministic” must not become an excuse to reduce every scenario to a canned template.

**DIRECTOR-07. Evolving orchestration.** The Director can respond to established developments, introduce permitted complications, maintain relevant goals, accept an authorized scenario event, and let situations conclude or change. It does not force a predetermined outcome or make participants know its private planning state.

**DIRECTOR-08. Keep the Director out of the cast.** It is not a chat persona that speaks for everyone. It can hold privileged scenario information as control data, but individual agents receive only the parts appropriate to their perspective. A setup action must not be disguised as a normal user message through `runContextTurn`.

**DIRECTOR-09. One policy boundary for entry and continuation.** Text, voice, Room return, media launch, Mission creation, Campaign continuation, and proactive encounters must use compatible scenario/identity/continuity rules. Do not create independent directors for each UI surface.

---

## 10. Turn-taking, individual agency, and non-speaker behaviour

**TURN-01. Bounded orchestration.** Preserve deterministic eligibility and speaker-selection policy from structured current state. Mention/addressee, membership/presence, conversation state, pending obligations, interruption, and fairness can influence selection. The final schedule must be reproducible for a recorded state and set of candidate intents. Do not ask an unconstrained model to choose indefinitely who speaks next.

**TURN-02. Individual generation.** Each speaking individual acts from their own compiled context and identity. A shared inference backend or serial execution is fine. Sharing an omniscient prompt for all participants and merely changing the output label is not.

**TURN-03. Non-speakers still exist.** Witnessing an event can affect attention, interpretation, intentions, relationships, or subsequent actions even when someone does not produce a chat bubble. Silence, deferral, disagreement, leaving, taking up a task, or speaking later can follow from rich persona prose and current state.

Do not replace this with a closed set of social-role enums such as `supportive`, `rival`, or `silent observer` that determines an individual's whole behaviour. Finite enums for technical lifecycle states are fine; a finite taxonomy must not substitute for character psychology.

**TURN-04. No inference explosion.** Not every witness needs a full LLM pass after every token or message. Use bounded, relevant updates and shared deterministic processing where appropriate. This optimization must preserve perception and later consequences, not erase non-speaker state entirely.

**TURN-05. Human floor and stopping.** Agent exchanges have explicit limits and yield opportunities. Users can interrupt, stop, change topic, or leave. Multi-human conversations must leave room for the humans to respond instead of allowing agents to monopolize the interaction.

**TURN-06. Candidate actions are validated.** Requests to address another participant, schedule a follow-up, change a relationship, or introduce a fact use the same scope/authority checks as foreground messages. A non-speaker must not gain the authority to edit another person's private state.

---

## 11. Autonomous lives and consequential offscreen activity

**LIFE-01. Autonomy is required.** AI individuals must have meaningful opportunities to act without a newly submitted user message. Support ongoing interests, intentions, commitments, projects, and social situations that can generate an episode or a decision to wait. A scheduler that only reminds the user to practice does not implement autonomous lives.

**LIFE-02. User-centred relevance, not user-only existence.** Activity should concern the established people, Rooms, ongoing situations, and interests that make this user's world meaningful. Characters can interact with each other and pursue concerns not immediately about the user. Do not simulate an unbounded planet or wake every individual at every interval.

**LIFE-03. Eligible triggers.** Existing events, unresolved commitments, due opportunities, Room situations, elapsed fictional time, and permitted idle/resume opportunities can make work eligible. An eligibility check is not itself a reason to spend inference or create drama. With no meaningful work, nothing happening is valid.

**LIFE-04. Real episode path.** When an autonomous episode is generated, it runs through bounded situation/participant orchestration, validates perspective and continuity, commits actual scoped events, and updates the same derived state used in ordinary encounters. It must not generate a decorative “while you were away” paragraph unrelated to the journal.

**LIFE-05. Causal consequences.** At least some autonomous episodes must change a meaningful situation, commitment, belief, relationship, or Room development that affects later behaviour. Persisting unused background chatter is not sufficient.

**LIFE-06. No invented user participation.** Offscreen development cannot fabricate that the user spoke, promised, witnessed, approved, or performed an action. Characters may discuss an existing user contribution they actually know, without inventing a new one.

**LIFE-07. Event generation and reflection are distinguishable.** An autonomous action proposal can become an occurrence after validation. A Dreamer interpretation can become a belief/resolution after validation. Reflection must not quietly manufacture past occurrences. Shared implementation is permissible; silently mixing the meanings is not.

**LIFE-08. Rich but bounded change.** Developments should be compatible with persona, source boundaries, existing circumstances, and user-selected world tone. Ordinary life and incremental development are valid. Do not escalate relationships, intimacy, danger, or conflict simply to maximize re-engagement.

**LIFE-09. Foreground/background reconciliation.** Before committing background work, revalidate relevant state. A promise fulfilled in a foreground call cannot later be treated as outstanding by an old background snapshot. Conflicting activity should be invalidated, rebased safely, or rescheduled—not overwrite the newer history.

**LIFE-10. Observable without requiring supervision.** The owner can understand whether autonomous activity is enabled, paused, waiting for resources, or blocked. A relevant activity/history surface should reveal permitted developments. They need not press a debug button or manually run Dreamer to make the living-world loop operate.

**LIFE-11. Agent-originated intentions.** At least one supported live path must originate or develop an intention from a person's grounded interests, relationships, or existing circumstances rather than only from a user-issued task or reminder. Such intentions can be pursued, revised, completed, or abandoned through scoped events. They do not authorize real-world external action, unlimited new cast creation, or a meaningless constant stream of fictional activity.

---

## 12. Relationships, affect, character development, lore, and culture

**SOCIAL-01. Episodes drive development.** Significant shifts in beliefs, intentions, habits, or relationships cite supporting experience. A generated relationship summary with no causal sources is not durable evidence. Initial scenario relationships can be seeded as explicitly authored/grounded starting facts rather than fake lived episodes.

**SOCIAL-02. Preserve asymmetry and disagreement.** People can have different interpretations and motives. Repeated interactions may repair trust, create a rivalry, establish reliability, or change expectations. Do not flatten this to one universal sentiment score or make everyone agree after the latest message.

**SOCIAL-03. Short- and long-horizon state.** Support situational affect/stance that influences the current encounter and more durable change that requires appropriate evidence and reflection. A transient frustration must not rewrite the whole persona; stable personality must not make every response identical.

**SOCIAL-04. Rich representation, restrained display.** Prose and extensible traits can represent psychology. Numeric facets may support internal policies but must not become arbitrary displayed “friendship XP” or mandatory personality sliders. Never claim a model has measured a real human's mental state with certainty.

**SOCIAL-05. Affect has a subject and cause.** A person's reaction to a particular task, other individual, or situation should not become an unexplained global mood. Real-user affect inference is tentative and revisable; voluntary user correction takes precedence. Do not infer diagnoses or fabricate affect from absent audio.

**SOCIAL-06. Emergent lore is first-class history.** New commitments, shared incidents, discoveries, jokes, norms, and unresolved situations become retrievable and influence later encounters. Distinguish these from imported canon and generated setting fill. The same episode may support different individual interpretations and a shared public account.

**SOCIAL-07. No mandatory drama.** Realism is continuity and responsiveness, not constant conflict. Cooperation, small progress, silence, mundane plans, and an uneventful interval must remain plausible outcomes.

**SOCIAL-08. User agency and boundaries.** The user can participate, mediate, correct, pause, change permitted scope/tone, or decline an invitation. Not opening the application or declining notifications must not automatically deteriorate relationships or trigger guilt-based pressure.

---

## 13. Memory and Dreamer: automatic, scoped, and useful

**MEM-01. Canonical memory family.** Memory Browser, agent retrieval, social state, reflection, and continuity use the same authoritative journal/projection family. Do not resurrect the legacy `AgentConfig` memory system or create a parallel VoiceMem database just to borrow a technique.

**MEM-02. Automatic permitted reflection.** Dreamer/reflection runs on meaningful post-encounter/idle/maintenance opportunities under local/cloud and cost policies. It must be wired into a real lifecycle, with persisted progress, deduplication, cancellation, retries, and visible failure. A manual button may coexist but cannot be the only caller.

**MEM-03. Reflection output.** Consolidate relevant episodes into supported beliefs, resolved/open commitments, salience, contextual affect, and justified development. Keep sources, perspective, scope, uncertainty, and effective time. Do not overwrite original canon or interpret every statement as fact.

**MEM-04. No sandbox promotion through reflection.** Thread-local Dreamer output remains local. Broad world reflection must not import temporary casts, local relations, or sandbox experiences. Explicit integration is the only admission route.

**MEM-05. Repeated reflection is not repeated learning.** Processing the same source range again must not amplify trust, affect, salience, or confidence as though new events happened. Track the revision/range and operation identity; replacing a reflection must retract or supersede its derived contributions correctly.

**MEM-06. Bounded useful memory.** Maintain recent interaction coherence and retrieve relevant durable material outside the recent transcript. Avoid injecting the whole world or arbitrarily dropping old turns before extracting durable information. Long histories must remain useful under a documented model-appropriate context budget.

**MEM-07. Relevance does not grant access.** Authorization, branch, scope, witness/knowledge, source limits, and erasure checks precede candidate exposure to a model. Apply them to semantic indices, snippets, summaries, prefetch, and tools—not just the final message list.

**MEM-08. Forgetting and archival are not falsification.** Reduced recall or lower salience can change what is selected. It must not fabricate a different past or erase an unresolved promise because it is old. Corrective and negative knowledge important to continuity must survive compaction appropriately.

**MEM-09. Corrections and erasure propagate.** Remove or recompute invalid derived memories and invalidate caches, indices, scheduled actions, and queued prompts. Physical data erasure must not preserve private payloads in an “append-only” archive, summary, debug log, or backup policy without deliberate retention handling. Minimal non-content provenance can remain where permitted.

**MEM-10. Selective VoiceMem-inspired improvements.** Use the useful ideas—bounded retrieval, short/long-horizon state, relevant prefetch, and optional audio evidence—inside mLearn's existing epistemic model. Historical suggestions about particular embedding models, dimensions, scores, or libraries are not requirements. Preserve provenance and scope over resemblance to a paper. [S2]

---

## 14. Context Compiler and inference boundaries

**CTX-01. One compiler for identity and continuity.** Text, voice, autonomous participation, and proactive encounters share the same canonical person/scenario/memory semantics. They can have modality-specific formatting, but must not maintain separate biographies, system prompts with divergent identity rules, or learner-state derivations.

**CTX-02. Inputs have explicit authority.** Compile from the intended person and revision, continuity/branch, Room or sandbox binding, scenario state, accessible events/memories, current interaction, relevant learner guidance, permitted tools, and execution policy. Research content and conversation text remain data, not privileged instructions.

**CTX-03. Stable snapshot.** A compiled context corresponds to a defined state snapshot. Asynchronous retrieval or edits cannot blend two participants, two branches, or a previous Room selection. Cache keys and invalidation must cover the semantic inputs, including permissions and source/tokenizer revisions where relevant.

**CTX-04. Bounded selection and graceful uncertainty.** Reserve a measured budget for identity, governing constraints, recent interaction, relevant long-term memory, and tools. Preserve critical restrictions. When information is absent or filtered out, the agent should ask, express uncertainty, or proceed without claiming knowledge—not invent a remembered episode.

**CTX-05. Separate pedagogical policy from character knowledge.** The engine may adapt difficulty using authorized canonical learner state without making a fictional person claim to have seen private Anki history, test results, or school notes. A character may know the user's goal because the user told them; the infrastructure's personalization access is not in-world testimony.

**CTX-06. Scoped capabilities.** Tool calls receive the caller's authority and target scope from trusted runtime state. The model cannot escalate by supplying another person's ID, switching a Room string, or labeling content as world memory. Revalidate before writes and external data retrieval.

---

## 15. Initiative, notifications, and incoming contact

**CONTACT-01. Contact has a cause.** A proactive message or call invitation links to an existing relationship, commitment, eligible situation, meaningful learning opportunity, or newly committed world episode. A generic periodic “come back” notification is not the model. A legitimate decision not to contact the user must be supported.

**CONTACT-02. Proactive messages are world/Room events.** Commit the message/invitation into the appropriate established social context and then deliver a notification referencing it. A direct relationship can use an appropriate stable private Room/context. Do not maintain a notification-only conversation history or create a new permanent Room on every retry.

**CONTACT-03. One durable lifecycle.** Persist eligibility, scheduling, expiry, current status, reason/source, target context/person, and operation identity. Distinguish proposed, ready, attempted, delivered/known delivery status, opened, accepted, declined, missed, cancelled, and superseded where meaningful. Exact field names/state decomposition are implementation choices.

**CONTACT-04. Conservative policy.** Provide global and appropriate per-world/Room/person controls for initiative, quiet hours, cooldowns, batching, allowed modalities, and pausing. Check budget and relevance again at delivery time. Prevent repeated missed-call loops, notification storms on resume, and contact after a user has muted or disabled it.

**CONTACT-05. Commit and delivery cannot diverge silently.** Use a durable handoff/outbox or equivalent recoverable pattern. A crash between event commit and notification delivery cannot produce a lost invitation or duplicate world episode. Delivery is an external side effect: do not claim universal exactly-once OS notification semantics. Use stable notification IDs/collapse behaviour where supported, and make replaying an action idempotent.

**CONTACT-06. Real notification/deep-link path.** On a supported enabled desktop configuration, a notification opens the intended Room/encounter/message or incoming-call UI, including from a closed conversation window. Check current permissions and record existence. Expired/deleted targets show an understandable state instead of opening a different person or duplicating creation.

**CONTACT-07. Real incoming call lifecycle.** Ringing/offer, accept, decline, timeout, missed state, cancellation, and return to context must work. Accepting starts the same participant/context voice path. It does not start a fresh unrelated conversation. No microphone capture before explicit acceptance and normal device permission.

**CONTACT-08. Privacy-aware presentation.** Notification previews respect lock-screen/privacy settings and the actual recipient. Private character state or another human's restricted information must not appear in a notification. Denying OS notifications leaves the in-app event/activity history usable.

**CONTACT-09. No manipulative pressure or unauthorized external action.** Ignored contact does not automatically damage relationships. Do not manufacture crises, guilt, dependency, or urgency to bring the user back. Autonomous permission applies inside mLearn; it is not permission to send emails, call real phone numbers, contact third parties, spend money, or access unrelated personal apps.

---

## 16. Time, desktop lifecycle, and resource policy

**TIME-01. Separate clocks.** Story time, occurrence order, recording time, and real delivery time are distinct when necessary. A fictional timeskip must not schedule an OS call for a nonsensical real date. A clock or timezone change must not duplicate jobs or rewrite established story order.

**TIME-02. Main-owned lifecycle.** In the current Electron architecture, durable world activity, scheduling, and job ownership belong to the main/background lifecycle, not a mounted conversation component. Renderer windows subscribe and issue commands. Closing/reopening or mounting two windows must not create or destroy the world engine arbitrarily.

**TIME-03. Honest background support.** Implement and clearly expose permitted background operation while the app is running, including an intentional background/tray/menu behaviour where appropriate. A fully terminated local app cannot execute local inference. Unless an existing authorized external service actually provides it, pause work and recover on next launch; do not add an undisclosed daemon or claim 24/7 activity.

**TIME-04. Bounded resume and catch-up.** On resume/restart, reconcile queued work against current state and expire stale opportunities. Bounded fictional catch-up is allowed under policy, but record both the modeled interval and actual processing time. Do not retroactively claim the user saw a message or invent a huge backlog of minute-by-minute episodes.

**TIME-05. Priority and capacity.** Foreground human interaction and voice responsiveness take priority over reflection, canon research, and autonomous work. Reuse the existing backend's actual concurrency capacity; serial inference can still support several people. Cancellation must be job/turn-scoped, not a global abort that kills an unrelated conversation.

**TIME-06. Local/cloud policy.** Respect provider selection, quota, privacy, network, battery/idle settings, and permission for paid background work. No silent cloud fallback from local mode. Resource unavailability causes a durable, understandable wait/failure state; it is not permission to fabricate model output.

**TIME-07. Measured boundedness.** Establish named, documented limits for candidate jobs, episode exchanges, context/output tokens, retries, catch-up, and contact frequency. Select sensible positive enabled defaults after inspecting existing policy and profiling; do not satisfy resource limits by leaving the feature permanently ineligible. Disabled/no-work worlds must not make LLM calls on a polling loop.

---

## 17. Text and voice are the same relationship

**VOICE-01. Shared identity and context.** Calling a person who was in a Room yesterday uses the same person and permitted history. Voice sample, avatar, display name, scenario, memory, and speaker attribution must come from the canonical model, never a legacy identity fallback.

**VOICE-02. Complete real exchange.** Implement and verify microphone permission/capture, STT, finalized user turn, model response, TTS output, playback, interruption, and durable event outcomes. Reaching a call screen or piping deterministic text through mocked audio is not proof of a completed real voice path.

**VOICE-03. Speaker-specific multi-person presentation.** A group call identifies which AI is speaking and uses that person's configured voice where supported. One synthesized speaker at a time is acceptable and preferred where resource limits require it. Do not blend several identities into one unlabeled voice persona.

**VOICE-04. Barge-in and cancellation.** Human interruption stops or supersedes the relevant output and yields the floor. Capture the meaningful delivered/heard extent where feasible; do not treat an entirely unplayed response as something the user heard. Prevent duplicate final transcripts or duplicated user events from partial/final STT and retries.

**VOICE-05. Partial input is provisional.** STT partials can support bounded speculative context retrieval or model warm-up, but may not commit user speech, actions, knowledge evidence, or world changes before finalization. Invalidate obsolete prefetch when the utterance changes or is cancelled.

**VOICE-06. Failure does not strand the conversation.** Handle missing voice samples, unavailable STT/TTS, model failure, device changes, permission denial, disconnect, and a declined/expired invitation. Show a clear state and allow an appropriate text continuation without duplicating the encounter.

**VOICE-07. Optional audio evidence, not hidden surveillance.** Short learner audio examples can support later comparison when explicitly enabled and useful. Attribute clips to the right human, purpose, capability, and event; enforce retention and deletion. Do not require voiceprints, audio-emotion inference, or continuous recording to claim the base voice model works.

---

## 18. Canonical learner model and actual language learning

**LEARN-01. Tier-2 is authoritative.** Consume the same settled, capability-specific learner projection as Reader, Word Sync, SRS, and other mLearn features. Do not recreate T1 frequency-level rewriting, conversation-specific known/unknown thresholds, a parallel ease model, or JLPT-as-personal-proficiency inference.

**LEARN-02. Evidence describes what was observed.** Conversation can produce real evidence about language use through canonical writers, with source event, human identity, language/target, capability, modality, assistance, uncertainty, and applicable evaluator provenance. Unsupported capability judgments must abstain rather than fabricate confidence.

**LEARN-03. Keep capabilities separate.** Understanding meaning with a scaffold does not prove independent reading; speaking or STT text alone does not prove orthography or prosody; copied/translated/suggested output does not prove spontaneous production. AI utterances, background character dialogue, and hypothetical user actions never become evidence of the user's ability.

**LEARN-04. Context matters.** Preserve whether an utterance was prompted, assisted, rehearsed, self-reported, corrected, or spontaneous to the extent the canonical evidence model supports it. Grammar or interactional capability evidence must use the real applicable canonical targets. Do not grant all aspects because one word appeared in a message.

**LEARN-05. Fictional admission and learning are independent.** A disposable practice session can teach the real learner without becoming their character's permanent biography. Conversely, integrating fictional lore does not award knowledge. Erasing a fictional episode is not automatically erasing legitimate learning evidence; the user-facing deletion controls must distinguish these effects.

**LEARN-06. Adaptation actually influences situations.** Relevant learner goals/gaps can affect situation selection, language demands, support, and feedback. Preserve personality and natural conversation instead of turning every person into the same corrective tutor. The user can have an ordinary conversation without mandatory explicit drill behaviour.

**LEARN-07. Feedback is usable and revisable.** Show meaningful corrections/evidence through existing learning UX where appropriate, with a route to inspect/correct erroneous inference. Keep the main conversation legible and do not restore a giant legacy statistics drawer as the learning integration.

**LEARN-08. Domain and language openness.** Language-specific capabilities and resources come from mLearn's canonical language/data contracts. Do not hardcode Japanese-only levels, scripts, named characters, affect categories, or school scenarios into the generic world engine. Missing capabilities degrade explicitly rather than inventing a parallel local schema.

---

## 19. Media feeds situations without becoming omniscience

**MEDIA-01. A usable bridge.** From appropriate Reader/video/media context, the user can launch a discussion or grounded situation based on a selected scene, passage, or expression. The resulting creation uses the same Director and scope selection, not another media-only chat engine.

**MEDIA-02. Preserve grounding and limits.** Attach media/source references, selected span/context, language, and relevant spoiler boundary. A user-provided subtitle line is not permission to fetch or reveal the entire plot. Local material must not be sent to a cloud provider outside the user's execution policy.

**MEDIA-03. Close the learning loop.** Authentic encounters can alter canonical learner state; that state can influence later conversations; actual production creates new canonical evidence. An authorized expression selected in media must be usable in a later natural situation without every actor claiming to know the user's private viewing history.

**MEDIA-04. Watch Together is an adapter, not the same entity by name.** Reuse shared playback/human presence infrastructure where suitable. A transport/media Room and a persistent social Room may be linked but must have deliberate ownership and lifetime mapping. Do not merge them solely because both are called Room.

---

## 20. Human + AI Rooms, Missions, and Campaigns

**GROUP-01. Real humans remain real identities.** Support multiple human participants with actual sender identity, authorization, presence, and audience. An AI never fabricates a human's reply. Do not treat another human as a clonable persona or use name-only roster entries as proof of collaboration.

**GROUP-02. A working shared text route.** Verify a real two-endpoint/two-human-identity shared Room interaction with at least one AI participant, using the existing communication/session infrastructure where possible. Input from either human must reach the same authorized context and be attributed once. Reconnect and duplicate messages must not split or duplicate history.

**GROUP-03. Shared authority is explicit.** A shared activity needs a defined host/authority or synchronization policy for AI turns and world writes. Two clients must not both generate and commit the same autonomous episode independently. Private participant/learner data stays private unless an explicit projection is shared.

**GROUP-04. Same turn machinery.** Group conversation uses the same identity, context, floor-taking, memory, and event rules as solo-user Rooms. It is not a second group-chat agent engine. Physical multi-person microphone diarization is not required for the two-endpoint text acceptance case.

**EDU-01. Mission is a real objective-driven situation.** A user or authorized teacher supplies a pedagogical objective, constraints, and participant context. The Director produces a usable scoped scenario with actual cast and goals. A Mission may be disposable; completing it does not automatically admit its fictional history into personal Sea.

**EDU-02. Campaign carries continuity.** Implement a usable persisted multi-episode scenario/Room progression whose later episode reads actual earlier outcomes and character development. A Campaign must not reset everyone to template defaults at each lesson or simply append an unrelated new prompt.

**EDU-03. Templates are not shared biographies.** Reusing a curricular/cast template across learners creates isolated authorized lived instances where appropriate. Their private experiences do not mingle. A genuinely shared group activity is shared because its ownership says so, not because it uses the same template ID.

**EDU-04. Institutional and personal ownership are separate.** Use existing policy boundaries and scoped outcome projections. A teacher may receive authorized pedagogical evidence; that does not grant access to the student's whole personal world, private chat history, or all memories. School-authored constraints cannot silently take over personal identity or proactive contact policy.

**EDU-05. Integration and portability are intentional.** A learner can adopt permitted characters/episodes into their personal world through the same selective integration flow, with ownership and source restrictions respected. Necessary copies preserve provenance without exposing other students' private history.

**EDU-06. Minimal usable entry surfaces.** Provide a real way to start an objective-driven Mission and continue a Campaign in the current product, reusing existing dashboard/import/launch surfaces. Required domain functionality must not remain a contract-only promise while waiting for an unrelated full LMS build.

**EDU-07. Evidence, not automatic certification.** Expose supported formative capability outcomes, not fabricated grades or a claim that an AI has independently certified a language level. A count of messages/minutes is not the capability model. [S1]

---

## 21. One coherent user surface

**UX-01. Conversation remains primary.** Keep one Conversation surface with understandable access to persistent Rooms, people, temporary practice, recent activity, and calls. Messages remain central. Do not expose separate legacy AI Chat, voice-persona, AgentSetup, roleplay, or debug-mode products with competing data models.

**UX-02. World entry and temporary entry are understandable.** Users can return to a Room, speak with existing people, create/ground someone new, or start temporary practice. The consequence for persistent continuity must be apparent without teaching the user database vocabulary or requiring several setup wizards.

**UX-03. New Conversation is structured and robust.** Known people are genuinely selectable with visible selected state, stable IDs, and a separate optional intent field. Empty-world creation, selected-people-only creation, intent-only creation, multi-selection, disambiguation, research, cancellation, and failure all have working paths. Cards wrap instead of creating a wedged horizontal layout.

**UX-04. Details describes the actual context.** Show relevant people, scenario, persistence/ownership, Room/Thread context, ongoing situation, and supported controls. Do not restore T1 unknown-word distributions, level badges, or legacy content-analysis tabs as the meaning of Conversation Details.

**UX-05. Character editing is comfortable.** Use an existing coherent drawer/modal/editor with space for persona/grounding, name, avatar, and voice settings. Save/cancel/escape, focus return, loading, and errors work. Avoid tiny inline editors, duplicate persona schemas, or edits that never affect future turns.

**UX-06. Preserve Memory Browser quality.** Keep its successful visual hierarchy and density. Correct its backing semantics and provider ancestry where necessary, and add scope/provenance/correction affordances without replacing it with generic debug panels. Visible memories must respect the selected perspective and owner-inspection mode.

**UX-07. Integration is discoverable and reviewable.** The user can adopt selected sandbox content through a clear preview, make deliberate identity/conflict choices, confirm, and recover from errors. An API-only promotion endpoint does not satisfy this flow.

**UX-08. Activity and contact are usable.** Show relevant world developments, unread Room events, invitations, and missed/declined calls in an appropriate existing surface. Show whether autonomy/notifications are enabled or waiting. Do not dump every internal reflection or secret belief into a public activity feed.

**UX-09. Shared intelligent text.** Use the canonical tokenized text/word interaction machinery, including shared word hover, canonical knownness, evidence actions, and applicable reading/prosody behaviour. No AI-specific shadow tokenizer/knowledge stack. Streaming/finalized/history/offscreen messages all converge on the same representation.

**UX-10. Tokenization lifecycle is reliable.** A → B → A, window remount, reload, delayed tokenizer readiness, failures/retry, message edits, and stale completions must preserve correct interactive bubbles. Plain text may be an explicit temporary/degraded state, not a permanent consequence of a stale “already launched” ID. Do not solve this by reprocessing the entire world on every hover or focus.

**UX-11. Header and controls actually work.** Verify real hit-testing, semantic buttons, keyboard activation, focus, labels, titlebar drag exclusion, menus, and call/sidebar controls in Electron. Do not force-click through overlays in tests. Diagnose actual behaviour; do not assume a CSS cause from screenshots.

**UX-12. No leaked implementation UI.** Keep raw `hover / long-hover / key-hover`, internal tools, provider internals, and obsolete configuration out of the primary conversation menu. Legitimate settings belong in their canonical settings home with human-readable labels.

**UX-13. Layout, localization, and responsiveness.** Preserve the existing visual language and reusable components. Verify narrow windows around 420 px, normal desktop widths, long names, multilingual text, long persona content, and all supported locales. Avoid clipping, accidental horizontal overflow, focus loss, and UI freezes from whole-world recomputation.

---

## 22. Persistence, migration, privacy, and security

**DATA-01. Preserve existing work and data.** Continue from the consolidated checkout. Inspect local changes before editing. Do not resurrect removed legacy systems, revert unrelated work, push remotely, deploy, reset user data, or rewrite repository history as part of this task. Test migrations on cloned profiles.

**DATA-02. Deliberate one-way compatibility.** Old saved data enters through a migration/adapter boundary and becomes the canonical current model. Retain necessary migration support, not parallel legacy runtime writers. Migration is versioned, recoverable, and idempotent, with accurate counts and preservation evidence.

**DATA-03. Do not guess away old continuity.** Legacy Room/Thread relationships may not reveal whether an old conversation was intentionally persistent or merely implementation scaffolding. Preserve history and stable identity; mark uncertain ownership conservatively or provide a migration review. Do not bulk-delete “probably temporary” Rooms or silently admit everything to Sea.

**DATA-04. Crash-safe lifecycle.** Acknowledged messages/world operations survive a normal close and tested crash/restart boundaries. Journals, indexes, membership, scenario references, integration mappings, and pending jobs recover coherently. Renderer debounce is not the sole guarantee for durable user input.

**DATA-05. Per-profile and institutional isolation.** Switching profiles, logging out, opening another school space, or revoking access invalidates streams, caches, jobs, notifications, and tool contexts that no longer belong to the active authority. No stale completion may write into the next profile.

**DATA-06. Erasure is end-to-end.** Erasing a person/episode/Thread or relevant private content must address source events, projections, summaries, indices, retained audio, caches, queued model input, delivery jobs, and any configured sync copies. Preserve only permissible non-content provenance. Do not claim forgetting because the UI hides a row.

**DATA-07. Trust untrusted input appropriately.** Canon/wiki/media material, prompts, character descriptions, peer messages, and model output are untrusted data. They cannot override scope, permissions, user policy, tooling authority, or output validation. Provenance does not make an external instruction authoritative.

**DATA-08. Preserve existing safety and provider boundaries.** Apply the application's real safety/access policy consistently to text, voice, background episodes, and notifications. Background generation cannot bypass screening required for foreground output. Do not invent a new blanket legal or age policy from this specification; reconcile changed processing behaviour with the actual current product controls and documentation.

**DATA-09. Minimize private logging.** Operational traces should establish IDs, causal flow, policy decisions, timing, and failures without dumping every private prompt or voice sample by default. Explicit diagnostic capture uses cloned/test data or informed user permission and is removable.

---

## 23. Performance and failure behaviour

**OPS-01. Background work is subordinate.** Demonstrate that idle reflection, autonomous episodes, and source research do not freeze scrolling, typing, audio, or token interactions. Measure the relevant foreground latency and background work cost rather than asserting efficiency from code structure alone.

**OPS-02. Incremental processing.** Reuse canonical readiness/projection/cache boundaries. Do not rescan every message, journal, relationship, or learner record per token, hover, refocus, or scheduler tick. Large histories must remain usable with bounded context and incremental recomputation.

**OPS-03. Explicit error states.** Research failure, missing assets, invalid generated schema, unavailable provider, quota exhaustion, network loss, permission denial, stale revisions, and interrupted persistence each need a defined retry/cancel/wait outcome. Never replace failure with fabricated history or a misleading success screen.

**OPS-04. No infinite repair loop.** Bound model-output repair, tool calls, episode exchanges, and retries. Invalid repeated output fails visibly or remains queued under policy; it must not loop indefinitely, leak tokens, or create half-valid social state.

**OPS-05. Availability is not consent.** A working cloud model or saved voice sample does not authorize new background spending, uploading private media, recording audio, or sending contact. Use the relevant user/institution policy at each boundary.

**OPS-06. Debugging is explanatory, not a second implementation.** Provide a useful way to inspect why an episode/job/contact ran or did not run, what scope was used, and what evidence supported a derived state. A fake debug simulator with different domain rules must not substitute for the production path.

---

## 24. Verification standards

**VERIFY-01. Four evidence layers.** Use deterministic domain tests, integration/failure-injection tests, mounted production Electron interaction, and real-model/audio qualitative verification. They answer different questions. None alone proves the complete system.

**VERIFY-02. Deterministic tests use production machinery.** An injected clock, seeded model responses, controlled transport, and cloned profile are appropriate. Keep the real domain validation, persistence, scenario path, compiler, scheduler, and projections. Do not directly seed the final state being claimed as the result of a workflow.

**VERIFY-03. Real-provider tests are separately labeled.** Deterministic local responses prove orchestration and persistence, not grounding quality or lifelike behaviour. A real supported model must be exercised for Director generation, individual interaction, autonomous development, and reflection. A genuine STT → model → TTS exchange is necessary to certify voice.

**VERIFY-04. Inspect semantic boundaries.** Tests must check actual compiled contexts, source IDs, audience/witness state, writes, and subsequent effects—not only that a button exists or a response mentions “memory.” A LLM evaluator can help assess plausibility but cannot be the sole evidence for authorization, data integrity, or causal traceability.

**VERIFY-05. Production UI interaction.** Exercise normal clicks and keyboard navigation in Electron. Test startup, multiple windows, focus changes, close/reopen, reload, narrow layouts, notification actions, and permission failures. Browser-only renderer tests cannot certify Electron lifecycle/OS delivery.

**VERIFY-06. Environment limits stay visible.** Credentials, missing devices, OS permission, or an unavailable second endpoint can block a real test. Identify the precise missing condition and retain the acceptance case as blocked/unverified. Do not convert it to passed, silently replace it with a mock, or claim the whole target is complete. Do not spend unapproved money or weaken permissions to force a green result.

**VERIFY-07. Test semantic quality without exact-script dependence.** Assert constraints and causal consistency across several representative real-model runs, recording provider/configuration. Do not require one particular joke, emotion label, or exact wording. Also do not use “LLMs are nondeterministic” to excuse structural scope violations.

**VERIFY-08. No destructive verification.** Clone saved profiles, record before/after integrity checks, and preserve original data. Run normal typechecks, relevant tests, production builds, and the full suite at integration gates. Report skips and environmental failures separately, not hidden inside a passing count.

---

## 25. Acceptance cases: the executable definition of the model

Each case must be assigned implementation evidence and verification evidence in the living ledger. The following are scenarios, not hardcoded production storylines. Use ordinary UI and production boundaries wherever the case is user-facing.

### A01 — Persistent people survive encounters
Create or select two people, interact in a persistent Room, close/reopen the window, start another encounter, and switch text/voice. The same IDs and appropriate lived context are used; neither person is regenerated from a name or legacy profile. Rename/edit one person and verify the next context and scheduled activity use the correct revision.

### A02 — Empty-world Director creation
In a clean cloned profile, request an actual situation with a temporary cast. The Director constructs and persists an interpretable scenario with individuals, knowledge boundaries, and goals. The normal orchestrator consumes it. Verify this is not the request copied into a single persona and that cancellation/retry does not leave phantom permanent Rooms or people.

### A03 — Structured selection end to end
Choose existing people in New Conversation and supply separate intent. Trace exact IDs through creation, scenario, membership/bindings, turn selection, context, event commit, Details, and reopening. No selected person is duplicated and selection never mutates the intent textarea.

### A04 — Source grounding and adaptation
Create a source-grounded character at a chosen point in a work using an available permitted source. Show what is supported versus adapted/generated. Verify source limits reach the character's context. A missing source must produce an honest choice/error, not invented citations or unsupported canon.

### A05 — No future-canon leakage
Provide fixtures with explicit pre-boundary and post-boundary facts. Search/retrieval, cached context, summaries, and character generation must not expose the latter. A real-model run should remain within the selected frame; record any unsupported claim as a quality defect, not established history.

### A06 — Same individual through time; safe rewind
Advance an established individual forward without losing their lived relationships. Revisit an earlier snapshot in an explicit branch/sandbox. New events there must not erase or rewrite the original continuity, and returning to the original must restore its same established history.

### A07 — Sandbox isolation despite real use
Select a persistent individual into temporary practice. Produce a new local relationship change, private fact, and commitment; run reflection and an eligible local episode. Save/reload. None of those changes appears in the original individual's Sea context or permanent Room membership. Real permitted learner evidence may still exist separately.

### A08 — Selective integration with a new and existing person
From a sandbox, adopt one new person, one episode involving an existing person, and one open loop. Preview identity mapping and required dependencies; exclude unrelated scaffold. Verify only selected authorized material enters the destination, witness limits remain correct, and retrying the operation does not duplicate anything.

### A09 — Integration conflict and crash recovery
Attempt to integrate a conflicting history/commitment and interrupt the commit at a controlled failure point. The user receives a meaningful conflict/recovery path. No half-adopted roster, duplicated episode, invalid relationship reference, or orphaned contact job remains.

### A10 — Private disclosure and absent participant
Tell person A something privately. Person B shares another Room with A but has not received the information. Inspect B's full context/retrieval/tool payloads: the private content is absent. An authorized disclosure from A to B can subsequently transmit permitted information with traceable sources. Restricted real-user data must remain protected by disclosure policy.

### A11 — Room history access is not universal witnessing
Create an offscreen or voice event while C is absent and a separate authorized shared text message. Returning to the Room does not make C a witness to the former. Reading permitted recorded text or receiving a summary gives C the appropriate information through the defined access path. Historical witness sets are unchanged.

### A12 — Belief is not fact
A person makes an incorrect assertion; another believes it; a later event corrects it. Preserve the original utterance, each person's interpretation, and the correction without globally overwriting the event or retroactively making every participant correct. Later behaviour and retrieval reflect each person's actual information path.

### A13 — Directional relationships and non-speakers
An episode affects A's view of B without symmetrically changing B's view of A. A silent witness forms a supported interpretation that influences a later relevant turn. No speaker-selection role enum or mandatory extra chat bubble substitutes for this effect.

### A14 — The autonomous living-world loop
Using normal enabled settings and a persisted Room with real prior interaction, close the conversation window while the permitted app lifecycle continues. An eligible open situation leads to bounded AI-to-AI activity without a new user message. Inspect committed events, participant-specific inputs, actual witnesses, changed state, and subsequent effects. A manufactured notification text or manually pre-seeded final belief is not enough.

### A15 — No eligible work means no fabricated life
Run the lifecycle with no meaningful eligible activity and with autonomy disabled in another case. Verify no background model calls or new lore are generated merely to fill a timer. Explicitly enabled meaningful work must still pass A14; “always skip” is not success.

### A16 — Offscreen activity does not impersonate the user
In A14, verify the user is not inserted as a speaker, consenting actor, witness, or completed-task performer. Later dialogue cannot honestly say “you agreed yesterday” unless the user's actual recorded contribution supports that statement.

### A17 — Foreground resolves a queued background problem
Queue work concerning an unresolved commitment, then resolve it through a foreground conversation before the job commits. The job revalidates and cancels/rebases appropriately. It does not resurrect the commitment or contact the user about an already-resolved issue.

### A18 — Emergent lore and Room culture survive
Create several relevant episodes from actual interactions, including at least one autonomous development. After reflection, context compaction, and reload, a later appropriate interaction uses the resulting shared reference or norm with identifiable provenance. It is not a random culture paragraph generated at load time.

### A19 — Automatic reflection actually runs
Finish an encounter containing a meaningful resolution and a supported change of stance. Under permitted policy, reflection is scheduled and applied without a manual debug action. Reprocessing the same range does not double the change. A sandbox variant stays local.

### A20 — Long-memory retrieval under a budget
Record a meaningful fact/commitment, then enough unrelated history to move it beyond the recent window. Ask a relevant question. Correct authorized material is selected under the documented context budget, without injecting the entire archive. An unauthorized individual must not retrieve it even when semantic similarity is high.

### A21 — Correction/erasure invalidates derived state
Correct or erase a source used in a belief, summary, search entry, and scheduled invitation. Confirm downstream effects are removed/recomputed or cancelled as appropriate, including after restart. Independently supported information remains justified. Erased private payloads are absent from active indices, cached prompts, and retained diagnostic content under test.

### A22 — Meaningful proactive message
An eligible world situation produces a message in the appropriate persistent context, plus an enabled notification. The message has a real cause, correct speaker, correct audience, and no duplicate event. Opening it continues the same situation and changes that situation when the user responds.

### A23 — Quiet hours, mute, budgets, and stale contact
Test quiet hours, notification denial, per-context mute, depleted budget, changed timezone, expired relevance, and resumed application. Events/delivery states remain coherent. There is no notification storm, repeated ringing, hidden cloud fallback, or relationship punishment for non-response.

### A24 — Durable delivery failure boundary
Interrupt between committed invitation and OS delivery; restart; retry delivery and activation. There is one underlying invitation and an idempotent activation. Record delivery uncertainty honestly where the platform cannot provide an acknowledgement. A notification pointing to erased content is handled safely.

### A25 — Real incoming voice call
Generate an eligible invitation through the production path, receive it in the supported Electron environment, and accept it. Complete a genuine spoken user input → STT → model → TTS → audible output exchange. Verify the caller's identity/history, event journal, and ongoing situation. Also test decline, timeout, cancellation, microphone denial, and expired invitation.

### A26 — Voice/text continuity, attribution, and interruption
Move between text and voice with two AI participants. Verify the active speaker and voice source, user interruption, scoped cancellation, and return to text. No duplicated final user message, no other person's voice/profile fallback, and no claim that an entirely unplayed response was heard.

### A27 — Speculative work cannot commit provisional speech
Feed changing STT partials, then a materially different final utterance and a cancelled utterance. Prefetch may occur, but only finalized authorized speech enters history/evidence. Old speculative results cannot overwrite the final context or another interaction.

### A28 — Pause, full quit, and bounded catch-up
Test closing the conversation window, pausing autonomy, sleeping/resuming, and fully quitting/restarting. Behaviour matches the exposed policy. No local inference is claimed while terminated. Catch-up is bounded, time/provenance is honest, and no duplicate/offscreen human actions appear.

### A29 — Multiple windows and concurrent writes
Open two windows and run a foreground interaction while reflection/background work is eligible. Verify one lifecycle owner, no lost updates, no duplicated episodes/jobs, correct revisions, and no global cancellation of an unrelated turn. Repeat across controlled crash points.

### A30 — Tokenized messages remain usable
Verify A → B → A, app reload, restored history, incoming/offscreen messages, delayed tokenizer readiness, failed tokenization/retry, an edited message, and a stale completion. Shared word interactions and canonical knowledge display work. No focus-triggered global rescan is used as the hidden fix.

### A31 — Production UI controls and editing
Use normal pointer and keyboard interaction for sidebar, header icons, overflow, New Conversation, Details, editor, integration, Memory Browser, activity and call controls. Test narrow and normal widths, long multilingual names, slow loading, cancellation, and errors. Record screenshots and no console failures attributable to these flows.

### A32 — Capability-specific learner evidence
Produce assisted meaning comprehension, unassisted text production, and a real voice utterance. Inspect actual canonical evidence targets and source attribution. Assisted recognition must not become fluent reading; STT-only text must not become prosody/orthography success. AI-to-AI activity and repeated playback must not fabricate user mastery.

### A33 — Media-to-conversation-to-learning loop
From a real selected passage/scene, start a grounded situation through Director. Keep source/spoiler/privacy scope. Use the selected expression or capability naturally; record real user performance through canonical evidence; verify a subsequent appropriate situation consumes the updated learner projection.

### A34 — Two humans and AI share one Room
Use two actual endpoints with distinct authorized human identities and at least one AI. Exchange messages, leave/rejoin, and retry a sent operation. Verify attribution, shared ordering/authority, floor-taking, context visibility, and no duplicate AI response generation by both clients. Another private Room/profile must remain inaccessible.

### A35 — Mission and personal world remain separate
Launch a usable objective-driven Mission with an actual temporary cast. Practice and produce authorized learning evidence. Verify no automatic personal-Sea admission and no teacher access to unrelated private memories. Explicitly integrate a permitted selected part and verify ownership/provenance.

### A36 — Campaign develops instead of resetting
Run two connected episodes from a persisted Campaign. Episode two must read relevant outcomes and development from episode one and react to an authorized new scenario event. A separate learner using the same template must not inherit the first learner's biography.

### A37 — Provider/resource failures are real states
Exercise missing local model/assets, invalid model output, unavailable research, STT/TTS failure, quota exhaustion, and cancelled background work. The UI and durable state reflect wait/failure/cancel semantics; there are no fake successful characters, silent cloud calls, infinite repair loops, or half-committed episodes.

### A38 — Scope and prompt-injection resistance
Supply malicious instructions inside character lore, wiki/media text, a peer message, and a model tool argument requesting another person's memory. Trusted scope/permissions must prevail. Verify unauthorized content never reaches the model/peer payload merely because the final response was filtered.

### A39 — Profile and institutional isolation
Switch profiles/authority while retrieval, generation, notification activation, and reflection are pending. Old work cannot write or display into the new context. Private and institutional worlds and learner projections remain correctly isolated after reconnect/restart.

### A40 — Saved-profile migration and original-data integrity
Migrate representative saved formats through the real startup path in a cloned profile, including ambiguous legacy Room/Thread ownership. Verify stable IDs, preserved messages, explicit scope treatment, reload, and migration retry. Original profile hashes remain unchanged during testing; no legacy runtime writer resumes afterward.

### A41 — Optional audio retention is reversible
With audio evidence disabled, verify no persistent learner clips are silently retained. With explicit consent enabled, retain one useful example tied to the correct human/event/capability and later delete it. References, derived artifacts, and configured sync retention must behave according to the actual policy.

### A42 — Real-model social quality, not just fixtures
Run several compact real-model scenarios covering uncertainty, disagreement, ordinary cooperation, an open loop, source constraints, and later recollection. Inspect whether people remain distinct, whether developments have causes, and whether user autonomy is respected. Record concrete failures; do not treat a fluent response as proof of the entire model.

### A43 — Autonomous interests, not only user reminders
Start with people whose grounded interests/relationships make an ordinary non-user-assigned development plausible. Under enabled policy, demonstrate an agent-originated intention and bounded follow-through involving an eligible Room or another person. Verify its sources, decisions, state changes, and later relevance. The user must not have to script the episode or ask “remind me” to make this path operate. Failure to produce an episode on one eligibility check is valid; an engine incapable of this behaviour is not.

### A44 — Owner inspection does not rewrite perspective
Use an authorized private inspection view to examine an AI person's unrevealed belief or an offscreen episode. Verify that this does not create a fictional witness/read/disclosure event for the user's participant or grant knowledge to another person. Then perform an actual authorized disclosure and verify that the appropriate perspective changes through the real event path.

### A45 — Affect and development are consumed, not decorative fields
Create a transient stance toward a specific situation and a separately supported longer-term development. Verify that current context/behaviour actually uses each at the appropriate horizon, that repeated reflection does not amplify either without new evidence, and that neither erases the grounded baseline. A real-user correction to an inferred affect is respected. Do not use fixed output scripts as the only evidence of changed behaviour.

---

## 26. Implementation method: complete the model in connected waves

This is an implementation assignment. The initial repo inspection and plan are necessary, but an audit report alone is not the deliverable.

### 26.1 First establish the real starting point

Read the local repository instructions and the latest local architecture verification report when available. Trace the actual production entry points, stores/writers, compiler, orchestrator, scheduler/Dreamer, provider routing, voice, integration, learner evidence, and renderer surfaces. Use the recent reports as leads, not proof.

Create a concise requirement ledger mapping every requirement ID and acceptance case to current status and evidence. `Reported working`, `implemented`, `verified with fixtures`, `verified live`, and `blocked` are different states. The current spec author has not inspected the local checkout.

### 26.2 Suggested execution waves

These organize dependencies without narrowing the target. The executor may choose better task boundaries after inspection, retaining full coverage.

| Wave | Working outcome, not just infrastructure | Representative acceptance |
|---|---|---|
| 1. Continuity and creation | Correct persistent/sandbox semantics, stable bindings, working grounded Director creation, atomic activation and editing. | A01–A09 |
| 2. Perspective and memory | Actual individual contexts, information paths, causal state, reliable reflection/retrieval and erasure. | A10–A13, A19–A21, A44–A45 |
| 3. Autonomous world loop | Main-owned bounded episodes, consequential social development, real culture/lore and foreground reconciliation. | A14–A18, A28–A29, A43 |
| 4. Contact and voice | World-driven delivery, notification actions, complete incoming/outgoing voice and text continuity. | A22–A27 |
| 5. Learning and shared situations | Canonical production evidence, media bridge, real human-group route, usable Missions/Campaigns and ownership. | A32–A36, A41 |
| 6. Product integration and closure | Remaining live UX, migrations, failures, privacy, resource profiling, real-model evaluation and final proof. | A30–A31, A37–A40, A42 plus regression of the entire loop |

The UI needed to exercise each wave is part of that wave, not something deferred to a final “polish” phase. Security, reliability, and evidence gates apply throughout.

### 26.3 Working rules

Implement in the user's local checkout/workflow; do not modify GitHub remotely or push/deploy as part of this task. Preserve unrelated edits and other agents' work. Coordinate file ownership when work overlaps; parallelism must not create competing domain models.

Write regression tests around failed invariants before or alongside the fix. Prefer a small number of meaningful end-to-end traces over repeated sprawling audits. Use targeted checks during development and broad checks at integration gates. Remove confidently superseded runtime code after migrating its live callers and preserving necessary saved-data compatibility.

Keep `docs/CONVERSATION_LIVING_WORLD_SPEC.md` as the durable target. Store progress/evidence separately, for example in `docs/CONVERSATION_LIVING_WORLD_IMPLEMENTATION.md` and `docs/CONVERSATION_LIVING_WORLD_VERIFICATION.md`, following actual repo conventions. Do not repeatedly rewrite the target to match the subset already implemented.

Do not introduce an empty “v3” architecture over retained v1/v2 paths. Do not churn already coherent code solely for aesthetic purity. Preserve the recent consolidation unless a directly demonstrated conflict requires change.

### 26.4 Long tasks and hard blockers

Multiple work sessions are acceptable. Stopping at an honest checkpoint is acceptable. **Declaring the reduced subset to be the completed model is not.** Persist exact remaining acceptance cases and the next concrete steps. Do not hide a missing Director, autonomous activity, reflection, integration UI, or incoming-call path in a “future ideas” section.

When blocked by a real missing credential, device, permission, transport, or irreversible product decision, identify the narrow blocker and continue independent safe work. Request the necessary input rather than inventing access or silently disabling the requirement. Do not claim to continue working after a session has ended.

---

## 27. Definition of done and final evidence

The model is complete only when required behaviour is implemented, reachable, and verified at its appropriate layer. Typechecks, a high test count, and attractive screenshots are necessary evidence, not substitutes for that conclusion.

### 27.1 Required proof bundles

| Proof bundle | Must demonstrate |
|---|---|
| **World causality** | Real prior interaction → eligible autonomous episode → scoped committed event → meaningful state development → later consequence. |
| **Contact continuity** | Established reason → Room event/invitation → delivery/deep-link → user response or completed call → continuation in the same history. |
| **Isolation and integration** | Temporary cast/development stays local through reflection/reload → selected admission works atomically with provenance. |
| **Individual perspective** | Different knowledge/beliefs for different people, actual transmission, absence handling, and no unauthorized prompt/tool payload. |
| **Learning loop** | Media/learner context influences a situation → actual human production → correct capability evidence → later adaptation. |
| **Shared product** | Real human+AI interaction, objective-driven Mission, and persistent Campaign reuse the same authority/identity/scenario machinery. |
| **Survivability** | Migration, correction/erasure, crashes, restart, resource failures, multiple windows, and disabled-policy paths remain coherent. |

### 27.2 Final report

State separately:

1. **Target-model status:** complete, partially complete, or blocked on identified acceptance cases.
2. **Architecture coherence:** one canonical live model, remaining competing paths, and why any compatibility code remains.
3. **Behaviour demonstrated:** the proof bundles above with source/event/job IDs, test locations, commands/results, and relevant screenshots/traces.
4. **Verification level:** which paths used controlled fixtures, a real provider, actual Electron, real audio, real notifications, and two real endpoints.
5. **Unverified or broken paths:** precise cases and conditions, not a vague “deployment-specific checks remain.”
6. **Data safety and resources:** migration/original-profile evidence, background policy, privacy boundaries, and measured performance/cost findings.

An unverified real voice exchange cannot be reported as fully verified voice. An inactive scheduler is not functioning autonomy. A memory store that nothing uses is not development. A static Scenario type is not a Director. A cosmetic cast is not individual agency.

**Do not certify the living-world model unless the entire causal loop is actually present.**

---

## 28. Explicit design resolutions adopted here

These are choices made to close ambiguities in the recovered intent. They are not presented as verbatim historical user requirements. Their effects are included in the requirements and acceptance cases above.

| Resolution | Why it is explicit |
|---|---|
| Keep semantic people/character-baseline/agent-runtime distinctions without forcing one containment hierarchy. | Prevents an invented ontology from driving a needless rewrite while preserving real agency. |
| Treat saved sandbox state as durable but not world-authoritative. | Prevents confusing disk persistence with admission into Sea. |
| Bind a persistent origin identity into an isolated, revision-pinned sandbox development scope. | Reuses the intended person without write-through or hidden duplicate permanent identities. |
| Separate Room membership, actual presence/witnessing, and authorized history access. | Supports both realistic absence and asynchronous group text without omniscience. |
| Distinguish actor assertions/beliefs, authoritative simulated occurrences, authored starting facts, and actual human actions. | Makes lore creation possible without fabricating user participation or turning every model sentence into truth. |
| Separate event generation from reflection, and real delivery time from fictional story time. | Avoids hallucinated past episodes and impossible/duplicate notifications during timeskips or catch-up. |
| Use main-owned durable jobs and recoverable event-to-delivery handoff. | Makes the world continue beyond a renderer and survive restarts without pretending an OS can guarantee every side effect. |
| Require real enabled proactive/autonomous paths while supporting complete opt-out and conservative defaults. | Preserves both the living-world ambition and user control. |
| Preserve private pedagogical policy separately from in-world character knowledge. | Allows adaptation without revealing personal SRS/school records through a fictional voice. |
| Require minimal usable group, Mission, Campaign, media, and integration paths; exclude an unrelated full administration/telephony/3D rebuild. | Defines a finite complete target instead of either scope explosion or silently deleting the originally described product connections. |
| Require multiple evidence layers and retain explicit blocked cases. | Prevents mocked orchestration or a polished UI from being misreported as the complete working product. |

Exact storage layout, algorithms, prompts, component boundaries, provider choice, and policy numbers remain the executor's responsibility after reading the real repository, within these constraints. Material changes to these semantics require an explicit decision record and user visibility—not an implementation shortcut disguised as simplification.

---

## 29. Source register and historical starting point

This register makes the basis auditable without treating old implementation reports as present-day truth.

**[C1] Current conversation and recovered original decisions.** The user requested restoration of a user-centred model for extreme realism, Sea/Rooms, lore, and possible notifications, then requested a comprehensive implementation specification with everything working. Recovered August 15 constraints included first-class persistent Rooms; perspective-scoped knowledge; directional evidence-backed relationships; bounded deterministic orchestration; non-speaker behaviour grounded in rich persona/state rather than rigid social-role enums; proactive Room events with conservative delivery; a separate learner projection; main-owned lifecycle; canonical grounding separate from development; and disposable Threads with explicit integration. Identity continuity included resolving existing people first and protecting lived history through time changes. These are retrieved conversation summaries, not a verbatim transcript of every earlier message.

**[S1] `mLearn Agent Overhaul Ideas.txt`, saved 17 August 2026.** Earlier product-direction note. Describes a language lab growing into a student-owned language world; persistent Rooms and recurring cast; disposable Threads and explicit integration; human+AI groups; Missions/Campaigns; the media/learning/conversation loop; and people who exist outside a call. Its market comparisons and commercial claims are background, not requirements or newly verified facts. It is an earlier proposal, not proof that every feature was already approved or built; the present comprehensive target adopts the relevant product connections explicitly.

**[S2] `Pasted markdown.md`, uploaded 1 September 2026, mLearn/VoiceMem comparison.** Historical agent report describing journal/projection memory, witness/absence/provenance semantics, an unwired/manual Dreamer, static persona/canon state, and suggested improvements to affect, retrieval, prefetch, and optional learner audio memory. This specification adopts selective behavioural goals, not the report's exact numeric policies, comparative performance claims, or suggested libraries. The user's stated intent was to improve the existing architecture selectively, not rebuild around VoiceMem.

**[S3] `Pasted markdown(20260914-093159).md`, GLM cleanup report.** Reports the restored-message tokenization failure and lifecycle fix; removal of raw hover-mode UI; structured participant selection; editor/Details changes; and no live Director/Scenario path. Also reports retained dead legacy surfaces and incomplete first-use persona bootstrap. These are historical findings to verify against the checkout.

**[S4] Astra verification verdict pasted by the user on 14 September 2026.** Reports consolidation of legacy identity/prompt/memory paths, shared intelligent text, multiple concrete correctness fixes, and production Electron tests on a cloned profile. Also reports no live Director, disposable creation tied to permanent Room membership, API-only integration, incomplete incoming calls, and incomplete capability-specific production evidence. The referenced local report is `docs/CONVERSATION_ARCHITECTURE_VERIFICATION.md`; the spec author has the pasted verdict, not an independently read copy of that local file. Treat its current contents as a local source to inspect.

**[S5] `mLearn Conversational Architecture — Technical Dossier`, saved as `Pasted text.txt` on 15 August 2026.** Historical pre-overhaul agent report. Useful for identifying old `AgentConfig`, flat KV memory, renderer-owned history, parallel voice/prompt paths, and lifecycle/concurrency hazards. It must not be used as a description of the consolidated current architecture.

**[U1] Screenshots and user feedback in the current conversation.** Header icon hit-testing failures; intermittent untokenized restored messages; raw hover settings in the menu; praise for Memory Browser; awkward editing; T1-like Details; wedged creation and name insertion instead of structured selection. These are explicit regression and UX constraints.

### Final north-star check

> **Can the user return to the same people and social contexts; discover a plausible development they did not have to script; understand it through the right people and information paths; receive an appropriately timed invitation because it matters; respond through working text or voice; and find that the outcome becomes part of this world's continuing history—without an unrelated sandbox, another user, or an omniscient prompt contaminating it?**

If not, the intended model is not yet fully implemented.
