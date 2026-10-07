# Goal → Home → encounter checkpoint

Contract: `/Users/adrian/.codex/attachments/1b36149c-863f-4cec-94a3-279d2f5a3d8a/goal-objective.md`, all six outcomes. Existing adaptive review checkpoint is preserved.

Owners: SettingsContext persists constraints and cross-window sync; learning/engine and TeachingPolicy own selection; FlashcardContext and the journal own knowledge, scheduling, attempt identity and Undo; studySessionController and review presentations own interruption; WelcomeRoute owns Home; StudyEncounter and RatingMatrix own the shared interaction.

Implementation sequence:
- Add editable, language-scoped outcome commitments with optional deadline, priority, status and sourced scope. Carry legacy exam settings forward without erasing them. Keep goals out of learner mastery.
- Put purpose, time and Start/Resume on Home; hand directly to existing sessions. Preserve interrupted intentional work. Bound new work using available time and show uncertainty rather than forecasts.
- Feed goal scope/priority through existing TeachingPolicy; combine overlaps without duplicate candidate work. Keep unknown performance distinct from weakness, and preserve mock conditions.
- Compose compatible targets within encounters; stage acyclic cue dependencies and separate contamination cycles. Use the shared card/rating grammar for existing review families. Anchor Review activities in a popover and pin preferences until the next encounter.
- Freeze finite session membership, preserve progress/Undo/restart and canonical evidence, and show a brief result that changes the next action.
- Verify focused regressions, both tsconfigs and production build; inspect running UI and before/after persisted state using an isolated representative profile. One separate self-review after integration, then fix concrete findings and reverify.

Design boundaries: open package capability IDs; no linguistic registry; no LLM required for ordinary setup; no invented syllabus/pass probability; preserve meaningful history and unrelated work. Deadlines do not mark goals complete. Estimate session size as an explicit work budget, not calibrated learning time.

Status: implemented; final native runtime checks recorded below. The independent read-only integration review has been completed and its concrete findings addressed. No additional design or review tranche was started.

Final-tree checks:
- FlashcardContext: 381 provider tests passed, including atomic Undo, staged cue provenance, admission, retries and canonical projections.
- FlashcardReview plus capabilityProjection: 94 tests passed; after the last Review More batching fix, all 91 Review tests passed again.
- Encounter composition and knowledgeEvents: 17 tests passed.
- Goals, preparation, Home/resume, finite review, activity eligibility, RatingMatrix and StudyEncounter: 52 tests passed across eight files.
- Both TypeScript configurations, production build, locale JSON parsing and `git diff --check` passed after the final change.

Native runtime used an isolated profile with 453 cards and approximately 587,517 existing journal rows. Personal development data was not used or overwritten. Two synthetic cards and package-declared staged activities were added only to that profile; existing history and real audio assets were retained.

Observed journey and state:
- Home created and persisted “Read a mystery novel” without an LLM or placement flow. Restart restored the goal and available time. Home opens the existing workspaces directly, preserving navigation, counters, audio controls and RatingMatrix.
- Actual selection tests show scope, priority, deadline and pausing change shared preparation and overlapping goals produce one candidate. Unknown evidence remains unmeasured. No independent goal mastery store or scheduler was introduced.
- Compatible reading/pattern targets were retrieved in two valid stages inside one encounter and one rating interaction. Closing/reopening restored the admitted stage. Adjust submitted divergent ratings once. Two target observations and one scheduling event shared a single attempt identity; earlier unaided retrieval did not inherit later cues.
- Completing two-card and one-card finite review sessions stopped at the boundary. Home no longer calls future relearning cards due immediately. Returning Home preserved intentional practice.
- Changing available time from 5 to 10 minutes preserved an interrupted practice at 1/10. It completed at exactly 10; newly prepared work started at 0/20. Completion changed Home totals from 5,640 known / 888 developing to 5,649 / 879, rather than merely changing copy. Closing the new 20-item work left Resume on Home.
- Final Undo replay completed without a cursor error. Original attempt sequence 13 had two target observations and one scheduling event. After retraction, replay sequence 14 had one scheduling event and zero unassisted target observations, with prior cue exposure recorded. Pending commands: zero. Evidence: `/tmp/mlearn-goal-final-undo-evidence.json`.

Failure diagnosis:
- The initial visible save failure was a product defect: renderer hydration added a derived retention cache that the writer treated as an authored-card edit. The guard now ignores only that cache while preserving content/scheduling checks.
- A subsequent intentional negative test placed an empty directory at the isolated atomic-write temporary path. The UI showed Saving, then an explicit retry failure, withheld completion and retained the admitted command. Removing the obstacle and one Try Again committed the same attempt once; persistent progress reached 2/2 and pending commands returned to zero. Evidence: `/tmp/mlearn-goal-failure-evidence.json`.
- Runtime Undo exposed a provenance defect: earlier captured stage flags could erase replay exposure. The canonical boundary now carries answer exposure through every stage and refuses unassisted observations on that replay.
- Separately updated Undo/Review More state could issue competing cursor writes. Both transitions now publish one batched choice. Undo and Review More were both repeated successfully in the final running app.

Limits: a newly added package activity declaration was installed directly into the isolated fixture; the public language catalog has not been regenerated or deployed. Mobile and cloud deployment were not exercised. Vite HMR during component edits can leave provider state stale; fresh native windows/restarts were used for runtime verification. Available time supplies an explicit encounter budget, not a calibrated duration or pass forecast. The existing adaptive checkpoint is retained as earlier audio/holistic evidence, not presented as final-tree verification.


Final audio and failure repetition:
- With an existing saved recording and package-declared audio activity, Review More started a clean 0/1 session without a cursor error. The question contained the recording control and concise retrieval cue; written form/reading/meaning appeared only after reveal. The familiar four-grade RatingMatrix checked spoken recognition alone. Sequence 15 persisted one spoken-recognition observation and one scheduling event, with audio/provided-access conditions and no other aspect observations. Evidence: `/tmp/mlearn-goal-final-audio-evidence.json`. Playback control was exercised; acoustic quality was not independently assessed.
- On the final tree, Undo restored the audio encounter and carried prior exposure. The controlled temporary-path obstacle caused sequence 16 to remain pending while durable completion stayed 0/1. The visible UI withheld Review Complete and offered Try Again. After removing the empty obstacle, one retry committed the same sequence/attempt at revision 2465, completion became 1/1, and pending commands became zero. Its single scheduling event retained exposure; there were no unassisted observation rows. Evidence: `/tmp/mlearn-goal-final-failure-evidence.json`.
- Background whole-store writes logged two stale-revision conflicts during this multi-window run. The writer rejected stale data; the foreground canonical commands and persisted progress succeeded. No loss was observed, but the general background whole-store contention was not reworked in this scoped change.

The coherent implementation is finished against the original contract. This checkpoint does not claim the entire product is shippable, catalog deployment, mobile validation, calibrated learning duration, or independent acoustic validation.
