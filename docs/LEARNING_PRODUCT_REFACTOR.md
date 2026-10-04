# Bounded learning product refactor — 2026-10-04

Baseline: branch `refactor/minimize-tech-debt`, HEAD `7d64cb38dc2a1e91062a44448c0ba969f6289f62`. No tracked changes. Three existing untracked checkpoint documents are preserved and excluded from this commit. Existing Vite process serves port 3000; native verification will use an isolated copied profile and rebuilt Electron output, sequentially after build.

## Surface contracts

| Surface | Owner / truth | Action and continuity |
| --- | --- | --- |
| Home | `WelcomeRoute`, settings, canonical projections and `useLearningModel` | Saved Review/Word Sync/Grammar first; otherwise exact policy candidate; `openRecent` preserves Reader/Watch file handoff |
| Plan/selection | `LearningGoals`, `LearningPlanSettings`, installed `learning.outcomes`, `LevelStudyTab` | Same settings owner, package membership, grammar and word entry points |
| Practise/review | `FlashcardReview`, `StudyEncounter`, `RatingMatrix`, review session and study controller | Existing cue/reveal, unified aspect ratings, finite admission, retry and Undo |
| Grammar/contrast | `GrammarCoverage`, grammar decision owners, installed grammar/validators | Recall distinct from validated contrast; exact saved queue |
| Vocabulary/inspection | WordHover/Inspector, canonical knowledge/evidence projections | Deliberate lookup/corrections; no new state owner |
| Word Sync/Character Grid | Existing study sessions / installed writing capabilities | Calibration/reconciliation and orthographic inspection preserved |
| Reader/Watch/Messenger | Existing media/conversation owners and journal | Deliberate destinations preserved; no new navigation/model |
| Progress | Evidence-linked projections and existing stats | Evidence conditions retained; no readiness percentage |

## Plan before implementation

1. Fix legacy intent activation at shared selection/policy boundaries; preserve stored strings without guessing a package identity.
2. Resolve supported outcome subsets through loaded package groups; use the same target state and membership in Home and Plan.
3. Show actual offered/saved task content and preserve exact receiver contracts; stop preparation forecasts blocking activity start.
4. Repair lost canonical history/exposure inputs through existing mechanisms, retaining aspect-specific evidence and shared encounter components.
5. Focused regressions, both TS configurations, production build, then one native acceptance pass against copied history and normally loaded packages. Record unavailable content honestly.
6. One integrated self-check against the brief, one commit of this bounded work, then stop.

## Completion ledger

- Baseline/owner trace: recorded.
- Legacy requirement removal: complete. Free-text `examGoal` and unstructured `learningGoals` survive unchanged but are no longer active requirements. Package identity, never a title, activates a target.
- Installed target/subset agreement: complete. `learningScopeForSettings` resolves/deduplicates membership for Home, Plan and policy; stale/missing groups cannot broaden into another list. Home uses compact target controls; Plan edits that same state. Selected scope replaces competing legacy level filtering.
- Exact activity and media continuity: complete for the native paths below. Home names saved/offered material and sends the existing exact handoff. Preparation forecasts no longer gate starts. Deliberate Reader/Watch/Messenger/Vocabulary entry points remain.
- Canonical local decisions / unified lifecycle: complete within existing model capabilities. Retained addressed attempts condition the existing fit before transport truncation, including durable retractions. Compatible ordinary written targets share one admitted encounter; supplied targets remain excluded from unassisted recall. Normal Reveal still permits retrospective self-report. Reference consultation/exposed grammar replay uses existing Continue, without the recall matrix. Inspector corrections remain available. Existing staged/audio declarations and saved contracts remain intact.
- Grammar inspection/practice: the full scoped list remains inspection; repeated row-level Check buttons are replaced by an existing-policy practice entry over worthwhile work. Shared StudyEncounter/RatingMatrix are reused. Ordinary flashcard review no longer inherits an inferred 12-item stop; a Home batch continues at a durable release boundary, while explicitly bounded component sessions can finish.
- Integrated self-check: one pass over the repaired owners, followed by the affected final checks. No independent review campaign, model expansion, curriculum authoring or deployment.
- Commit: one scoped commit; original untracked checkpoint documents excluded. Stop at this boundary.

## Verification evidence

Final gates: both TS configurations (`npm run typecheck`), production build (`npm run build`), locale JSON validation and `git diff --check` pass. Latest results per file across the focused groups: **413 passed, 1 existing skipped, 0 failed in 18 test files**. Reports are `/tmp/mlearn-scope-evidence-final.json`, `/tmp/mlearn-lifecycle-final.json`, and `/tmp/mlearn-final-native-findings.json`. Controlled histories cover old evidence beyond the bounded tail/retraction, resolved and unavailable scopes, weak-aspect mixed composition, cue assistance, explicit corrections, atomic retry, frozen resume and batch continuation. Clean/no-target behavior is regression-covered; this native pass used copied returning data.

Native acceptance used an unsigned arm64 Electron 42.11.4 package at `/tmp/mlearn-product-release/mac-arm64/mLearn.app`, built after tests, with no concurrent build during interaction. Final runtime URL was the packaged `app.asar/dist/src/html/main.html`; the Vite process and real profile were left intact. Disposable copied profile: `/private/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/mlearn-acceptance-product-uzb3vxc_`. Logs: `/tmp/mlearn-product-build-final.log`, `/tmp/mlearn-product-package-final.log`, `/tmp/mlearn-product-native-final.log`.

- Returning Home omitted the arbitrary legacy title. Normal installed selection chose JLPT N2, then its authored-grammar subset; Plan contained 181 scoped constructions. The final rebuilt/restarted runtime retained the exact target/subset and saved activity.
- Plan's ordinary policy entry selected a nine-construction worthwhile pass instead of checking every known row. `てもいい` was hidden-answer first; Reveal showed the answer with normal ratings. Undo appended retraction `37dd99ca-68ac-4f0f-beac-bcce05b75191`. Replay and final restart resumed the same question 1/9, exposed answer, Continue/Skip, no recall matrix or contradictory comparison instruction.
- Current-level assessment first showed `郷里` without reading/meaning/prosody. Reveal then permitted normal retrospective ratings. Divergent Adjust produced one attempt (`688b27b1-4115-423d-a65c-27c992e5c3ff`) with meaning/reading/spelling fluent and prosody missed. Inspecting the next word before retrieval removed the recall matrix; Continue advanced without adding another recall response. Answer-side screenshots alone were not treated as premature disclosure.
- Installed German selection offered the actual causal/concessive set. Home launched exactly `deshalb`; normal hidden cue → Reveal → rating completed its finite one-construction pass and persisted recall attempt `f912982b-9bc7-4107-9ebf-f1320d8fab9e`, target `de:grammar:deshalb`, decision `a71527ca-4ee0-4bbc-9f08-2e84e89a66ff`. Home then offered `obwohl`; full binary restart retained that target and updated evidence.
- Reader opened an ephemeral EPUB containing six contexts taken verbatim from the installed German package through the normal file dialog. It tokenized the page, opened the existing Inspector for `heute`, returned to the same page, and resumed that exact book from Home. The journal gained 31 German passive rollups; these are exposure, not recall. The saved book also survived full restart. The copied profile had no pre-existing saved media, so this proves newly saved media continuity, not an unseen older book's position.
- Native returning review loaded its saved two-card queue after language/runtime restart. Audio/staged contracts, retry and more-work-than-batch continuation are covered by the existing component/mutation regressions. This pass did not exhaust a native queue of more than 12 eligible cards or demonstrate native audio/staged playback; those are verification limits, not claimed native results.

## Installed content and remaining gaps

**Content:** normal package loading used `ja-package-2026.10.04-learning-outcomes-r1` (230 grammar points; JLPT N5–N1 targets with Community vocabulary list and mLearn grammar material groups) and `de-package-2026.10.04-learning-outcomes-r1` (12 grammar points; Core 1,000 vocabulary and causal/concessive constructions). The German subset contains `weil`, `obwohl`, `deshalb`, `trotzdem`; six authored contexts exist for the first three. These are package/community preparation scopes, not official syllabus coverage. No onomatopoeia subgroup membership was found. German construction recall was usable; usable validated contrast was not established. Validation schemas/test fixtures do not count as delivered content, and unavailable contrast is not silently replaced with scored recall.

**Model:** this repairs retained addressed evidence and handoffs, without claiming a new exposure/claim fit, calibrated pass probability, official score prediction, or evaluation of requested outcome reliability. Dates/reliability and package limitations remain semantic data. Forecasting/calibration gaps stay outside this refactor.

**Deployment:** no cloud catalog publication, production release, signing/notarization or pilot readiness is claimed. Native package is an isolated acceptance build. Original learner data and the three unrelated checkpoint documents remain preserved.
