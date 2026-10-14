# Product references and UI capture guide

Use with [SPEC.md](SPEC.md), [FEATURES.md](FEATURES.md) and the [review-gated plan](../implementation/PLAN.md). This is a selection/discovery record, not a declaration that all referenced code works or that every legacy path has been audited.

## Reference locations

- Local browsable v2: `../mlearn-ts`. Check its revision before using it; do not edit it or test against the live user profile.
- Pinned T2 reference: `archive/v2-final`, commit `1788f9c74dc73dd884b687ec80d9550c3ebf6c6b`.
- Earlier Git revisions supply selected visual/interaction references. 'v2.9 style' does not identify one accepted commit for every surface. Record the actual revision or mark it unknown.
- Initial v3 foundation inspected: `d726ea9f81bfc4a77e762487dec345eb56177eb4`. Its welcome screen is integration scaffolding, not the product layout to expand.
- Project discussion material includes `mLearn Agent Overhaul Ideas.txt` and deployment documents. Their proposals are not proof of implemented behavior; the current product specification selects the relevant direction without importing their promotional text.

For a consequential feature decision, record: surface/behavior, source revision or screenshot, keep/change/retire/unresolved, intended outcome, known defect and resulting acceptance condition. Functional and visual dispositions can differ. Do not create a record for every CSS declaration.

## Names in new implementation

Use **Inspector** for contextual linguistic inspection, **Knowledge** for unified learner access and **Runtime Inspector** for developer execution inspection. Names such as `WordHover`, `FlashcardContext`, `OcrWord` and old window families remain useful when searching the reference checkout; they are not names or boundaries to reproduce. The new Inspector may be a popup or a mobile drawer without changing its semantic owner.

## Selected behavior and discovery map

All v2 paths below refer to the pinned archive, not paths to recreate in v3. Check active callers before treating an implementation as delivered. Historical checkpoint reports identify leads and earlier evidence; their 'complete' statements are not current acceptance.

| Area | Initial disposition | Useful source/reference |
|---|---|---|
| Immersion and media | Keep source-first reading/watching, lookup, capture and exact continuation; reimplement hosts | `README.md`; `src/renderer/`; `src/root-of-app/`; `docs/ACTIVITY_HOST_CHECKPOINT.md` |
| WordHover / Inspector | Keep central role, knowledge pills and contextual density; select appearance separately | `src/renderer/` WordHover/Inspector implementations and historical CSS; `src/shared/knowledge/effectiveKnowledge.ts` |
| Learner semantics | Keep claim/evidence/exposure/prediction distinction; replace thresholds/fallback mechanics | `src/shared/knowledge/effectiveKnowledge.ts`; `src/shared/learningModel.ts`; `docs/LEARNING_CONTROLLER_CHECKPOINT.md` |
| Graph | Keep stable identities, identity/property/support distinction, alternate analyses and open features; replace closed/legacy dependencies | `src/shared/graph/types.ts`, `access.ts`, `targets.ts`, `compact.ts`; `src/electron/services/linguisticGraph.ts` |
| Probes and Review | Keep cue-conditioned granular evidence within holistic encounters, audio distinction, correction and resume; remove renderer authority | `docs/ADAPTIVE_REVIEW_CHECKPOINT.md`; `docs/FLASHCARD_REVIEW_INTERACTION.md`; `src/renderer/` FlashcardReview/StudyEncounter/RatingMatrix owners |
| Goals, scope and ROI | Keep package-defined requirements, feasible action comparison and uncertainty; do not copy unfitted numerical constants | `src/shared/learningOutcomes.ts`; `docs/LEARNING_CONTROLLER_CHECKPOINT.md`; `docs/GOAL_HOME_ENCOUNTER_CHECKPOINT.md` |
| Practice / calibration / evaluation | Keep distinct purposes and shared interaction; select final navigation | `docs/product-refactor/LEDGER.md`; `docs/LEARNING_PRODUCT_REFACTOR.md` |
| Conversations | Strong later functional reference; retain messenger behavior, participants, voice and inspection rather than earlier generic chat layouts | `src/shared/world.ts`; `src/electron/services/` world/journal/conversation/voice services; `src/renderer/` conversation owners |
| Sea / Thread | Keep scope, witnesses, source-grounded memories, deliberate integration and separate learner evidence | `src/shared/world.ts`; journal/world/integration/character/Director/Dreamer service callers |
| Settings | Rebuild active settings from purpose to consumer; retire Tactile/Flat and compatibility aliases | `src/electron/services/settings.ts`; `src/shared/types*`; `src/shared/constants*`; renderer settings consumers |
| History / recovery | Preserve data meaning, independent integrity and recovery; replace whole-store write and indefinite replay arrangements | `src/electron/services/flashcardStorage.ts`, `knowledgeHistoryStore.ts`; `src/shared/knowledge/historyArchive.ts`; `docs/guardian-kikan-runtime.md` |
| Anki / external integration | Keep useful optional workflows, explicit host availability and failure recovery | `README.md`; Anki callers in `src/electron/services/`; `extension/`; companion/mobile references |
| School / managed services | Keep role/authorization/provider boundaries; separate existing behavior from planned campaigns/group work | `SCHOOL_DEPLOYMENT.md`; `management/`; deployment policy documents |

Use filename/symbol search for entries given as directories; these identify ownership areas, not claims of an exact file name. Do not spend time reconstructing inaccessible old screenshots when the behavior can be specified and tested independently.

## Known traps to avoid reproducing

| Evidence | Consequence for v3 |
|---|---|
| `effectiveKnowledge.ts` resolves new and old threshold aliases and includes legacy half-synced fallbacks | Preserve explicit-claim/evidence semantics, not the fallback ladder, field aliases or old ease-number ontology |
| `learningOutcomes.ts` retains unknown selectors but marks them unavailable | Preserve unfamiliar data without pretending it is runnable; never broaden an unavailable goal subgroup into another list |
| `graph/types.ts` distinguishes source dictionary grouping and shared pronunciation from identity | Do not collapse target identities merely to deduplicate storage; do not copy its centrally fixed linguistic inventory as the v3 limit |
| `settings.ts` mixes `settings.json`, catalog loading, theme migration, old metadata normalization and Python dependency activation | Split actual ownership; a saved field or migration helper is not evidence that its old UI belongs in v3 |
| `FLASHCARD_REVIEW_INTERACTION.md` records full-history refits, repeated inactive-window scans and whole-store serialization during ratings | Test bounded native queries, scoped invalidation and long-session memory on representative data; raising a heap limit is not acceptance |
| `flashcardStorage.ts` replaces the current JSON snapshot; Guardian maintains separate bounded recovery copies | Do not claim the old app saved a complete historical library per rating. Measure actual disk categories before choosing retention/compression |
| `world.ts` separates event scope from witnesses and records voice-delivery provenance | Durable world membership is not omniscience; generated text is not completed speech or observed learner performance |
| Earlier review/grammar/audio reports include incomplete native content and validator coverage | An API, fixture or package schema is not delivered grammar content, validated assessment or actual playback |
| Late activity-host work introduced multiple native window families and persisted compatibility fields | Preserve source Return/resume; do not make those windows and fields the architecture of the single-client v3 app |
| Goal/controller reports include explicit engineering priors, numerical bounds and uncalibrated forecasts | Preserve honest uncertainty and constraints; do not promote chosen constants, list means or model output into an official readiness metric |
| Maintainer reported hover-triggered writes, stalled loading, long-session heap failures and inert settings/actions | Reproduce the affected behavior on an isolated reference where useful; do not copy the apparent UI while retaining its mutation/initialization path |

Source inspection here is targeted, not exhaustive dead-code certification. For each new work area, trace UI entry → command/service → persisted effect → downstream consumers and check alternate callers. Retire unreachable code from the new design; preserve real import/export/service obligations at explicit boundaries. A test-only caller does not make a feature live.

## Screenshot selection

**Only the maintainer's edited images are approved visual targets.** They describe the desired composition of the captured surface/state, not merely inspiration from v2. Reproduce the edited hierarchy, shown controls, relative placement, spacing intent, information density and visual language closely; responsive layout, legible content, native interaction and accessibility take precedence over literal old CSS or fixed pixel coordinates. Runtime/data evidence separately establishes correctness.

**Unpictured and unedited v2 UI is intentionally not selected.** Do not browse remaining v2 screens looking for attractive styling to fill gaps, auto-generate replacements, or treat archived screenshots as approval. The feature catalogue, not incidental v2 controls, determines wanted product behavior. If a required feature has no edited image, mark the presentation `visual_pending`, provide only a minimal usable interim control where needed, and ask for its final arrangement at review. If an edited image omits a catalogue-required control, report the conflict; do not reinsert it into the pictured design or silently retire its behavior.

For each edited image, retain its surface/state and viewport information; optional annotations can identify interaction and changes not visible in a still. Unedited before-images may be supplied for comparison but have **no** authority over the final UI. Do not alter the real learning profile to stage a capture; redact private conversations and credentials.

### First batch

| Set | Capture | Decision it resolves |
|---|---|---|
| 1. WordHover / Inspector | Preferred popup in real reading context; expanded knowledge/Inspect; one longer or ambiguous entry | Information hierarchy, nearby meaning, pills, action placement, nested interaction |
| 2. Review / ratings | Question, revealed answer with ratings, expanded Adjust; audio cue state if available | Holistic versus granular presentation, reveal boundary, keyboard feedback, essential controls |
| 3. Messenger | Preferred recent conversation with history and composer; contacts/start conversation; voice state; developer inspector if available | Which later conversation UI to retain and how much machinery stays out of ordinary view |
| 4. Reader / Watch | Preferred EPUB/text, PDF or OCR page; image spread and page controls; video with subtitles/transcript and popup; compact window example | Source dominance, reading aids, selection, toolbar/sidebar hierarchy and source Return |

A 15–30 second clip is preferable to many stills for popup flicker, reveal/rating/Undo, scrolling, audio interruption or returning to media. It is optional; stills plus a stated interaction are sufficient for the initial design reference.

### Small interactions that need a deliberate reference

Include the reader's recognized-text mirror state and a short open/use/close sequence; its exact intended interaction is required but was not established by the currently inspected files. Ordinary OCR hit areas and the image-only magnifier are separate features, not substitutes. Also capture annotation hide/reveal, crop re-recognition, source ruby, first-page pairing/collation and a relevant unknown-word sidebar where these are important to the preferred workflow.

For Watch, include subtitle timing adjustment, embedded/alternate tracks, clipping/capture and any rate/repeat behavior to preserve. For learning, include the actual single/double-key grading behavior and a correction/resume sequence. For Messenger, include People/contact creation independently of a chat, task-focused versus persistent entry, actual message/context actions and the execution inspector.

No phone mockups are required before implementation. Initial native functionality must work; final mobile composition is reviewed in the separate design pass. Label screenshots as preferred/reference/problem examples rather than implying every captured button or old mode must be reproduced.

### Second batch, when those areas are implemented

| Set | Capture | Decision it resolves |
|---|---|---|
| 5. Home / Plan | Preferred Home with real recents/resume; selected curriculum/scope and unavailable/missing requirement state | Useful entry points without generic dashboards or fake readiness |
| 6. Browse / Knowledge | Dense filtered list, bulk selection/edit, detailed capability/graph inspection, character view where relevant | Power-user density and the distinction between material and learner state |
| 7. Grammar / evaluation | Recall/contrast/typed or timed assessment actually available, including feedback | Which experiences exist versus partial fixtures and what evidence they claim |
| 8. Settings / recovery / onboarding | Preferred navigation/search, relevant provider/language controls, recovery access; annotate retired controls | New active settings inventory without copying dead fields or Tactile/Flat branches |

For a surface that changed substantially, the maintainer's final edited image is the target; an earlier/later unedited image can only document behavior or what was removed. Do not capture every language, theme or viewport. A Japanese example and a structurally different language such as German help validate that the selected UI survives different content structures, not grant automatic permission to copy either legacy layout.

Existing local reference leads named in the archived activity report include `~/mlearn-acceptance-runs/activity-host-20261005/` with `reader-compact.png`, `watch-large.png`, `messenger-compact.png`, `study-adjust-large.png`, `plan-large.png`, `knowledge-compact.png`, `progress-large.png`, and `settings-large.png`. Their existence on the maintainer's current machine has not been verified. These and historical v2.9 images are **behavioral comparison sources only**, unless the maintainer explicitly supplies an edited/approved visual for that surface. A historical version being preferred generally does not mean every visible element in it was selected.

## Verification boundaries for this specification

- The initial foundation and hello-plugin demonstration are not acceptance of any learner, conversation or media workflow in this specification.
- Desktop Mac feedback in this conversation established the greeting, theme change/persistence and theme editor on the maintainer's machine. It did not establish mobile behavior or real-language performance.
- Historical native reports and test counts are leads, not transferable certification. Preserve specific useful regression cases without importing their entire test implementation or obsolete UI assumptions.
- Documentation does not fix native packaging or interaction failures. H00 in the implementation plan records the current source/evidence and repair gate; subsequent candidate evidence supersedes that baseline only for the verified scope.
- Missing edited images do not block native domain work, but final visual acceptance is pending on those surfaces; do not invent the omitted design or present it as complete. Missing approved behavior or privacy/data semantics remain explicit. Detailed spacing refinement remains with the maintainer, not an unbounded acceptance loop.
- Browser extensions, system-browser overlays and transparent floating inspection windows are desktop-only for the current release. Do not request mobile visual references or tests for their nonexistent mobile counterparts.
