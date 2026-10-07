# Adaptive review checkpoint

Scope: one integrated slice through FlashcardReview: existing holistic matrix,
package-declared written + reading recall (Japanese stored pitch), and saved-audio
lexical recognition. Keep authored cards, scheduler, journal, attempt identity,
assistance recovery and undo. No second mastery store or history migration.

Approach: scheduler/policy admits the card; activity selection reads canonical
access status and recency for that material. A small package declaration maps
supported cue/answer presentations to open target IDs. Persist the chosen task
in the existing review cursor/decision. Preferences use Settings context.
Targeted prompts omit unrelated content and target only declared capabilities.
Saved audio must exist and finish successfully before answer/rating admission.
Audio cue admission is persisted before playback, preventing cold-recall claims
after changing mode or restarting.

Baseline: review currently chooses cards but always uses the same written task;
spoken recognition has canonical storage but no audio review interaction.
Audio resources are asynchronous and must not be treated as present optimistically.

Verification update (2026-10-03): both TS configurations and production build
pass. Review UI: 84 tests; affected renderer/shared checks: 162 tests; Electron
idempotency/history tests: 12 tests (one concurrent run hit a 5s timeout, isolated
rerun passed). Language-package checks: 26 tests. Full suite: 8,857 passed, eight failed; one review Undo expectation
was repaired and its full file rerun. Seven other failures reproduce in a HEAD
archive: four grammar-route controls, word-capture ownership, title coloring,
and conversation actions. No unrelated fixes included.

Native runtime: isolated APFS copy of the 451-card personal development profile
and installed language assets, leaving originals untouched. Normal Start review
opened written+reading recall for the saved 将来 answer, with no answer overlay
before reveal. Pitch diagram and pitch-only keyboard submission worked. SQLite
showed one rating plus one scheduler event for the logical attempt, requested
pitch only and supplied reading. Undo appended one retraction. Saved audio
recognition hid all written cues, required completed playback and submitted only
spoken-recognition. A real macOS Japanese recording served as the isolated audio
fixture; no automated grading or pronunciation claims. Corrupt audio produced an
explicit error and kept reveal disabled. Empty audio eligibility showed a useful
explanation. Preferences and logical command counts survived app restart.

Self-review (no independent reviewer): fixed reference-tool admission for the
actual targeted capabilities, and carried prior answer exposure when changing
activities. Regression tests demonstrated failures before each fix. Holistic
Undo semantics remain unchanged. Development HMR lost provider context while
source was changing; reopening a fresh window restored it. A multi-window cursor
conflict after restart/Undo used the existing explicit retry successfully; native
logs also reported stale whole-store saves. These recoverable cross-window storage conflicts remain a runtime limitation;
the slice preserves the existing write/retry path and does not repair it.
No duplicate logical evidence was observed.

Final controlled runtime: the real holistic Adjust matrix established strong
meaning/reading and weak prosody on 編集. With holistic and focused both eligible,
the next encounter selected pitch recall. Its submission then returned to
holistic review; Space reveal and keyboard bulk rating completed the finite
queue. Canonical consumers reflected the changed state. Final fresh audio-only
run after the cue-admission fix completed playback, reveal, keyboard submission
and Review Complete; SQLite contained one spoken-recognition rating and one
scheduler event with the same attempt ID and audio scaffolding.

Runtime artifacts: `/tmp/mlearn-adaptive-controlled-evidence.json`,
`/tmp/mlearn-adaptive-final-audio-evidence.json`, and
`/tmp/mlearn-adaptive-persisted-before-restart.json`. Original personal data was
untouched; only the isolated profile was exercised. Mobile behavior and website
catalog deployment were not verified/performed. Existing installed capability
metadata supports the tested flows without catalog deployment.

Status: bounded implementation complete, self-verified; no unresolved in-scope
verification remains. This does not establish whole-product readiness.
