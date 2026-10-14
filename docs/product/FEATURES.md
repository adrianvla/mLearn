# Required product features

This catalogue is normative together with [SPEC.md](SPEC.md). The specification defines semantics and constraints; these rows define user capabilities that must not disappear inside broad labels such as Reader, Review or Messenger. Delivery units refer to [the implementation plan](../implementation/PLAN.md). A unit being accepted does not complete rows assigned to later units.

The catalogue describes the intended product, not current implementation status. Historical source names are navigation aids only. Existing code can establish the purpose of a control without making its architecture, constants or bugs requirements. [REFERENCE.md](REFERENCE.md) identifies selected sources and visual references. The pinned v2 reference is `1788f9c74dc73dd884b687ec80d9550c3ebf6c6b`; `../mlearn-ts` may contain additional work and must be inspected at its own recorded revision.

## Coverage and terminology

- Every retained behavior discovered in routes, menus, shortcuts, context actions, persisted settings, integrations or recovery paths needs a catalogue row or an explicit relationship to an existing row. Check its real consumer. Do not implement a dead setting solely because its name exists.
- Add newly discovered wanted behavior before closing the affected delivery unit. Removal, substitution or indefinite deferral requires a maintainer decision. Missing screenshot coverage is not retirement. Small controls that alter a workflow are features; internal helpers and decorative CSS are not separate features.
- A row can require several implementation steps without requiring several copies of its behavior. First delivery belongs to the named unit; subsequent surfaces must reuse it and extend its coverage. A row spanning several contexts is accepted only for the explicitly reviewed scope.
- `Needs reference` means required functionality whose precise interaction needs a source trace or a maintainer example. It is not permission to invent its behavior, remove it, or count a vaguely similar feature as equivalent. Unrelated implementation may continue.
- **Knowledge** names unified learner state/access, not a flashcard collection. Rust is its authority; any frontend `KnowledgeProvider` exposes bounded view data and subscriptions, not a renamed monolithic `FlashcardContext`.
- **Inspector** names contextual linguistic inspection, regardless of hover, click, touch or drawer presentation. Graph/evidence detail belongs to that inspection workflow. **Runtime Inspector** names developer inspection of execution and agent activity. **Material** names authored/saved learning items; **Review** names scheduler-led maintenance; **Practice** names deliberate work on selected material.
- **Annotated text** is one shared semantic presentation path for subtitles, documents, OCR text and messages. It consumes bounded native analysis and Knowledge results. No per-token backend client, independent knowledge model or duplicate Reader/Watch/Messenger tokenizer.

## Source opening, continuity and shared text

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| SRC-01 | Open local content through a picker, supported drag/drop and mobile import/share | Source identity and access permission survive the supported reopen path; unavailable files produce a recoverable error, not a blank view | M01 |
| SRC-02 | Resume a source from recents | Restore the correct file/content revision, position, source language and relevant tracks/view state; deduplicate repeat openings | M01 |
| SRC-03 | Choose source language independently of UI/definition language | A book, video and conversation can retain different language/variant contexts without global-state contamination | M02 |
| SRC-04 | Display a bounded batch of annotated text | Analyze the relevant cue/page/message range together; obtain Knowledge for distinct targets in bounded batches; display raw text during preparation without falsely classifying it | M01 |
| SRC-05 | Apply a Knowledge change consistently | Inspector, visible source annotations and the relevant list agree; unrelated content is not retokenized or reloaded | M01 |
| SRC-06 | Preserve exact surface text and source coordinates | Punctuation, whitespace, combining marks, source ruby, normalization and alternative analyses do not corrupt selection or source links | M02 |
| SRC-07 | Move between source, inspection, capture and learning | Return to the same source/page/time/selection without replaying Start or dropping unfinished work | M03 |
| SRC-08 | Retry missing, moved, unsupported or failed content | User can reselect/retry a source without deleting saved progress or confusing missing data with an empty result | M01 |
| SRC-09 | Navigate long documents/transcripts/messages | Windowing/pagination and bounded prefetch preserve position and selection; no whole-library render or per-token listeners/workers | M05 |
| SRC-10 | Search within applicable source content | Results navigate to a real page/span/cue/message with context and a return path; search scope and unavailable indexes are explicit | M10 |

## Language resources and Knowledge

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| LNG-01 | Obtain a usable real language package | Desktop installs authenticated code/data; mobile uses bundled compatible code and obtains its data; installed packages remain usable offline | M01 |
| LNG-02 | Choose and manage dictionary/definition-language resources | Supported dictionaries, package variants and providers use stable identities; missing packs never silently select another language | M02 |
| LNG-03 | See download/install state and recover | Progress, cancellation, retry, disk/network errors, compatible version activation and removal have real effects; failed activation retains the prior usable state | M02 |
| LNG-04 | Receive language-owned analyses | Tokenization, compound/morphological structure, normalization and contextual ambiguity use plugin logic; core remains unchanged for a structurally different plugin | M02 |
| LNG-05 | Add a third-party/private language package | SDK conformance, declared capabilities, resources, schemas and licensing are documented; desktop catalog configuration and mobile build inclusion are explicit | M02 |
| LNG-06 | Update language data without invalidating history | Stable targets survive rebuild ordering; withdrawn/changed capabilities produce explicit task incompatibility rather than fabricated remapping | M02 |
| LNG-07 | Render language-specific reading, pronunciation and structure | Package-declared fields and structured features remain inspectable even when not one of the original languages' categories | M02 |
| LNG-08 | Inspect package capability/resource problems | Identify unavailable analyzer/data/model/validator and the affected operation without blocking unrelated installed features | M02 |
| KNW-01 | Represent knowledge beyond authored cards | Targets can be observed, assessed or claimed without creating a card; authored material is not the knowledge database | M01 |
| KNW-02 | Distinguish untracked, assessed weakness, claims and predictions | Effective display comes from one native projection; exposure and absence never masquerade as assessed performance | M01 |
| KNW-03 | Set and withdraw explicit capability claims | Claims affect the effective view while preserving evidence-derived estimates and underlying observations | M01 |
| KNW-04 | Inspect the basis of a capability state | Show relevant evidence/claim/provenance, model and aggregation limits rather than only a colored badge | M10 |
| KNW-05 | Keep exclusions separate from knowledge | Ignoring/excluding material changes selection as declared, not the learner's demonstrated capability or retained evidence | M03 |
| KNW-06 | Inspect related linguistic entities | Identity, properties, alternative analyses and support are distinguished; homophones and dictionary siblings do not share knowledge by accident | M10 |
| KNW-07 | Use character/writing-system knowledge where supported | Grid/list/detail, associated readings/components and learning entry points are package-driven and reuse the same Knowledge/Inspector | M10 |

## Inspector and reading aids

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| INS-01 | Inspect from text, subtitle, image text or message | Same target/context contract; popup on desktop and suitable touch presentation; no independent lookup feature per source | M01 |
| INS-02 | See source form and nearby meaning | Preserve selected visual hierarchy, senses/definitions, context and dictionary attribution; do not impose one language's punctuation globally | M01 |
| INS-03 | Inspect reading/pronunciation/prosody and morphology | Applicable structures, alternate forms and uncertainty are shown; absent capabilities are not fabricated | M02 |
| INS-04 | See and adjust Knowledge using pills/controls | Visible granular states and explicit corrections use the same native commands as other knowledge surfaces | M01 |
| INS-05 | Open deeper linguistic/evidence details | Detail navigation preserves original source and target; no separate conflicting Inspector state | M10 |
| INS-06 | Trigger inspection deliberately | Preserve supported immediate, delayed and modifier-assisted desktop inspection; provide touch/keyboard access without copying pointer-only semantics | M02 |
| INS-07 | Move across popup content and nested actions | Stable anchor/identity; no flicker, remounting, repeated lookup or accidental close when crossing related content | M01 |
| INS-08 | Copy or explain a selected phrase/item | Actual selected context is used; optional provider readiness is checked at the action, not before reading/inspection | M07 |
| INS-09 | Play pronunciation and select available recorded/generated audio | Audio provider/language is explicit, loading/failure/cancel are visible; playback does not certify comprehension | M08 |
| INS-10 | Capture or reuse the inspected item | Selected sense/context and source media are retained; duplicate or failed capture is visible and retryable | M03 |
| INS-11 | Control reading annotations and linguistic coloring | Publisher readings are distinct from inferred readings; color/annotation visibility can reflect the relevant capability without flashing false Unknown states | M02 |
| INS-12 | Inspect a long or ambiguous entry | Content scrolls within usable bounds while primary actions remain reachable; missing lookup has a scoped retry | M02 |

## Watch and subtitles

Reference entry: `src/renderer/windows/main/routes/VideoRoute.tsx`; inspect its actual player, subtitle, track, clip and sidebar consumers rather than copying the route's renderer state.

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| VID-01 | Play/pause/seek local video with usable audio and progress | Playback, duration, volume/mute and end/error states use a real player on supported hosts; no fake media stage | M01 |
| VID-02 | Resume playback and selected source | Reopen retains position and source metadata without silently restarting or changing the source language | M01 |
| VID-03 | Load external subtitles | Supported subtitle files associate with the correct media and retain timing, line breaks and source text; reload/retry is possible | M01 |
| VID-04 | Discover/select embedded and alternate tracks | Available audio/subtitle tracks can be selected; unavailable codecs/tracks are explained without claiming arbitrary format support | M02 |
| VID-05 | Display and navigate subtitle/transcript content | Current cues, line navigation, contextual inspection and supported search/selection stay synchronized with playback | M02 |
| VID-06 | Adjust subtitle synchronization | Timing offset/sync operation has a defined persisted scope and changes actual cue timing; reset is available | M02 |
| VID-07 | Preserve supported ASS presentation | Preserve applicable timing/style/layout information and its linguistic selection mapping; unsupported effects are identified, not silently stripped and called complete | M02 |
| VID-08 | Use fullscreen, compact view and playback shortcuts | Primary player/Inspector controls remain usable with correct focus/IME handling and source continuity | M02 |
| VID-09 | Configure playback rate, repeat/line behavior and subtitle aids | Inventory each active legacy control and retain approved behavior; do not silently drop a useful control under a generic player replacement | M02 |
| VID-10 | Inspect unknown/relevant words from the video | Sidebar/list highlights the source, supports one/all eligible capture and exclusion, and can open scoped practice with Return | M03 |
| VID-11 | Capture a frame, sentence and available audio/video segment | Boundaries correspond to the selected source; shared Capture owns deduplication, media references and failures | M03 |
| VID-12 | Open supported remote/online media | Streaming, subtitle source and session errors are explicit; saved local work is usable when a provider is unavailable | M19 |
| VID-13 | Watch synchronously with others | Room join/create and playback synchronization preserve each participant's source/authorization; media rights and source availability are not assumed | M18 |

## Reader, OCR and image interaction

Reference entries: `ReaderRoute.tsx`, its navigation/sidebar/status/layout/resume consumers, `OcrOverlay.tsx`, `OcrWord.tsx`, `ReadingAnnotationHider.tsx` and `MagnifyingGlass.tsx`. Features below must not collapse into 'can open a PDF'.

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| RDR-01 | Read EPUB and text content | Preserve structure, source text and authored reading spans; source position survives reflow rather than depending only on a rendered page number | M05 |
| RDR-02 | Read PDF using available text or rendered pages | Extracted text and image/OCR paths are honest about fidelity and mapping; do not OCR already usable text by default | M05 |
| RDR-03 | Open image collections/folders and navigate pages | Stable ordering, named source and progress; mobile import differences remain in the source adapter | M06 |
| RDR-04 | Use contents/thumbnails and previous/next navigation | Selected/visible pages, progress and source position agree; failed or unavailable pages do not replace valid content silently | M05 |
| RDR-05 | Choose fit, single/double-page and reading direction | Fit-height/width, left/right progression and spread placement preserve source identity and navigation | M06 |
| RDR-06 | Control first-page pairing and collated spreads | Toggling first-page-single/collation neither skips nor duplicates source pages; side placement respects progression direction | M06 |
| RDR-07 | Use automatic/horizontal/vertical writing and reader appearance | Applicable package/content support, font/size/spacing/theme changes preserve source location and readable ruby/punctuation | M05 |
| RDR-08 | Inspect publisher-authored readings | Source ruby, including partial token spans, remains separate from dictionary-inferred readings through reflow and cache updates | M05 |
| RDR-09 | View relevant/unknown source words | Source-linked list, highlight, inspect, exclude, capture one/all and scoped practice reuse the same Knowledge/Capture contracts | M06 |
| RDR-10 | Copy/explain source text or context phrases | Context selection is grounded in the source; optional explanation does not make local reading dependent on an LLM | M07 |
| OCR-01 | Recognize page/image text on device | iOS: Vision on-device text recognition. Android: verified on-device OCR provider (evaluate bundled ML Kit v2). Desktop: supported tuned/package provider. Each recognizes representative content without a cloud or Python dependency on mobile, and returns source-local errors and retry | M06 |
| OCR-02 | Recognize selected crop regions | Add/reprocess a region while preserving other valid regions and mapping its result back to the original image | M06 |
| OCR-03 | Toggle aligned interactive OCR text | Text hit areas track source-image scaling, offset and layout; Inspector/capture resolve the actual region, including a two-page spread | M06 |
| OCR-04 | Use the reader's recognized-text mirror presentation | Required as a distinct interaction from ordinary hit-box overlays or magnification. Trace the selected historical implementation and obtain a reference capture before fixing its interaction contract; do not substitute one of those other features | M06 |
| OCR-05 | Navigate while recognition is queued or running | Visible work takes priority; bounded prefetch, cancel/retry and honest progress preserve completed page results without stale publication | M06 |
| OCR-06 | Group text and reading annotations correctly | Preserve context across nearby regions, orientation and punctuation; annotation filtering must not create page-sized false hover targets | M06 |
| OCR-07 | Hide/reveal publisher reading annotations | Conceal the identified annotation region without deleting source data or ordinary text; deliberate reveal is accessible | M06 |
| OCR-08 | Magnify the source image independently | Lens/zoom reveals source pixels rather than magnifying UI or OCR text; supported hold/release/wheel behavior has a touch alternative | M06 |
| OCR-09 | Inspect and correct recognition/alignment problems | Relevant text/region correction, re-recognition and diagnostic views have explicit persistence/refresh effects; debug thresholds do not automatically become permanent ordinary settings | M06 |
| OCR-10 | Reuse recognition and analysis safely | Cached results are keyed to source revision/region/provider/model/package conditions, survive applicable resume and invalidate after relevant edits | M06 |
| OCR-11 | Report native OCR capability and output provenance | Supported scripts/languages and install/readiness status come from the executing provider; unsupported language or missing model is explicit. Reading order, candidates and hit geometry remain attributable to the provider and actual image | M06 |

## Capture, authored material and collection management

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| MAT-01 | Capture from any supported source | One pipeline stores target/sense, phrase and source anchor plus selected media; Reader/Watch/Inspector/Conversation do not author incompatible records | M03 |
| MAT-02 | Add/edit material manually | Useful fields, examples, readings, audio/images and source associations can be edited without a model; authored changes remain distinct from learner claims | M03 |
| MAT-03 | Detect duplicates and resolve ambiguous capture | User can reuse an item or retain an intentional distinct sense/context; identity is not guessed solely from displayed text | M03 |
| MAT-04 | Retry failed single/bulk capture | Eligible and failed items remain identifiable; retries do not create duplicates or mark failed items as saved | M03 |
| MAT-05 | Browse/search/filter/sort a large collection | Counts and displayed membership agree; combine scope/level/status/material filters without loading the entire profile into React | M10 |
| MAT-06 | Select and change multiple items | Supported bulk add/edit/exclude/remove actions have clear scope and consequences; selection remains stable while data refreshes | M10 |
| MAT-07 | Review generated and suggested material | Generation status, source grounding, editable proposals, accept/reject and partial failure are real; proposals do not become learner evidence | M10 |
| MAT-08 | Attach/play/replace/export media | References and lifecycle distinguish authored media from caches; no duplicate base64 history or silent removal with a cache cleanup | M03 |
| MAT-09 | Find the source of retained material | Open the originating page/cue/message or a clear missing-source state; moving into practice preserves a Return destination | M03 |
| MAT-10 | Import/export selected or full supported material | Preserve IDs, content, media and interpretation; validate before activation and report unsupported fields rather than manufacture replacements | M16 |

## Review, Practice, calibration and assessment

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| LRN-01 | Start scheduler-led due Review | Scheduling is native and independent of a Browse filter; exact admitted task and due semantics are inspectable | M04 |
| LRN-02 | Retrieve then reveal and self-rate | Ordinary retrospective self-report after Reveal remains valid; assistance/earlier disclosure changes evidence only as the actual conditions require | M04 |
| LRN-03 | Rate compatible capabilities together | One encounter supports visible granular outcomes and eligible bulk grades, not one repetitive card per capability | M04 |
| LRN-04 | Adjust individual capability grades | Partial knowledge and unresolved targets survive bulk/Adjust changes; submitted outcome matches displayed choices | M04 |
| LRN-05 | Use rating shortcuts and single/double key sequences | Existing supported `1/2/3/4` and `11/22/33/44` semantics, Reveal and Undo are reachable without firing in inputs, IME or unrelated modals | M04 |
| LRN-06 | Correct a recent response | Coherent retract/replace with original conditions, no extra fresh-retrieval claim, no immediate duplicate re-admission caused by correction | M04 |
| LRN-07 | Recover from a failed/pending write | Retry keeps identity; UI distinguishes pending from committed; no partial evidence/scheduler update or duplicate after restart | M04 |
| LRN-08 | Pause, resume and switch unfinished tasks | Exact cue/exposure/scope/cursor retained; Start does not overwrite suspended work, and navigation does not replay admissions | M04 |
| LRN-09 | Continue normal work or complete an explicit finite set | No arbitrary inferred short-session cap; user-bounded membership and progress stay intelligible while background data changes | M04 |
| LRN-10 | Use written, focused and audio probes | Cue/response directions and prerequisites are explicit; unavailable or failed audio is not treated as completed delivery | M04 |
| LRN-11 | Prevent answer leakage across incompatible probes | A cue that supplies another target's answer changes admission/classification; content/revision refresh does not mutate an already displayed task | M04 |
| LRN-12 | Practise a selected source/list/status/level | Deliberate scope remains exact, including partial knowledge; no silent expansion to all words or substitution with due Review | M11 |
| LRN-13 | Calibrate current Knowledge / Word Sync | Assess unmeasured state with bounded appropriate probes; calibration purpose and self-report limits remain distinct from instruction | M11 |
| LRN-14 | Inspect and practise package-defined grammar | Detail, examples, formation and relationships lead to real supported recall/production work without another knowledge store | M11 |
| LRN-15 | Perform contrast, choice and typed exercises | Correct task/validator executes, captures actual response and assistance; recall-only fixtures do not count as scored contrast | M11 |
| LRN-16 | Take supported fixed/timed assessments | Blueprint, timing, response/feedback policy and scoring are explicit; interruptions/resume preserve the intended conditions | M12 |
| LRN-17 | Inspect assessment results and practise relevant gaps | Results link to the actual requirements/items, distinguish unsupported conclusions and open scoped practice with Return | M12 |
| LRN-18 | Create/customize probes as an expert | Declared targets, cue/response, supplied information and validation remain accountable; custom templates cannot invent a successful observation | M11 |
| LRN-19 | Let the application create/select useful probes | Package capability and resource availability drive automatic coverage; manual template authoring is not necessary for basic listening/reading practice | M04 |

## Goals, policy, progress and retained history

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| POL-01 | Select a meaningful curriculum/outcome and subset | Stable package/group membership, overlap handling and provenance; unknown groups never broaden the target | M12 |
| POL-02 | Add deadline and genuine constraints | Preserve actual success conditions, conjunctions/section minima and available task resources; no arbitrary goal-name/status questionnaire | M12 |
| POL-03 | Inspect coverage and unsupported requirements | Distinguish unmeasured, weak, supported and unavailable; practice percentages do not become official exam scores/readiness | M12 |
| POL-04 | Receive a worthwhile next action or continue current activity | Native policy compares teaching, maintenance, diagnosis and deferral against the same realistic alternative and respects admitted work | M13 |
| POL-05 | Account for effort, interruption, uncertainty and information value | Do not turn usage time into a calendar, double-count actions or learning/information, or present engineering priors as observed causal effects | M13 |
| POL-06 | Update learner predictions over time | Versioned HMM/predictor inputs and state distinguish claims/exposure/assistance and task direction; model revisions preserve honest history limits | M13 |
| POL-07 | Inspect a policy/prediction decision | Explain actual inputs, constraints, assumptions and alternatives in Runtime Inspector, not generic motivational copy in the main flow | M13 |
| PRG-01 | View activity and capability progress | Use appropriate evidence and physical-attempt counts; filtering/aggregation agree with Knowledge and material scope | M14 |
| PRG-02 | Inspect recent and long-term history | Show available observation detail and older summary intervals without implying discarded detail still exists | M14 |
| PRG-03 | Keep historical storage proportional | Compact recent data, daily/weekly/coarser summaries and versioned checkpoints; expose categories/budgets and protect authored content/sync obligations | M14 |
| PRG-04 | Upgrade/rebuild learner projections safely | Exact replay where data remains, explicit checkpoint migration/approximation otherwise; no full-history fit on every interaction | M13 |
| NAV-01 | Open useful recents/Resume from Home | Actual content and unfinished activities, direct entry without mandatory setup, honest missing-source state | M01 |
| NAV-02 | Navigate Plan, Knowledge, Material and active tasks | Shared route/source context; no duplicate activity applications or automatic remount/reset when revisiting | M10 |

## Conversations, people and world continuity

Reference entry: `src/shared/world.ts`, plus actual messenger/participant/scenario/journal consumers. The later conversation behavior is a strong reference; it is not permission to import its storage/layout wholesale.

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| CON-01 | Browse contacts/People independently of chats | Create/edit/reuse an identity and start a conversation without first constructing a Room; no duplicate person per session | M07 |
| CON-02 | Open/search saved conversations | Accessible without a working model; real history, current selection and continuation preserve context | M07 |
| CON-03 | Compose and stream text conversations | Send/stop/retry and failure state are clear, input survives relevant interruptions, history updates do not force scrolling away from older messages | M07 |
| CON-04 | Inspect/capture language in messages | Use the same Annotated Text, Inspector, Knowledge and Capture as media; no analysis starting only when hovered | M07 |
| CON-05 | Use message-level and participant actions | Retain approved reply/context/edit/delete/correction actions after tracing actual callers; update dependent state rather than leaving invisible stale memories | M07 |
| CON-06 | Run temporary task-focused Threads | Purpose/participants can be configured and resumed; disposable continuity is default for temporary work, not an implicit persistent world | M07 |
| CON-07 | Get contextual explanations and corrections | Feedback is associated with actual message/source and validation limits; it does not interrupt every utterance or fabricate graded proficiency | M07 |
| CON-08 | Configure a scenario with real participant identities | Purpose, cast, situation and constraints reach the executed scenario; existing identities resolve before creating new ones | M09 |
| CON-09 | Use optional persistent Rooms and Sea continuity | Explicit activation, durable context and coherent relationships; ordinary task-focused use does not require roleplay/social maintenance | M09 |
| CON-10 | Integrate a Thread deliberately | Selected continuity has attributable source mapping, no unrelated private knowledge disclosure and no accidental global learner-data deletion on discard | M09 |
| CON-11 | Limit each participant's knowledge | Witnesses, presence, disclosures and source authority constrain memory; joining a room does not grant every past/private event | M09 |
| CON-12 | Keep source canon and lived history separate | Content progress/spoiler boundary and alternate scenarios do not overwrite canonical source facts or prior lived interactions | M09 |
| CON-13 | Resolve genuine identity/continuity ambiguity | Prompt only for consequential ambiguity; contradictions are reviewable, not repaired by silent participant clones or invented events | M09 |
| CON-14 | Remove/correct conversational content coherently | Derived memories/resolutions and visibility update with the action; authored records and admitted learning evidence have explicit separate retention | M09 |
| CON-15 | Inspect conversation/memory execution | Runtime Inspector reveals actual prompts, context, tool activity, responses, memory/source links and publication status; secrets are redacted | M07 |

## Speech and agent lifecycle

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| VOI-01 | Select/test available speech input/output providers | Real local/remote availability, language/voice choice and model resources; ordinary saved content works without them | M08 |
| VOI-02 | Speak through microphone/STT with VAD and turn control | Permission, capture, partial/final recognition, stop and recoverable failure use the actual native audio lifecycle | M08 |
| VOI-03 | Hear streamed/saved speech | Generation and playback state are distinct; replay is possible and interruption does not mark an unheard full reply as delivered | M08 |
| VOI-04 | Interrupt or barge into a call | Stop queued/current output, preserve confirmed delivery and resume turn-taking without duplicate messages or stuck microphone ownership | M08 |
| VOI-05 | Preserve participant voice identity and supported voice authoring | Reuse configured voices and supported authorized reference-audio workflows without silently substituting an incompatible model | M08 |
| VOI-06 | Reuse speech across Inspector, Review and Conversation | One resource/provider policy with bounded models/queues, not a new synthesis engine per component or participant | M08 |
| AGT-01 | Run scenario direction and tool activity under application authority | Generated proposals are validated; model content cannot select its own permissions or fabricate completed user actions | M09 |
| AGT-02 | Reflect/consolidate memory with Dreamer/background work | Bounded source windows, provenance, cancellation and idempotent publication; partial jobs do not become canonical | M15 |
| AGT-03 | Maintain grounded fictional intentions/occurrences | Simulated events remain fictional, witness-scoped and linked to actual state; do not attribute participation to the human | M15 |
| AGT-04 | Receive controlled proactive contact/invitations | Opt-in/availability/budget constraints, once-only delivery, decline/mute and restart recovery; no implicit real-world sending authority | M15 |
| AGT-05 | Use task-focused operation without the persistent world | A coherent mode boundary, not a menu of independently broken autonomy switches; saved work remains understandable when modes change | M09 |
| AGT-06 | Inspect background runs and policy failures | Same Runtime Inspector includes prompts/tools/memory/proactive decisions and retry/cancel state rather than several unrelated dashboards | M15 |

## Integrations, collaboration and managed use

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| INT-01 | Import supported existing v2 profiles safely | Use a source copy/read-only access, preserve meaningful data/media and provenance, report unsupported mappings; no write to the live v2 folder | M16 |
| INT-02 | Import/export Anki material and review history | Preserve source IDs and available interpretation; missing history is not invented, unrelated knowledge is not collapsed into cards | M16 |
| INT-03 | Use supported live Anki integration | Explicit ownership, deduplication and conflict/error handling; missing AnkiConnect does not erase cached/local information | M16 |
| INT-04 | Pair devices and synchronize local learning state | User-authorized peers, integrity/conflict handling and source identities; sync evidence/actions rather than only a derived Known flag | M17 |
| INT-05 | Continue work across devices | Compatible source/task positions, package requirements and in-flight/correction semantics remain explicit; unsupported file access has a usable recovery | M17 |
| INT-06 | Use optional hosted or self-hosted sync/services | Local workflows and data ownership remain intact; configuration, authentication and remote failures do not become separate application editions | M17 |
| INT-07 | Join/create Watch Together sessions | Actual playback/seek/pause continuity and membership; selecting a source is distinct from transferring copyrighted media | M18 |
| INT-08 | Capture/inspect from desktop overlays and external definition entry | Focus, capture region, source context, shortcuts and close/return work; mobile uses an explicit import/share counterpart where possible | M19 |
| INT-09 | Use the browser extension and supported online subtitle routes | Pairing, source capture/lookup and denied/unavailable site behavior are explicit; no claim of arbitrary streaming-site extraction | M19 |
| INT-10 | Use picture-in-picture or detached utility surfaces where supported | Preserve source/control ownership and return; do not multiply complete application state into each window | M19 |
| SCH-01 | Connect an institution-managed account/policy/provider | Role/authorization and effective policy are enforced natively/service-side and their visibility is communicated | M20 |
| SCH-02 | Work on teacher-directed material/assignments | Outcomes, scope and permitted evidence/reporting use the same learner model, not a parallel school-only implementation | M20 |
| SCH-03 | Keep personal and institutional contexts separate | Authorized staff access does not extend to unrelated private conversations or personal world continuity | M20 |
| SCH-04 | Run group human/agent speaking activities | Participant identity, floor/audio ownership and interrupted sessions are coherent; AI participants create a real interaction rather than independent private chats | M21 |
| SCH-05 | Use missions/campaigns and reusable scenario templates | Teacher objective/constraints reach each instantiated scenario; progress and personal integration use existing Room/Thread contracts | M21 |
| SCH-06 | Inspect formative capability evidence | Actual performance conditions and limitations are visible; generated feedback is not an automatic formal grade/certificate | M20 |

## Settings, resources, recovery and delivery

These controls are implemented alongside their owning feature. M22 closes the inventory and interaction gaps; it must not postpone all settings until the end.

| ID | Required capability | Acceptance condition | Unit |
|---|---|---|---|
| OPS-01 | Search/edit active preferences | Every setting has one native owner/default/consumer, clear scope and application timing; dead aliases and Tactile/Flat are retired | M22 |
| OPS-02 | Apply built-in or user-defined themes | Runtime theme documents work across supported renderers; changing appearance does not migrate profiles or alter task evidence | H00 |
| OPS-03 | Select/reset input and source-display preferences | Relevant shortcuts, inspector activation and aids affect the intended surface without leaking through IME/modal contexts | M22 |
| OPS-04 | Manage neural models and providers | Show availability and failures for system OCR without pretending to download its OS-managed model; download/cancel/remove/test only separately installable neural models, with bounded resource ownership and actual supported inference | M06 |
| OPS-05 | Inspect storage and clean regenerable data | Size categories distinguish content/history/models/cache/backups; cleanup states consequences and preserves authored data | M14 |
| OPS-06 | Back up/restore and recover from corruption | Consistent bounded recovery points and safe activation; diagnostics/export remain accessible when normal startup fails | M22 |
| OPS-07 | Configure catalogs/services and institutional endpoints | Authenticated configuration, explicit trust and privacy consequences, cached offline operation; development keys cannot authorize release installs | M02 |
| OPS-08 | Use native permissions and device lifecycle safely | File/media/microphone/capture grants, backgrounding, interruption and relaunch are tested in their owning feature; no stalled global readiness gate | H00 |
| OPS-09 | Inspect diagnostics/runtime errors | Exact operation, source/revision and relevant traces are accessible without exposing credentials or requiring fake data | H00 |
| OPS-10 | Update the application safely | Correct channel/identity/signature, migration and rollback obligations, no overwriting the v2 app/profile through development defaults | M24 |
| OPS-11 | Use localized accessible controls | Real labels/states, keyboard/touch/screen-reader entry, large text and reduced motion/transparency; untranslated placeholders and empty accessibility matrices are not acceptance | M22 |
| OPS-12 | Use a deliberately designed mobile layout | Maintainer-directed phone/tablet arrangement over the same feature semantics; design remains separately pending while functional milestones proceed | M23 |
| OPS-13 | Use sustained workloads within a supported device budget | Representative >30-minute sessions, cold/warm resource measurements and recovery; raising heap limits or hiding controls is not the fix | M24 |
| OPS-14 | Install/distribute a complete supported application | Release artifacts and licenses match actual code/data, platform capability limits are documented, no runtime Python dependency or missing mobile native library | M24 |

## Inventory closure

Before an area is proposed for acceptance, compare its active v2 entry points, menus, shortcuts, setting consumers, import/export fields and error/recovery states with these rows. Keep an explicit unresolved entry for a wanted behavior not yet specified. The review packet names the rows it delivers, those remaining and intentional differences. The complete product cannot be declared done with unmapped legacy behavior or unresolved required rows.

This is not a test-generation list: several rows may share one meaningful end-to-end scenario and one authoritative semantic test. Nor is it permission to build all rows in parallel. The maintainer review gate in the implementation plan controls progression.
