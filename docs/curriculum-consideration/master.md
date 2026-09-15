# mLearn — unified learning experience and curriculum consolidation (v2)

You are a fresh agent working in the user's local mLearn repository.

FIRST RESPONSE: inspect the relevant current implementation and produce a grounded design and phased implementation plan. STOP for approval before implementation. This is the complete intended programme, not authorization for one unbounded implementation run. Do not drop later requirements merely because the first slice is small.

Read AGENTS.md. Preserve the dirty tree and unrelated work. Do not reset, mass-restore HEAD, commit, push, publish packages, or mutate the user's live learner data. Historical screenshots/code establish UX references; the current accepted implementation determines the working contracts. Do not revert T2 to recover an older appearance.

NORTH STAR: the shortest useful path toward the learner's goals, including real language use—not the most reviews, the highest superficial percentage, or exam-only tricks. Consolidate ownership and workflows, not just the launcher. Extend existing systems rather than building another learning engine.

Requirements R01–R21 below must appear in your coverage matrix. G01–G06 are proposed gap-closure safeguards to include in the design and explicitly confirm; they are not permission to create unrelated subsystems.

## v2 decisions that supersede the earlier draft

- All supported learning languages remain first-class. German/CEFR, Japanese/JLPT and Chinese/HSK are first-class curriculum and acceptance targets now, not Japanese plus future adapters. German is the first large pilot, Japanese may have a smaller parallel pilot, Chinese follows. Pilot sequence does not postpone Chinese architectural/functional acceptance.
- Preserve the enjoyable action-card home and direct “continue where you left off.” Home/Practice/Immerse/Progress are proposed responsibilities, NOT a finalized sidebar or mandatory four-tab layout. Propose two restrained card-preserving arrangements before rollout.
- Preserve the existing ordered display-language × learning-language compatibility matrix. Do not build an English-only or Japanese-only path.
- Historical qualifications are dated background evidence for placement, not blanket current item-level Known claims.
- Ordinary dictionary hover must not demote Learning/Known. Reproduce and fix any real producer/replay/readiness regression rather than masking its display.
- Explanations must come from the actual calculation/decision trace. Auditable mathematics is not proof of empirical validity; never make heuristics look scientifically guaranteed.
- Current-media fit, domain vocabulary and existing live translation/scaffolds become explicit inputs to the existing policy, not another media scheduler or another knowledge store.
- Execute through bounded GLM implementation waves with separate Astra decision/review gates. See `mlearn_wave_workflow.md`. The master brief is a requirements reference, not an instruction to re-read every subsystem every turn.

## R01 — One learner-state and evidence contract

Locate and reuse the current canonical evidence/claims/familiarity → replay/materialization → effective-state path, including configured thresholds, contextual capability requirements, and the existing graph/prediction APIs.

Recent reports said lexical readers, graph explanations, and trajectories were unified but grammar curriculum classification still differed. Verify the current status. Finish only the demonstrated grammar/state-contract prerequisite before dependent work; do not assume reports or comments prove completion.

Same canonical target + same relevant context/settings/data revision must produce the same epistemic answer everywhere. A cached/materialized projection is valid, not a second authority. Unmeasured is not measured Unknown. Card presence, curriculum membership, ignore/exclusion, recency, and queue membership are policy/activity—not knowledge.

Preserve explicit-claim precedence without deleting underlying or contradictory evidence. Goal-readiness queries may inspect evidence provenance and performance requirements; they must not invent a competing mastery store.

A producer's name is not proof of measurement: actual Anki reviews, legacy snapshots, explanations, imitations, and passive encounters need their real semantics. Preserve outcome/source/task/method/assistance provenance. Predictions never write themselves back as observed knowledge.

Passive exposure can support familiarity and selection without being declared demonstrated mastery. Immersion-acquired ability must be demonstrable without requiring a memorized translation or explanation.

Do not rewrite retention math, ease values, history compression, claim/retraction rules, or threshold defaults for this project without a demonstrated contradiction and explicit approval.

## R02 — Consolidate sections by learner purpose

Proposed functional grouping (not a mandated navigation layout):
- Home: Continue practice, resume reading/video/conversations, a small truthful goal summary.
- Practice: recommended work, category drills, reviews, Sync knowledge, targeted output, checkpoints and mock tests.
- Immerse: direct Reader, Video and Conversations entry points.
- Progress: existing analytics, curriculum summaries and knowledge exploration.
- Global utilities: lookup/search, language switch, Settings.

Map old to new: Flashcards' review and management into Practice; Word Sync into Sync knowledge; Level Study's curriculum browser into Practice and summaries into Progress; Character Grid and Word Database into knowledge exploration, retaining dictionary editing secondarily; AI Tutor into the existing conversation experience; Statistics into Progress.

One curriculum browser/coverage implementation, one Inspector, one conversation implementation. Multiple entry links are fine. Do not duplicate implementations under new navigation.

Keep frequent actions directly accessible, including free conversation and mocks. Do not replace eight cards with three nested mazes. Preserve useful independent media windows, saved positions and resume paths; no forced Electron window-manager rewrite. Do not interrupt free immersion with mandatory exercises.

Use existing native/compact mLearn primitives. Reuse the recent Stats/Inspector work rather than redesigning it again. Home should not give Settings the same activity prominence as reading, or display an unsupported global readiness gauge.

The user LIKES the current fun home action cards, actual media thumbnails, card previews, tactile controls, quick actions and Continue Learning. Preserve that affordance. The problem is disconnected responsibilities and duplication, not the existence of action cards. Group/recombine them with clear hierarchy and shared destinations. Do not replace them with a sterile KPI dashboard, giant single Start button, or generic sidebar because it is easier to implement.

Show at most two representative arrangements using the existing visual language and obtain user approval before broadly changing navigation. Reader/Video/conversation may retain direct home entries even when grouped conceptually. A logical consolidation may reshuffle or replace subwindows without forcing every activity into a drawer. Keep state-preserving back/resume paths, predictable locations, deliberate transitions and immediate feedback; avoid drawer-inside-drawer interactions. Multiple visible entry points into one owner are not architectural duplication. “Continue” must actually resume the saved activity, not silently switch to a new policy-recommended exercise; offer recommended new work as a distinct action.

## R03 — Shared Practice, not card-owned learning

A target can need practice without a flashcard; a card can exist without deserving practice now. Preserve explicit card review/management, user-created content, Anki import/export and useful scheduling metadata.

The policy chooses an activity for a target/objective: introduction, example, retrieval, contrast question, reading/listening, conversation/output, or defer. Do not create a card for every word or impose permanent daily review obligations on secure knowledge.

Category → Practise must work without add-cards → switch-window → configure-another-queue ceremony. A word appearing in a card, curriculum and conversation remains one canonical target.

Practice, knowledge syncing and assessment are session intents over shared infrastructure, not independent learning systems. Scheduling computations and session cursors can remain specialized, but must not independently decide epistemic state or compete as extra teaching policies.

## R04 — Structured, package-defined curricula

Support many-to-many content categories, meaningful contrast sets, task objectives and prerequisite relations. Curriculum selects/groups existing targets and specifies required performances; it never owns knowledge.

Initial shared slices must exercise German/CEFR, Japanese/JLPT and Chinese/HSK with real representative content and non-English display-language pairs. German is the first large pilot; include the useful Japanese N2 mimetics/contrast use case alongside it, and a real HSK category/output case from the same contracts. Inventory existing content across all three, identify reliable sources and expose coverage gaps rather than promising exhaustive banks without data.

Vocabulary examples: mimetics/onomatopoeia, adverbs, connectives/discourse markers, set expressions, collocations, counters/quantities, formal/written vocabulary, near-synonym usage, verb/valency contrasts, word formation and loanwords.

Grammar examples: reasons/causes, contrast/concession, conditions, time, extent/degree, modality/judgment, register and formal constructions, with precise nearby constructions distinguished.

Task objectives include vocabulary reading/orthography/contextual meaning/paraphrase/usage; grammar selection, sentence composition and text grammar; reading and listening formats; useful speaking and writing. Verify assessment-specific formats against the relevant official reference when defining a blueprint.

NihongoJouzu's “drill by type” is a UX reference. Attached vocabulary/grammar HTML includes category routes/loading shells, not a verified export of complete banks. Do not invent extracted categories or copy site banks. The user also referenced https://www.jlpt.jp/samples/sampleindex.html for task-format inspiration, not for copying questions.

German/CEFR, Japanese/JLPT and Chinese/HSK require first-class content/runtime/UI/acceptance paths now. Other supported languages must not regress, and TOPIK or custom courses must fit the same package-defined structure. Non-exam dictionary/media use is fully valid. Do not invent an exam for Church Slavonic or require an exam goal. Separate architectural parity, supplied content coverage and pilot deployment dates. Do not build new school administration as part of this programme. See R19.

## R05 — Meaningful discrimination and sentence-level understanding

Knowing a dictionary gloss does not establish contextual usage, distinguishing constructions with similar translations, understanding a sentence, or producing language.

Use sparse curated confusion/contrast groups, not a new permanent capability for every pair, sentence, font or presentation. Target a precise construction/use, not just the token わけ or the broad label “reasons.”

Define relevant task conditions and alternative valid access routes. If the learner understands context without resolving the target expression, do not credit a distinction the task never tested. Conversely, task-defining context is not automatically disqualifying assistance.

Explanation delivered, example viewed, immediate imitation, successful fresh retrieval and spontaneous use are different observations. Recognize correct contextual intuition without demanding the learner recite a grammar rule in English.

All activities must respect the existing DISPLAY LANGUAGE × LEARNING LANGUAGE compatibility matrix (e.g. Japanese UI learning Russian; Spanish UI learning German). This is separate from the learner capability/rating matrix. Target identity, grading objectives and learner history are learning-language scoped; changing UI language does not create/reset/copy knowledge. Instruction/feedback/translation language and assistance can affect task difficulty and must retain provenance. Reuse pair availability and localization contracts rather than building a second registry. See R19 for pair testing and content validation.

## R06 — Correct character, surface and language applicability

Do not infer a character's curriculum level from occurrence in a level-labelled word, or broad character mastery from one known compound. Distinguish explicit curriculum character objectives from an exploratory occurrence grid. Display missing/provisional data honestly.

Keep canonical entry/sense/surface/pronunciation identities, directed “Recognize this spelling” and homophone/variant protections. Do not restore a universal legacy Written form status or fan evidence across dictionary siblings unjustifiably.

Language-specific relevance belongs in data/task definitions. For example, stress may matter to resolving a Russian surface; prosody must not be globally excluded from reading nor universally required for it. Do not make every capability mandatory for every curriculum objective. Missing language-pack data is unavailable information, not learner ignorance.

Handwriting recognition is a separate project; typed orthography/character tasks do not authorize implementing it here.

## R07 — Goal/deadline-sensitive ROI through the existing TeachingPolicy

Extend the existing policy; do not add an ROI scheduler, motivation scheduler, grammar scheduler or mock-mastery engine. Reuse its existing action vocabulary (such as defer/maintain/probe/teach if present) rather than wrapping it in a second decision-maker.

Choose useful actions under learner requests, goals and time constraints. Consider relevance, unresolved category bottlenecks, expected improvement, prerequisites/transfer, retention horizon, uncertainty/value of checking, available activities, time/effort and task-switching costs.

Existing ease is rule-based state, NOT a calibrated recall probability or learning-gain estimate. Start with explainable heuristics where estimates are unavailable. Do not wrap invented precision in a sophisticated formula.

Bob with N3 in three weeks should receive high-value consolidation and repair; with six months, allow more varied/spaced development. Both still avoid low-value perfectionism. Preserve broader communicative ability and useful prosody/output; an exam goal does not erase the rest of the language.

Prevent greedy easy-point farming, neglected skill bottlenecks and perpetual diagnostic questioning. Keep coherent short blocks where appropriate. Respect a deliberate “sync these words,” “drill mimetics,” or “just watch” request. Offer a short explanation of recommendations, not a control-room dashboard.

Current chosen media, topics and practical interests are goal relevance too, not merely exam membership. A term outside an exam list can receive high marginal value when it repeatedly blocks understanding of the user's selected content. Avoid unbounded repetition boosts or crediting every reoccurrence as an independent learning gain. Diminishing returns, local clustering, sense/phrase identity, uncertainty and explicit learner choice matter. See R21.

Every visible score and recommendation must have an executable explanation trace (R20). Never generate a plausible narrative after the decision that may not match it. Show the actual terms, sources/settings, version and limits on demand, without adding another decision-maker.

## R08 — Intensity and momentum without fake knowledge

Prefer a simple session-intensity control, separate from goal/deadline/time and session purpose. Gentle/steady/intensive is a proposed presentation; determine exact mapping in the plan. No perfectionism questionnaire or dozens of algorithm knobs.

Useful familiar/recently consolidated successes can act as momentum opportunities. For an intensive learner, keep padding low; for others, balance challenge and sustainable participation. Novelty, difficulty and effort are not identical.

This is a testable sequencing hypothesis, not a dopamine measurement or guaranteed learning mechanism. Do not infer emotions/diagnoses from a few pauses. Intensity changes selection, not evidence credibility, mastery thresholds or mock scoring.

## R09 — Fast baseline/placement for existing learners

Reuse imports, explicit background/self-assessment and adaptive, category-balanced diagnostic sampling. N2→N1 must not require individually rerating thousands of lower-level words.

Missing records mean uncertainty, not ignorance. Prior language/script literacy can guide what to sample, but cannot mass-certify Japanese readings/usage; ask actual background, not nationality. Check meaningful exceptions/false friends rather than every item.

Expand diagnostics around discovered gaps; stop when additional checks are unlikely to change recommendations. Policy may bypass likely-secure areas while individual untested targets remain unmeasured/predicted. Do not manufacture direct evidence from group sampling.

Word Sync remains optional, resumable and extremely fast for users who deliberately want 500 quick assessments. Store baseline self-report and measured results with honest provenance.

Implement a lightweight optional onboarding/returning-learner flow; Word Sync is not an onboarding flow by itself. Record an old school/exam result with its date, exam/provider or school source, skill scope, optional supplied scores, and subsequent use. A reported B2 achievement from a year ago is historical background, not “the user explicitly claims every B2 word Known now.” No certificate-to-thousands-of-claims expansion. Do not create permanent Strong-B2/Weak-B2 user classes.

Probe a small representative cross-section of categories/modalities using existing practice infrastructure; adjust where confidence or recent performance warrants it and stop when another activity is more useful. Accommodate both overconfidence and underconfidence without judging the user. Keep historical achievements intact, distinguish current readiness, and use fresh evidence without silently expiring or overriding unrelated explicit target-level claims. Sample-level inference can guide selection but does not certify unsampled words. Let the learner skip onboarding, start immediately and refine the baseline over use; no exam-pressure funnel for dictionary-only users.

## R10 — Assistance, noise and uncertain failure attribution

Preserve hover debounce. Pointer crossings, popup flickers and passive rendering are not automatic lookups, failure or mastery. Distinguish intent confidence from answer leakage: an accidental reveal may compromise unaided assessment without proving the word unknown.

Preserve adaptive reading/prosody scaffolds. Where actually presented cues fit existing familiarity/exposure recording, include them conservatively; merely rendering a color must not manufacture demonstrated knowledge or repeated evidence. Do not create a separate passive-prosody engine.

Record meaningful help used and what it supplied. A vocabulary gloss may not resolve sentence meaning; a peripheral lookup need not invalidate an independently tested grammar distinction.

Targeted grammar diagnostics should ordinarily control surrounding vocabulary; integrated reading practice can combine demands. An error does not make every word/grammar target/distractor unknown. Record task-level failure and uncertain attribution when that is all the evidence supports.

Use a simpler fresh follow-up or optional correction only when its diagnostic value warrants the interruption. Do not interrogate users after every failure. Explanation exposure and retry familiarity are not independent success.

A concrete reported regression is Learning → Unknown on ordinary Reader hover. Investigate early. With the target, time, settings and data fixed, opening/closing a normal dictionary/status popup must not itself create negative epistemic evidence or downgrade current knowledge. Check the event writer, target resolution, replay, readiness fallback and display subscriptions; do not fix by freezing colors while the journal still records false failure. Preserve legitimate changes caused by actual attempts, explicit claims or other genuine state updates.

Hover intent is ambiguous: the user may be checking identity/status/card ownership, reading a definition, preparing an explicit claim, or deciding to add a card. Debounce reduces accidents; it does not identify intent. Do not ask a reason questionnaire on every hover. Inspect/status lookup is not failure; card creation is policy; explicit pill cycling is an intentional claim; answer-bearing help inside an assessment is assistance, not automatically a wrong answer. Users must not have to avoid help or restore a claim simply to prevent punishment. Add no-demotion/no-negative-event interaction regressions across Reader, Video/OCR and similar consumers where applicable.

## R11 — Personal response time and automaticity

Use comparable personal task/modality baselines, robust to outliers and insufficient data. Account for input length, assistance, typing/IME/speech, and interface costs. Timing starts only when the prompt/media is ready.

Track known background/blur/loading interruptions. Exclude them from active-time accounting but flag interrupted latency as unsuitable for a clean automaticity estimate: subtraction does not prove attention. Inactivity alone cannot distinguish reading/thinking from leaving the computer.

Exclude chord waiting, rendering latency and post-answer rating mechanics from claims about retrieval speed. Repeated fast correct unaided answers may support automaticity; fast guessing is not mastery. Slow response/alt-tab must not silently convert an explicit Fluent rating to Struggled.

Treat timing as supportive, uncertain information for selection, not a competing classifier. Practice and timed mocks have different declared pause rules.

## R12 — Target-first generated question pipeline

Use existing AI infrastructure and batch/cache work away from the fast interaction path:
precise construction/use + situation/register + controlled vocabulary/difficulty
→ generate original context with the intended answer span
→ remove span
→ assemble plausible alternatives from a contrast bank using a reproducible seed
→ independently validate the COMPLETE assembled item
→ deliver and record through T2.

The initial generator need not see distractors or long negative instructions. “No other grammar” means avoid competing learning objectives, not ungrammatical language. The validator must see every alternative and assess independently of the proposed gold answer.

Check naturalness, objective alignment, legitimate answer(s), distractor rationale and accidental clues. A distractor must reveal a meaningful confusion, not exist merely to trick or punish. Reject ambiguous MCQs; typed answers need legitimate alternatives and appropriate normalization, not exact-string grading alone.

Offer MCQ, typing and appropriate speech formats by objective/preferences. Do not assume typing universally teaches better; record what IME/autocomplete or speech recognition supplied. Include passage/audio tasks where a blueprint requires them—not only cloze cards with new labels.

Version items, target references, seed, validation/provenance and grading rules. AI agreement is not proof; uncertain grading must abstain or allow correction. Invalidated items must support retracting/recomputing their assessment effects without deleting unrelated history.

Use original/licensed material. Generation does not automatically clear input-bank rights. Never claim a complete copyrighted question bank was extracted from a loading-shell attachment.

## R13 — Checkpoints and mock tests

Provide visible category checkpoints, section mocks and full blueprinted mocks where supported. These assess declared objectives, timing, modality and assistance—not general vocabulary coverage alone.

Practice may adapt and explain. A mock follows its fixed declared blueprint and does not slip in easier/momentum items after failures. Pause/help modifications must be explicit. Keep fresh item/scenario families separate from rehearsed material.

Review results by objective/category/contrast with provenance; choose repairs through the SAME TeachingPolicy. A correct MCQ is a successful attempt, not automatic proof of full objective mastery; repeated exposure to the same item and possible guessing limit what it establishes. No separate mock knowledge store, no blanket demotion of all options, no claimed equivalence to an official scaled score or guaranteed pass.

## R14 — Immersion and real output remain first-class

Preserve Reader/Video and existing characters, conversations, voice and free-form use. Targeted speaking/writing activities pass relevant objectives into that same agent experience. Do not create a separate practice chatbot.

Connect encountered expressions and current gaps to voluntary later practice/conversation using compact learner context, not a whole-database prompt. Correct independent production can supply evidence; explanations, repeats and supplied answers are not equivalent.

Handle ambiguous AI judgments and speech-transcription uncertainty conservatively. The learner can correct feedback. Do not let test preparation eliminate normal language use, prosody, register or communication.

Treat the existing live translator, subtitles, reading aids, prosody coloring, hover definitions and pause/replay as useful support mechanisms to integrate, not as obsolete experiments to delete. Preserve their direct user controls and compact feel. The user reports successful learning with these; regard learning-rate advantages as a hypothesis to evaluate, not a universal guarantee.

Distinguish unaided familiarity/coverage, available support, and any actually demonstrated comprehension. Assisted access must not be promoted to unaided mastery. Do not prohibit native content because a rough level/coverage estimate is low, or fade assistance solely because the app rendered it many times. Expose gentle optional “prepare useful expressions for this episode/chapter” and later practice when valuable. Keep free leisure uninterrupted. R21 defines the missing media-fit and contextual-relevance requirements.

## R15 — Preserve accepted fast UI/keyboard contracts

Word Sync/self-rated reviews: compact four-button row, Adjust unfolds the SAME control into the canonical shared matrix. Preserve actual accepted 1–4, doubled expanded 11/22/33/44, mnemonic/spatial chords, pending hints, Escape/reset/undo and submission guards. Do not reinterpret shortcuts from prose or randomly restore an older HEAD variant.

Explicit bulk fills the current declared unresolved set without overwriting individual drafts. Untouched rows fabricate nothing; preserve accepted partial-draft and auto-completion behavior. Easy remains the existing scheduler preference/evidence semantics.

Revealing reading/prosody does not hide their explicit self-assessment rows. The resulting observation's assistance/claim provenance must still be truthful; don't turn an assisted answer into unaided recall or silently discard an explicit assessment.

Normal dictionary hover: ONE compact quick-status pill with the approved click behavior. No always-visible four-button row, giant capability banners, matrix, or recursive duplicate knowledge popup. Do not invent a new status cycle or restore old status mutation.

Remove canned phrase catalogs as the primary adjustment UI. Preserve secondary Tell mLearn through the existing shared input/claim path. Scored questions should not demand redundant self-rating after every answer.

Use compact familiar mLearn primitives, accessible labels/contrast/focus, correct wrapping and sensible information hierarchy. Do not replace controls with giant capability dropdowns or expose a redundant Focus selector as required rating ceremony. Shared semantics do not require identical controls on every surface. Use the existing localization system for changed labels and task descriptions; test long labels and supported scripts instead of hard-coding Japanese/English UI assumptions.

## R16 — Honest progress and finite completion

Reuse canonical category/task aggregation and the existing Inspector. Distinguish coverage, explicit self-assessment, demonstrated performance, prediction, assistance, and uncertainty without a forest of new meters.

Show relevant capability/task gaps and weak categories; a high general-vocabulary average must not conceal poor mimetic usage. Define denominators and deduplicate overlapping category membership when computing totals. Different policy-filtered queues may differ; same-target state may not.

Completion is scoped to a versioned module/objective. Keep an earned completion milestone distinguishable from current maintenance/readiness; do not silently move the denominator or perpetually request microscopic perfection. Move on when higher-value work exists.

Do not claim exhaustive official-exam coverage, calibrated probabilities or official-score conversion without supporting data. Preserve truthful existing ease/history graphs, predictions separate from evidence, and one target Inspector rather than another curriculum timeline.

## R17 — Data/runtime integrity and bounded cost

Preserve target IDs, senses/surfaces, journals, imports, explicit claims, retractions, history compression, settings and session state. Package repairs/updates need reproducible identity-safe migrations, backups/audits and a release path—not only a locally patched asset. No ID reuse to turn old grammar labels into new senses.

Reuse existing readiness/loading, session and storage mechanisms. Pending data must not look like “all done.” Avoid per-token/per-hover whole-database scans, repeated large JSON parsing or eager mounting of every subsystem in a new shell.

Keep offline/local practice useful. Generation is optional infrastructure work with bounded batches/retries; no LLM call per rapid rating. Cost/cache details and degraded behavior must be designed rather than hidden behind optimistic buttons.

## R18 — Verification and delivery discipline

Plan staged end-to-end slices, not one quota-burning expedition or a navigation shell with fake features. Each stage needs changed ownership, migration/deletion scope, targeted tests, actual user-flow checks, a stop boundary and remaining requirements.

A meaningful early slice is category → existing policy selection → activity → canonical evidence → updated progress, reachable through consolidated navigation. Do not call the entire programme done when only this slice ships.

Verify real saved-data fixtures safely as well as synthetic edge cases; distinguish native-app verification from browser harnesses. Use representative large histories, normal/narrow windows, keyboard-only use, IME, restarts and interruptions. Passing counts do not establish visual quality or learning efficacy.

Delete replaced active duplicate owners only after their consumers migrate. Harmless forwarding routes and independent candidate producers are not duplicate schedulers. Do not consolidate by creating a giant monolith or a compatibility layer that preserves old semantics.

Use `mlearn_wave_workflow.md` for bounded implementation/review gates. Wave briefs cite requirement IDs, decisions, expected behavior, relevant owners and a stop boundary. Each writer works against a captured wave-start state including existing dirty/untracked work, not blindly against HEAD. Astra reviews an identified wave artifact plus code/fixtures/test output, not merely the implementer's summary. One writer at a time on overlapping files. Neither model grants global approval; the user approves visible interaction and pilot acceptance. Current-language scientific/content judgment may additionally need qualified human review; model agreement does not guarantee validity.

## R19 — First-class languages, exams and display-language pairs

All supported languages remain first-class as learning/dictionary languages. German/CEFR, Japanese/JLPT and Chinese/HSK are first-class curriculum/exam targets from initial contracts and acceptance, not Japanese-only implementations promised to generalize later. Pilot rollout: large German pilot first, possibly a small Japanese pilot alongside, then Chinese. Confirm the German pilot's actual school curriculum/level and intended provider before building full exam content.

CEFR is a common proficiency framework, not one German examination or universal word list. Keep language, framework/level, provider/blueprint, curriculum scope and version distinct in data, while presenting a simple user choice. Goethe, telc, ÖSD or school objectives must not be silently treated as interchangeable exams. Use verified current provider materials and language-specific references with provenance; reference access is not a license to redistribute banks. Pin the HSK syllabus/format version actually targeted; do not silently mix versions.

Provide honest support/coverage status. Equivalent architecture and UX do not mean pretending equal bank sizes or supported modalities when data/providers are missing. Preserve non-exam dictionary/media use without fake levels or mandatory onboarding.

Reuse the existing ordered display-language × learning-language matrix. Inspect exact direction/semantics in the repo rather than infer from arrow notation. Separate UI/instruction language, learning-language target identity and optional explanatory/translation language. For every supported pair validate routing/localization/fallback and prevent hardcoded English leakage; run deep semantic/rendering cases for representative pairs, including non-English UI learning German, Japanese UI learning Russian, Spanish UI learning German, and Chinese/Japanese target-language cases. Coverage and evidence in the target language must not reset merely on UI-language change. Translation/help wording may change task validity, so cache/version/validate it at the appropriate presentation level; do not assume translating a question preserves the answer logic. No identical tests copied into dozens of branches and no hidden new pair registry.

## R20 — Honest, executable explanations and trust

Replace unexplained numerical labels with a compact result plus accessible reasons and an optional calculation trace, using the existing Inspector/explanation surfaces instead of nested drawers. The user wants auditable reasoning, not reassuring mathematical theatre.

Distinguish: observations/counts; deterministic rule/model outputs; heuristics/estimates; and validated probabilities. An 8% graph support weight must not be called an 8% chance of remembering/seeing/understanding unless that interpretation is actually supported. Preserve the real underlying value and label; do not merely substitute reassuring prose. A mathematically reproducible formula does not establish empirical learning validity.

Have the actual classifier/policy/aggregation emit a bounded typed trace: inputs and target/scope, relevant evidence and timestamps, settings/thresholds/weights, intermediate contributions, exclusions, model/content version, uncertainty and final result. Include explanation of candidate selection and non-selection where valuable. Exact debug replay needs the same inputs/seed/settings; on-demand diagnostics should reuse the calculation rather than reimplement it.

Default UX: brief contextual explanation. Inline “Why?”: evidence/contributing factors. Optional single expanded details view: actual calculation and source provenance, including what is heuristic. Debug compare/what-if runs, when provided, use the same pure decision path and cannot mutate live knowledge. Avoid obligatory settings dashboards and verbose math on every card. No post-hoc LLM fabrication of reasons. Tests should establish trace/result agreement, correct totals/units and changes under settings/evidence revisions. Keep trace persistence/computation bounded.

## R21 — Media demand, personal fit and contextual learning value

The app reportedly estimates media level with weights such as N5=1, N4=2, N3=4, etc. Inspect and preserve it as an explicit versioned baseline while evaluating improved fit. These ordinal category weights are heuristics, not demonstrated equal learning distances, calibrated comprehension or a portable CEFR/HSK formula. Do not discard working support features merely because the baseline is crude.

Distinguish four questions: (1) what language demands does this content have, (2) how well-supported is this learner's relevant knowledge, (3) what support is active/available, and (4) what comprehension has actually been demonstrated? A percentage of known tokens is not a percentage of propositions understood. No universal content lockout threshold.

Use existing segmentation/dictionaries/graph/media metadata. Consider token-weighted and distinct-target coverage with explicit denominators; uncertain/unmeasured items; surface/sense/phrase/grammar identity; proper-name/unknown-word/OCR/ASR ambiguity; lexical difficulty and density/clusters; domain-central terms; speech rate/subtitles/audio and contextual support where data exist. Avoid pretending all missing predictors are measured. Cache by content/learner/settings revision; no per-token full-store recomputation or per-word LLM call.

For relevance, a term outside an exam list can matter greatly in chosen content: the user cites banking terms such as 粉飾 in 半沢直樹 and chemistry in Dr. Stone. Estimate local recurrence and plausible comprehension bottlenecks without exposing plot spoilers or declaring inferred centrality objective fact. Rare negation/connective/phrase distinctions may be important despite low frequency. Count marginal/diminishing benefit, not every occurrence independently; recalculating fit must not create extra evidence.

Feed these bounded candidates and relevant features to the existing TeachingPolicy alongside curriculum, retention and stated goals. No separate media scheduler, permanent mastery-per-show store or forced media curriculum. Respect selected media even when demanding. Offer optional short preparation, contextual glosses/live translation, suitable aid levels and later retrieval/output; native content can be approachable with support while independent mastery remains uncertain. Assistance fading is reversible and evidence-aware, not automatic punishment for looking things up.

Present low-friction guidance such as “dense specialist vocabulary; live glosses available; prepare these useful expressions,” with exact supporting counts when truly available and optional R20 details. Treat observed benefit from live translation as a hypothesis and distinguish supported comprehension from durable unaided retrieval when evaluating it. Do not assume leisure is cognitively easy or exam study is the sole source of useful learning.

## Proposed gap-closure safeguards — explicitly confirm in the plan

G01 SESSION/ATTEMPT INTEGRITY: stable session identity, cursor and suitable displayed denominator; no duplicate submissions, cross-window key handling or import double-credit. Evidence updates must not cause skipped/repeated items. Replan pending practice deliberately, not silently replace the question being answered. Resume interrupted work safely.

G02 ASSESSMENT CONTAMINATION: answer keys, knowledge coloring, furigana, pitch cues, audio, IME/autocomplete and hover help must follow the task's declared assistance rules. Do not expose the gold answer to the answering UI/prompt unnecessarily. Randomize choices reproducibly without invalidating distractors. Distinguish repeated-item familiarity from fresh generalization. Keep study aids outside assessment fully available.

G03 CONTENT LIFECYCLE: separate curriculum definitions, language assets and generated items, each with provenance/versioning. Handle target retirement/remapping, changing accepted answers and defective-item invalidation through canonical references. Never silently repurpose IDs or count one attempt multiple times because it supports several objectives.

G04 AVAILABILITY/USER CONTROL: specify behavior when candidate pools are empty, generated banks missing, AI unavailable, a session is interrupted or a goal/deadline changes. Fall back to real compatible activities, not fabricated mastery or blocked use. Preserve skips, bury/ignore policy, card management, pause/resume and user-selected scope as non-epistemic actions; these must not silently become failures or delete learner knowledge.

G05 PRIVACY/ACCESSIBILITY: minimal local-first task timing/help metadata, not raw mouse/key surveillance or monitoring other apps. Respect existing AI data/consent policies. No concentration/medical profiling. Account for IME/accessibility tools and ASR uncertainty; do not count input-device limitations as language errors.

G06 EVALUATION: acceptance includes selection behavior and credible evidence, not just UI/test counts. Compare fresh-task/delayed performance and learner time with an existing-policy baseline when evaluating new ROI/momentum heuristics. No manipulating displayed mastery or claiming optimality from completion/engagement alone. Research validation can be deferred explicitly; honest instrumentation cannot be replaced by invented numbers.

## Acceptance scenarios

1. Intensive user rapidly syncs 500 words with existing chords/matrix; revealed cues remain rateable and correctly attributed.
2. N2→N1 learner imports history, samples likely gaps and begins useful work without rerating all lower levels.
3. A learner with relevant Chinese literacy receives appropriately focused assessment without blanket Japanese mastery assumptions.
4. Mimetics/adverbs weakness remains visible despite high overall vocabulary coverage; category practice needs no card-creation detour.
5. The same Bob/knowledge state with a three-week versus six-month horizon gets explainably different allocations without abandoning useful communication.
6. A grammar error after a vocabulary lookup stays honestly attributed; a follow-up is optional/valuable, not compulsory after every item.
7. Accidental hover, alt-tab, idle reading and long pause do not silently become Unknown/Struggled or trustworthy fluency timing.
8. One real attempt affecting a word, category, card and conversation objective is represented consistently without duplicate credit.
9. An ambiguous generated question is rejected or later corrected, with its invalid evidence retractable.
10. A mock preserves its blueprint/help/timing rules and feeds the same T2 path; post-mock repair uses existing policy.
11. Ordinary chat/media remains directly accessible and uninterrupted; targeted output reuses the same agent experience.
12. Practice, Progress, curriculum and Inspector agree on state under the same target/context/settings; completion denominators remain explainable.
13. Offline/empty-pool/restart/goal-change paths remain usable, preserve progress, and do not manufacture results.
14. German/CEFR, Japanese/JLPT and Chinese/HSK each exercise the same real vertical slice, including representative output and non-English display-language paths; Chinese is not just an unused adapter.
15. A historical school B2 result from a year ago is preserved without mass-claiming current vocabulary. Sampling finds both underestimated strengths and stale gaps without compulsory full-bank rerating.
16. An isolated hover with unchanged target/settings/time/data leaves Learning/Known intact and writes no negative attempt; deliberate help in a mock records assistance separately.
17. Current-media domain vocabulary can outrank low-value exam-list work with a traceable reason; supplied translation improves access without falsely increasing unaided mastery.
18. Actual decision traces explain the result, including uncertain inputs, and debug replay matches it. No unsupported percentage claims.
19. Card-based Home and one-click media/conversation resume remain delightful, stable and low-friction after consolidation; the user accepts the rendered interaction, not just screenshots from the agent.
20. Dictionary-only use in a non-exam language remains possible without invented curriculum levels or forced setup.

## Your first deliverable — then STOP

Return:
1. Coverage matrix for every R/G ID: existing, partial, missing, conflicting, or deferred—with concrete file/symbol evidence and proposed disposition.
2. Navigation and old-section→new-home map; user paths for resume, drill, mock, sync, cards, conversation and inspection.
3. Existing owners reused; genuinely missing contracts/data; duplicate paths to remove. Do not invent replacements for functionality already present.
4. Explicit decisions/unknowns: actual content sources/coverage, goal/intensity defaults, completion rules, producer evidence semantics, timing limitations and AI validation availability.
5. Dependency-ordered stages covering ALL requirements, with a small first vertical slice, acceptance criteria, scope/effort estimate and stop point per stage. Deferred work retains IDs and reasons.
6. A wave handoff/review plan using the separate workflow brief, plus a visual approval checkpoint for the card-preserving home.
7. Only genuinely blocking questions not answerable from the repo, supplied reports, screenshots or this brief.

This prompt does not authorize a rewrite, silent scope reduction, cosmetic-only consolidation, new school/backend platform, Tauri migration, handwriting project, or another agent-world overhaul. Plan integration with existing capabilities. Wait for approval before changing code.

## Reference entry points for verification (not redistribution permission)

- CEFR can-do descriptors: https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors
- Language-specific reference level descriptions (including German): https://www.coe.int/en/web/common-european-framework-reference-languages/reference-level-descriptions
- Goethe B1 practice and vocabulary-list entry point: https://www.goethe.de/en/spr/prf/ueb/pb1.html
- Goethe B2 task-format/practice entry point: https://www.goethe.de/en/spr/prf/ueb/pb2.html
- HSK official syllabus entry point (verify version): https://www.chinesetest.cn/syllabus
- JLPT official samples: https://www.jlpt.jp/samples/sampleindex.html

Separate official descriptors/blueprints, mLearn-authored practice material and observed learner data. Missing source coverage is a documented gap, not permission to invent official claims.
