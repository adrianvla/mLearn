# mLearn product specification

Status: target contract for v3, established from maintainer decisions on 2026-10-13. This describes required product behavior, not a claim that it is implemented.

Implementation baseline inspected: `d726ea9f81bfc4a77e762487dec345eb56177eb4`. It provides a shared UI, native settings and a sample plugin; it does not provide the learning product described below. Historical reference: `archive/v2-final` at `1788f9c74dc73dd884b687ec80d9550c3ebf6c6b`, plus selected earlier revisions. See [reference selection and screenshot requests](REFERENCE.md).

This document and the [required feature catalogue](FEATURES.md) jointly define the product. The catalogue makes small modes, actions and integration behavior explicit rather than leaving them implicit under surface names. This document governs product semantics and exclusions. [AGENTS.md](../../AGENTS.md) governs engineering execution. Older specifications and implementation reports are historical where they conflict. Requirement identifiers below are stable anchors for implementation and verification; they are not prescribed modules or a task ordering.

## Product vocabulary and coverage

**Knowledge** is the unified native learner-state service and its bounded view projections; it is not the flashcard collection. **Material** is authored/saved content. **Inspector** is contextual linguistic inspection, with desktop popup and mobile drawer/sheet presentations. **Runtime Inspector** is developer access to actual execution and agent decisions. Legacy `FlashcardContext` and `WordHover` names locate reference behavior but do not define the new owners.

The feature catalogue is a coverage contract, not a request for one implementation or test per row. Each wanted behavior has a delivery unit and observable acceptance condition. Newly discovered meaningful legacy behavior is mapped before its area closes; retirement or replacement requires a decision. A broadly working player, reader or conversation cannot silently omit its smaller controls and workflows. A required row with unresolved details remains open, not downgraded to optional.

[The implementation plan](../implementation/PLAN.md) delivers one connected unit at a time. Candidate verification precedes maintainer review; explicit acceptance precedes the next unit. Internal engineering decisions do not require a separate review per function. Mobile functional/platform status and final mobile visual design status are recorded separately. A usable initial mobile arrangement may be revised later without forking the feature implementation.

## P01. Product purpose and success criteria

mLearn lets a learner use authentic material, inspect unfamiliar language, retain useful material, practise retrieval or production, and converse in the target language. These activities share one learner model and preserve the context that made the language useful. They must not become separate tools that require the user to copy information or reconcile inconsistent knowledge states.

Optimize for useful retained ability and decision-relevant information relative to learner effort and interruption, subject to the learner's real goals and constraints. Activity counts, streaks, generated content volume, model calls and the fraction of a list labelled Known are not substitutes for that outcome.

The user can enter directly through reading, watching, conversation, targeted practice or due review. No mandatory tutor conversation, questionnaire, account, statistical tuning or world-building setup precedes ordinary local use. Power users retain precise filters, keyboard operation, bulk actions, inspectability and control over material without manually maintaining every probe.

The product must support these end-to-end uses:

| Situation | Required outcome |
|---|---|
| Read an EPUB or inspect an OCR page | Understand an item, inspect relevant structure, optionally capture it, then continue at the same location |
| Watch with subtitles | Look up or capture language with source time/context without losing playback state |
| Review due material | Retrieve, reveal, rate, advance, correct a mistake and resume later without duplicate observations or a growing renderer heap |
| Prepare a defined curriculum/exam scope | Inspect what is supported, practise relevant gaps and resume exact work; unavailable requirements remain explicit |
| Converse by text or voice | Sustain a coherent interaction, use language from other activities, receive appropriate feedback and preserve actual conversational continuity |
| Move between devices | Continue supported activities from durable state without making a phone a reduced flashcard-only product |
| Develop a language package | Add behavior and data without changing core linguistic code or rebuilding desktop for each package |

Success includes reliable resumption, bounded resource use, coherent knowledge displays, clear failures and preserving user-owned data. Visual density and fluid interaction matter; ornamental onboarding and dashboard copy do not.

## P02. One product across platforms

Desktop uses the universal React Native Web frontend hosted by Tauri. iOS and Android use the same React/Expo application with native rendering. Native Rust owns the application logic on every platform. Neither a browser preview nor Expo Go is the acceptance environment for native functionality.

Feature parity is an outcome requirement, not a requirement for identical widgets, OS APIs or window arrangements. Desktop supports keyboard/mouse and dense layouts; mobile supports safe areas, touch, native navigation, interruption and platform accessibility. Tablet/narrow desktop layouts adapt to available space and input, not a second set of screens.

Platform differences belong in narrow adapters. A popover becoming a sheet, a system file picker, native OCR provider or a different audio-session integration is acceptable. Parallel learning, settings or messenger implementations are not.

Core local workflows remain usable offline after required assets are installed. Network media, hosted generation and remote collaboration expose their genuine network requirements. Large on-device LLMs may be unavailable on particular devices; that does not remove dictionaries, OCR, learning, media or saved conversation access. Optional remote or local-network providers must not silently take over private processing.

Some desktop facilities cannot be reproduced literally on phones, such as unrestricted system-wide overlays or arbitrary local desktop integrations. Preserve the supported user objective through an explicit import/share/capture or paired-device route where feasible. Record the exact platform limitation; do not hide it behind a nominally present button or quietly reduce the parity target.

Executable distribution is fixed: desktop downloads language code and data from authenticated catalogs; both mobile platforms ship executable plugins in the application and download compatible language data separately. Installed working packages do not become unusable merely because the catalog is unreachable. New mobile executable functionality needs an application update under this distribution design.

## P03. Language structure and open extension semantics

Language packages own their algorithms, language-specific dependencies, lexicons, graph content, analyses, feature schemas, curriculum/outcome definitions, task declarations and validators. Core must not acquire Japanese/Turkish/German branches or a closed list of grammatical or prosodic categories.

The core can standardize generic execution and interoperability contracts without standardizing every possible linguistic concept. Plugins may implement complete tokenizers and analyzers, not just select preinstalled language-specific kernels. The current execution path is the Rust SDK and Wasmi. JIT, native plugin AOT and additional interpreted languages are deferred, not requirements for initial delivery.

A package may introduce structured features on senses, forms, morphemes, tokens, spans, constructions or its own entity kinds. Preserve valid unfamiliar namespaced values and references through load/store/export. A missing capability is unsupported, not silently emulated, discarded or treated as an empty result.

Keep orthographic tokenization, morphological decomposition, normalization, lemma resolution, pronunciation and contextual disambiguation distinct where their semantics differ. Analyses can be ambiguous, nested or context-dependent. Retain original source spans separately from normalized forms, including a defined coordinate convention at boundaries. Unicode, IME, combining marks, mixed scripts, bidirectional and vertical text must not be reduced to ASCII indexing assumptions.

The linguistic graph describes a language; it is not the learner's history or the conversational world. Stable semantic identities survive package rebuilds. Dictionary source grouping, identical pronunciation, shared components and similar spellings do not automatically merge learner identities. Distinguish explicit identity, target-bearing relationships and predictive support. A relationship may suggest transfer without demonstrating possession of another capability. Parallel relationships, qualifiers and provenance must not be lost through a storage optimization.

Use an indexed graph representation with bounded native queries initially. No dedicated graph database or custom canonical binary format is required merely because data is a graph. Optional derived indexes remain rebuildable and must preserve semantics.

Package activation validates integrity, declared capabilities, code/data compatibility and resource requirements before use. Updates must not silently rewrite an already admitted task's meaning or renumber its targets. Keep usable installed versions or an explicit unavailable state when a dependency changes. Trusted publishers, school/private catalogs and downloadable content licensing are first-class package concerns. Interpreter limits still apply to trusted code because mistakes can exhaust resources.

The initial hello plugin and its small fixture limits are not the production language SDK contract. Representative analyzers and large resource access must establish that contract before it is presented to external contributors as stable.

## P04. One learner model, several kinds of information

Keep these concepts distinct in storage, selection, displays and diagnostics:

| Concept | What it establishes |
|---|---|
| Exposure/encounter | Material was present or deliberately consulted under recorded conditions |
| Explicit claim | The user's statement or correction about a capability |
| Self-reported retrieval | A response about the learner's own performance on a declared attempt |
| Validated performance | A response evaluated by an identified, actually executed validation method |
| Prediction | A model's uncertain estimate, with its assumptions and inputs |
| Exclusion | A selection preference; not evidence of either knowledge or ignorance |

Unmeasured/Untracked is different from measured weak/Unknown. Missing observations are not failures. Selecting a curriculum does not mark its contents learned. Merely moving a pointer over text is not a deliberate lookup or assessment. Passive familiarity must never silently become demonstrated knowledge.

Maintain capability-specific state. Written recognition, reading, meaning, listening, orthographic recall, pronunciation/prosody and production illustrate distinct accesses; this is not a closed universal enum. A learner may know one direction but not its reverse. Packages determine which accesses and relations are meaningful.

An explicit claim can control the effective status shown to the user while underlying observations and evidence-derived estimates remain separately inspectable. It does not rewrite the historical evidence. All ordinary surfaces consume the same native projection; Inspector, Reader, Review, Browse and Progress cannot invent conflicting thresholds or status rules.

The model must not require a manually authored flashcard for every known or encountered item. Authored material, target identities, observations, current model state and scheduling are related but separate entities. Predictions can change what mLearn offers next without being written back as successful observations.

A new HMM or other learner predictor must define its measurement assumptions separately from the effects of teaching/practice. An observation can reduce uncertainty without itself establishing an instructional benefit. Parameter/state versions, assistance conditions and uncertainty remain available for model comparison. Reuse numerical and scheduling machinery where it fits; neither a library choice nor a more elaborate model proves pedagogical validity.

## P05. Environments, probes and intervention selection

An environment is the current context and resources for learning: Reader, Watch, review, a conversation/Room/Thread, available audio/input, source material, current task and practical interruption constraints. It supplies opportunities and conditions; it is not another knowledge store.

A probe is a measurement/task contract, not a flashcard template. It declares its targets, cue, required response, supplied information, evidence interpretation, required resources and relevant limitations. Teaching, maintenance, calibration and assessment can reuse the same interaction components while producing different evidence.

Generate useful candidate probes automatically from installed package capabilities, available material and learner state. Do not make users design Anki-style templates to obtain basic listening or reading coverage. Expert custom probes remain possible through supported authoring/extension contracts; they cannot bypass evidence conditions.

Prefer a holistic encounter that covers compatible targets with granular outcomes. Do not create one repetitive interaction per internal graph edge. Written-form to reading/meaning/prosody and audio to lexical/orthographic recognition must remain distinct when one cue reveals the other's answer. Combine only compatible demands; defer incompatible probes or classify the subsequent activity as assisted practice.

The policy can probe, teach, maintain, continue current immersion or defer. It considers expected useful capability change and information that could change a future decision, alongside effort, interruption, resource cost, uncertainty, goal relevance and dependencies. It must not be a disguised count of weak words, fixed daily quota or hand-weighted urgency score presented as calibrated ROI.

Compare actions against realistic alternatives under the same conditions. Respect sequence completion times and resource exclusivity; do not count two mutually exclusive activities as simultaneously achievable. A diagnostic observation and the same activity's learning effect cannot be double-counted. Unknown transfer or efficacy remains an assumption, not a fabricated measurement.

Infer opportunities cautiously from observed active use rather than require a daily-minutes or intensity questionnaire. Idle, background, blocked or interrupted time is not automatically learning effort. Observed usage is not knowledge of the user's calendar. An explicit activity request and an admitted task take precedence over opportunistic replanning. Forecasting must not block ordinary reading or resumption, end an ordinary session at an arbitrary inferred limit, or continually interrupt conversation.

Policy diagnostics expose the actual candidate, constraints, model version, assumptions, selected action and meaningful alternatives. These belong in inspection, not a paragraph of scientific commentary between each card.

## P06. Goals, scopes and assessments

Goals are supported outcome requirements and constraints: a package-defined curriculum or category, a declared communicative capability, a deadline and any specified success/reliability conditions. A free-text title such as 'get better' does not become a validated target identity. Free-form context may inform conversation without masquerading as an evaluable requirement.

Resolve scope by stable package/group identities and preserve provenance: community material, authored curriculum and authoritative assessment mappings are different. Overlapping lists must not double-count targets. A missing subgroup, withdrawn provider or incomplete outcome definition remains unresolved; do not substitute all vocabulary, another level or a convenient generic list.

Evaluate requirements under their actual conditions and deadline. Where supported, report met, unmet, uncertain or unsupported with evidence and model limitations. Preserve conjunctions and section requirements; an average cannot hide an unmet prerequisite. Raw practice accuracy is not an official scaled exam score. A deadline changes action selection, not what the evidence establishes.

Home offers useful continuation and relevant work with a clear destination. Plan organizes selected scope and progress; it does not contain a competing learning runtime. Users can inspect the entire scope and deliberately practise part of it. Avoid mandatory goal-name/status forms, generic readiness percentages and model-tuning controls in ordinary use.

Calibration estimates unknown state; practice aims to improve it; assessment estimates performance under stated conditions. Preserve those purposes even when their presentation looks similar. A timed mock needs an actual blueprint, questions, scoring and feedback policy. Schemas, generated examples or a recall task are not a delivered validated assessment.

## P07. Encounters, Review, practice and correction

Review is scheduler-led retention maintenance. Browse filters do not silently redefine its due queue. Deliberate Word Practice/cramming uses the selected material, such as Unknown within a package-defined level, and does not impersonate scheduled Review. Word Sync/calibration and grammar work share encounter and rating semantics rather than becoming separate applications.

An admitted encounter fixes its target, task, relevant content/package version, cue and assistance conditions. A background projection refresh, language-data enrichment, cursor acknowledgement or theme change must not replace the displayed question or suddenly reveal additional information. Genuine source edits/conflicts need explicit handling; do not continue against a different item without informing the user.

The normal retrieval interaction is cue, retrieval attempt, reveal, response and advance. Reveal permits retrospective self-report of the attempt just made; it does not automatically invalidate that report. Consulting a definition, receiving a supplied answer, repeated exposure or failed/missing audio changes the evidence interpretation. Playback completion is not proof of human comprehension. A validator declaration is not proof that validation ran.

Retain the recognizable rating interaction: visible capability/knowledge pills, efficient bulk ratings, per-capability exceptions through Adjust, and the existing `1/2/3/4` and supported `11/22/33/44` keyboard semantics. Do not hide ratings behind extra menus or flatten them to one undifferentiated grade. Preserve scope for unresolved/untested targets; a bulk command applies only to eligible targets.

Keyboard shortcuts operate only in the active learning context. IME composition, held keys, editable fields, selected text and modal focus must not trigger a rating. Space/reveal and Undo must not activate from unrelated settings or conversation input. Touch access must expose the same essential actions.

One physical attempt may yield multiple capability observations but must be admitted, retried and corrected coherently. A retry retains its logical identity and cannot double-count reviews, scheduler updates, history or sync intent. Pending durable work is not presented as committed success. Keep the interface responsive without introducing a second frontend scheduler or unbounded optimistic queue.

Undo normally concerns the current/resumable session. Correcting a prior response retains its original retrieval conditions and replaces/retracts that report coherently; it is not a second fresh cold-recall attempt. Once an answer has been exposed, restarting or switching presentation must not manufacture an unassisted attempt. Unsupported historical corrections remain explicit rather than reconstructing missing details.

Resume restores the exact admitted task and relevant exposure state. Navigation/Return preserves the source book/page, video/time/subtitles, conversation and chosen scope. Starting another task must not erase unfinished work silently. Continuous review/practice must not inherit arbitrary short-batch limits; explicitly finite user requests may have stable bounded membership. Background queue updates do not make the displayed denominator or task identity jump unpredictably.

## P08. Reading, watching, OCR and inspection

Support the existing material families: text/EPUB, PDF, images/manga and image folders, local video, supported online media and subtitle inputs. Preserve useful subtitle behavior, including timing, supported SRT/ASS content and supplied tracks. Format fidelity and an unsupported feature must be explicit; a parser's presence is not equivalent to a usable reader.

OCR is an on-device requirement on mobile as well as desktop. Text already available from a document must not be needlessly rasterized and recognized again. OCR-derived text retains source-region alignment so selection, lookup and correction refer to the actual material. Native capture/helper APIs can differ by platform without duplicating the reader or learner model.

Annotated text is a shared semantic pipeline for subtitles, documents, OCR output and conversation messages. Native work analyzes a relevant bounded range, resolves stable source spans/targets and reads Knowledge for distinct targets in batches. The UI presents those results rather than assembling a separate knowledge query per word. Cache keys include the relevant source/content and package/analysis context; obsolete results cannot apply to a new source. Knowledge revisions update affected view data without automatically retokenizing the source. Source raw text can render while analysis is pending; it must not fabricate knowledge or hide processing errors.

Keep source content dominant. Selection/hover/tap opens fast contextual inspection; returning preserves location and playback. Recognition, annotation and dictionary preparation occur as bounded native work, not a full parse or model initialization triggered by every hover. Missing optional assets degrade locally with an actionable state, not an app-wide permanent skeleton.

Contextual Inspector and its deeper detail views are central learning surfaces. Keep the source form, nearby meaning, reading/pronunciation where applicable, senses, available linguistic structure, knowledge/capability state and relevant actions coherently grouped. Ordering and punctuation must be appropriate to package data and locale, not Japanese-specific separators imposed globally. Use narrow/scrolling content sensibly; keep actions and essential information reachable.

Moving between descendants of one inspected item must not repeatedly remount its popup or reset its content. Nested menus, knowledge details and Inspect have deliberate focus/layer ownership. On mobile the same semantic inspector may use a drawer/sheet. Do not force desktop geometry onto a phone or reimplement the feature separately.

Capturing useful material retains its source sentence/span, file or source identity, time/page and selected media/audio where available. Do not silently store full duplicate media files or base64 image copies per observation. New records can be edited and inspected without requiring an external service.

Supported desktop overlays, browser extension, picture-in-picture and external-definition flows remain in the compatibility inventory. Watch Together retains synchronized media continuity where supported. Platform restrictions require explicit alternatives or recorded gaps, not claims of universal access to arbitrary sites/apps.

## P09. Authored material, knowledge and integrations

Retain meaningful Browse/search/filter, inspect, edit, import/export, generated/suggested material review and bulk operations. Large collections must remain navigable without loading the entire library into React. Search, selection and counts distinguish authored flashcards, language entities and observed learner capabilities.

Character/writing-system study and grammar inspection are capability-driven. Not every language has kanji, a fixed inflection table or a universal POS structure. Grammar recall, contrast exercises, typed answers and production tasks declare what they actually test and how they are validated. Missing authored material remains unavailable rather than replaced with unvalidated generated content labelled as equivalent.

Anki remains optional. Preserve explicit live AnkiConnect integration where the host supports it, and useful imported/cached access when the peer is unavailable. A missing peer is not permission to erase local state. Do not interpret a phone's loopback address as a desktop connection or make Anki a dependency of core learning. Mapping conflicts, import provenance and synchronization ownership must be explicit.

Saved conversations and content remain accessible without a working LLM, OCR model, network or optional integration. Export/import is versioned and retains meaningful identities and provenance. Import does not silently activate retired settings or claim missing evidence was observed.

## P10. Conversation, Sea, Rooms and Threads

Conversation is a primary way to use the language, not an optional generic chatbot panel. Preserve the useful behavior of the later conversation implementation while selecting its visual references independently from other v2 surfaces.

The interface behaves as a messenger: contacts/participants, a clear current conversation, usable history and search, a composer, reply/context actions, text/voice states and appropriate unread/continuation behavior. Creating a contact or starting an agent conversation is directly accessible. Do not replace this with a dashboard, a grid of prompt suggestions or graph-management controls.

Tokenize/annotate messages through the normal bounded render-data pipeline before inspection needs them; hover should open an already understood message region, not be the sole trigger for recognizing language. Preserve scroll position when history prepends, stream responses without losing the composer, and avoid forced autoscroll while the user reads older messages. Inspector supports the conversation rather than taking it over.

Sea is durable world continuity. A Room is a persistent conversational context; a Thread is temporary practice with disposable world continuity unless explicitly integrated. Persistent social/roleplay context is optional: ordinary practice must not force the learner to maintain a fictional world. Preserve the distinction between a room, its members, the events recorded there and an individual's memory.

Retention scope and knowledge visibility are separate. Being in the Sea does not make an event known to every character. A participant's accessible history is grounded in witnesses, actual presence, disclosure and authorized sources. Joining later is not automatic knowledge of all earlier events. Derived beliefs and relationships retain source/dependency links and uncertainty; a model output cannot promote an imagined event into something the human said or did.

Integrating a Thread into persistent continuity is deliberate, scoped and attributable. A temporary session must not leak into unrelated Rooms or private contexts. Discarding a Thread removes its disposable world state and dependent memories; it does not silently delete independently admitted learner evidence or retained user-authored material. Those retention choices must be explicit.

Corrections, message deletion, participant changes and integration must update affected projections without leaving invisible active memories that contradict the user's action. Do not require a perpetual full snapshot for each message to achieve this. Existing conversations and their visible content remain authoritative records; generated interpretations are distinct.

## P11. Agent behavior, voice and observability

Agent generation, checking, memory, scenario direction, reflection/Dreamer work, autonomous fictional activity and contact/proactive delivery share the native application lifecycle. They must not each introduce a separate settings store, task queue, transcript copy or learner model.

A scenario's participants, purpose, constraints and current situation are explicit enough to remain coherent. Feedback should be usable in context without derailing every utterance. The learner can ask for explanations and practice directly, without becoming an operator of the harness.

Background reflection and proactivity have bounded budgets, cancellation, idempotent publication and user controls. They cannot fabricate user participation, publish partial work as canonical, ignore quiet/availability constraints or duplicate invitations after restart. Fictional autonomy is not authority to send real messages, spend money or perform external actions. Tool access, credentials and untrusted document/model content remain separated by host authorization.

Voice requires microphone permission and capture, VAD/turn handling, recognition, synthesis/playback, interruption and recovery. The visible transcript distinguishes generated text from speech actually delivered. An interrupted reply must not count as fully spoken or fully witnessed. Successful local playback does not establish that the learner listened or understood. Shared inference resources must not create one unconstrained model/pool per participant.

Developer inspection exposes the actual prompt/context, model response, tool calls/results, memory sources, Sea/Thread visibility, scheduled/background runs, decisions, errors and timings. It must be accessible directly in developer mode, not as decorative summaries claiming to explain hidden behavior. Normal messenger UI does not display a permanent memory graph or operation log. Redact credentials and control export of private content.

Do not fork this into a separate agent product. Media encounters can inform relevant practice and conversation; conversational performance can contribute appropriately qualified learner observations. Generated words, agent statements and simulated events are never automatically the learner's demonstrated skills.

## P12. Progress and ordinary navigation

Show progress tied to capability, material and evidence conditions. The learner can inspect why an item has a status and distinguish claimed, assessed, inferred and untracked knowledge. Aggregate statistics respect target identity and physical-attempt counting; chart smoothing/aggregation must not imply greater measurement precision.

Home emphasizes current activity, useful recent material and exact resumption. It can offer a relevant next action without a dashboard of arbitrary metrics. Deliberate Read, Watch, Conversation, Review, practice, material management and settings remain reachable regardless of a recommendation or optional model's readiness.

Use a shared route/intention model with explicit source return. Preserve multiple unfinished tasks where the product permits them; do not restart a session merely because a route remounted. Separate windows only for an approved desktop capability or workflow, not to copy the late-v2 activity-window architecture. The default is one application UI; mobile must not inherit a window-manager metaphor.

Settings, recovery and diagnostics remain accessible when a library, plugin or optional provider fails. Do not turn every startup dependency into a global gate that blocks data export or repair.

## P13. Settings and visual system

Each active setting has a user purpose, one durable owner, a default, a consumer and defined application timing. Search and labels lead to the actual setting. A control that persists but affects nothing is not implemented. Changes that affect an admitted task take effect at a safe boundary rather than mutate its conditions.

Retire Tactile/Flat modes, duplicate threshold aliases, old engine selectors, dead toggles and migration-only options from normal v3 behavior. Preserve raw legacy configuration only where import/recovery obligations require it. Map an old value to a new concept only through an explicit supported migration; do not keep the former branch of behavior 'just in case'.

Themes permit user-defined palettes and supported typography, spacing, surfaces and component values at runtime. Built-in themes are examples, not an exhaustive identity enum. Appearance, content aids and accessibility preferences are distinct from learner assessment. Unrestricted browser CSS is not promised as a portable native theme language.

Retain mLearn's selected visual language without reproducing the old CSS structure or every pixel. Typography hierarchy, compact controls, knowledge pills, contextual inspection, restrained translucency and productive use of space matter. Widths, alignment and decorative details can be tuned by the maintainer. A generic marketing layout, oversized cards and repetitive 'your learning/your world' prose are not substitutes.

Essential accessibility includes names/roles/states, focus and dismissal, keyboard and IME behavior, legible contrast, reduced-motion/transparency handling and usable large text. Visual polish cannot waive these functional constraints; conversely, cosmetic differences must not expand into repeated whole-app redesigns.

Display the application as mLearn. Development identity, profile directory and application-bundle installation must remain distinguishable from the live v2/production installation. Renaming a title must not migrate data.

## P14. Storage, evidence retention and recovery

Rust owns transactional canonical state. Preserve one-action consistency among admitted observations, current model/scheduler changes, receipts and applicable sync/correction references. Do not reintroduce whole-library JSON rewrites, duplicated global state, renderer reconciliation loops or a separate mutable database for every subsystem.

Treat data by its lifecycle:

| Class | Required treatment |
|---|---|
| Current learner state, active tasks, authored material | Durable, versioned, recoverable |
| Session undo/correction | Exact for the supported session/recovery window, then releasable |
| Recent observations | Compact with the context required to interpret the actual attempt |
| Older learner observations | Coarsen to daily and eventually weekly/coarser summaries under a versioned retention policy |
| Model checkpoints | Persist the model version and processed-history boundary; may become indispensable after compaction |
| Conversation messages/world records | Separate content/visibility/deletion policy; learner-history compaction does not erase conversations |
| Sync identities, acknowledgements and tombstones | Retain as required by the sync protocol, not the Undo window |
| Downloaded packages/models | Versioned, integrity-checked resources; avoid needless duplication |
| Regenerable media/derived indexes/logs | Bounded cache/diagnostic policy, not irreplaceable evidence |

An old summary is not one synthetic review. Aggregate compatible target/capability/task conditions; do not combine written and audio recognition indiscriminately. Preserve counts/distributions, relevant sums and time bounds; compute weighted averages from adequate statistics. Empty time intervals create no records. Coarsening must actually save space rather than expand isolated observations.

This is deliberately lossy retention, not lifetime exact replay. After individual old observations are removed, a new model cannot claim to have refitted their exact sequence. Checkpoints name the model/parameter/schema version and cutoff. Model updates define an honest migration or approximate/recent-data initialization. A checkpoint is not safely deletable as a cache when its input history is gone.

Daily/weekly aggregation alone is not a strict storage bound. Define historical payload and cache budgets and progressively coarsen eligible old summaries as necessary; authored content and sync obligations have separate limits. Exact periods/budgets require representative measurements, not arbitrary historical constants. Expose storage categories and cleanup consequences so large dictionaries/media are not misdiagnosed as review history.

Compression and encoding are implementation choices behind versioned formats. Do not store undocumented packed integers in miscellaneous JSON or copy every task/prompt/media payload into every per-capability observation. Preserve meaningful identities and extensions. A small structured JSON payload in SQLite or a manifest is not a violation of this requirement.

Compaction, import and migrations are restart-safe and transactional at their activation boundary. Deletions and retries cannot inflate independent accounting or resurrect observations. Consistent, bounded recovery snapshots must not repeatedly duplicate regenerable multi-gigabyte assets. Detect meaningful loss independently of the same counter/write path that could be wrong; do not disable integrity checks to make a broken profile open.

Import reads an isolated v2 source, preserves the source and reports unsupported mappings. It must not open the production v2 directory for writes, reuse its storage format as the canonical v3 model, fabricate missing history, or activate retired flags. Preserve the meaning of available data; subsequent approved compaction is a separate operation.

## P15. Performance and lifecycle

The core application, SQLite and plugin host compile natively on mobile. Wasmi interprets guest plugins; it is not an excuse to move learner logic or dictionaries into the renderer. Neural models use the native ONNX inference boundary and compatible on-device assets, with no shipped Python runtime. Non-neural learning, graph and text algorithms are not forced into ONNX; optional native platform providers preserve the same capability/privacy contracts. A model download is usable only if its operators, preprocessing, decoding and resource requirements are supported.

Readers, ratings, conversations and large libraries must stay responsive over sustained use. React receives bounded projections and owns transient interaction state, not complete histories or repeated copies of graph/model data. Background model fitting, asset decoding, OCR and inference cannot block UI/event loops or ordinary due-item advance.

Each loaded package/model, plugin instance, cache, query and subscription has a lifetime and resource budget. Batching and scoped invalidation precede exotic execution engines. Do not load every installed language's full assets at startup, refit all retained history per rating, scan language metadata per word, or refresh inactive collections on every change. Warm reuse must remain correctly invalidated and cancellable.

A real long-session regression workload must exceed the earlier approximately 30-minute rating failure regime and include realistic retained state. Measure memory growth after warm-up, not just one peak. Also inspect native allocations, database/WAL growth, caches, idle/background behavior and shutdown/restart. Tests on small fresh profiles do not establish the same result.

Before declaring performance improvements, use the same representative inputs, build mode and hardware, record cold/warm conditions, and separate UI latency from backend completion. Do not claim universal timings from one device. The minimum supported device and model budgets remain release decisions grounded in these measurements.

## P16. Local, hosted and school operation

Local learning is not contingent on a hosted account or LLM subscription. Preserve self-hosted/local-network provider options and a configurable service/catalog boundary without separate regional application codebases. Cached validated configuration permits offline continuity; endpoint changes cannot bypass package/update authentication or disclosure of where private data is sent.

Hosted-service eligibility, school policy and authorization remain explicit. Do not apply a hosted relay restriction indiscriminately to offline/local use, or bypass it because another provider exists. Managed access must show relevant institution/teacher visibility. Authorization is enforced outside the renderer.

School-directed material, assignments, speaking/scenario objectives and authorized review fit the same learner product. A teacher's curriculum does not become the student's entire private identity or grant access to unrelated personal conversations. Existing management/service interfaces are integration boundaries; replacing the client does not authorize rebuilding or deleting the control plane.

Later teacher-directed missions/campaigns, mixed human/agent group Rooms and deliberate integration into a personal world extend these same flows. They are not claimed as working merely because their types or earlier proposals exist. Preserve these extension constraints; implement them only as complete scoped workflows. Automated evidence is not automatically a formal grade or certificate.

## P17. Compatibility selection and exclusions

The compatibility target is the selected product behavior, not the latest v2 screenshot or bug-for-bug output. Classify each substantial surface and hidden workflow as keep, change, retire or unresolved, with a pinned source and reason. The [reference map](REFERENCE.md) starts this selection; expand it only for findings that affect decisions.

For retained behavior, use representative source examples and data as a differential reference after confirming their intended semantics. For an approved change, assert the new contract and document the intentional difference. Do not automatically copy either old tests or old answers. Preserve licenses and notices for reused assets/code.

Explicitly excluded from normal v3 behavior: whole-profile renderer state; ad hoc mutable JSON databases; old engine/threshold compatibility aliases; Tactile/Flat branches; compulsory free-form goal/budget setup; one review per internal capability by default; fake readiness or validated-assessment claims; automatic global knowledge from graph support; duplicate desktop/mobile features; unnecessary activity windows; decorative integration dashboards; another interpreter or JIT/AOT backend in this phase.

Open visual choices do not block domain implementation. Open semantic choices, unavailable content or platform limitations remain visible and must not be settled by silently narrowing the specification. A feature absent from a chosen screenshot is not automatically retired.

## P18. Acceptance and change control

For each integrated workflow, record the requirement anchors, selected reference, observed result and missing evidence in one compact implementation record. Distinguish implemented, verified on a named target, blocked and deferred. Do not maintain a duplicate test/plan bureaucracy for every function or declare completion from file counts.

Acceptance exercises a complete action and its return/resume, error and persistence behavior where relevant. Use focused semantic/regression tests at the owning layer, a small number of real boundary tests and representative user flows. Native builds and workflows are required when native interfaces or dependencies change and at cross-platform milestones, not after every domain function or spacing edit.

The following are integration gates, not optional visual polish: failed durable commands with recoverable UI; invalid/unknown package data; assistance-aware ratings and correction; exact source/session continuity; visibility-safe conversation memory; long-session resource stability; supported-platform native execution; and import/recovery without source-data loss. Exact button cosmetics are not an application-wide gate unless they make the action inaccessible.

Evidence must correspond to the candidate source and declared inputs. A build succeeding in a browser does not prove Rust/mobile integration; emulator success does not prove physical-device behavior. Earlier mobile packaging failures remain unresolved until the actual new build and flow pass. Do not patch generated files or remove checks to hide them.

Changing these requirements or accepting a semantic omission needs an explicit maintainer decision. Refactoring, performance tuning and dependency replacement preserve the accepted contract. The aim is to evolve implementations behind stable product and data semantics without requiring another architectural reset.
