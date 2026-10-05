# Coherent product refactor acceptance handoff

This is the current handoff for the broad M1–M4 goal. The earlier `docs/LEARNING_PRODUCT_REFACTOR.md` is historical. This document does not claim whole-product or pilot readiness. Chronological evidence, failed intermediate attempts and scoped commits are in [LEDGER.md](LEDGER.md).

## Surface and ownership map

| Job | Main-shell destination | Existing authority |
|---|---|---|
| Read / Watch | `/reader`, `/video` | Existing media owners, source locator and saved position |
| Converse | `/messenger`, contextual `/messenger/memory` | ConversationContent; existing provider, consent and history owners |
| Practise | `/practise`, `/practise/words`, `/practise/grammar` | ReviewWorkspace/FlashcardReview, WordStudyWorkspace, GrammarCoverage |
| Evaluate | `/evaluate`, words, grammar self-check, grammar mock subroutes | Separate self-report/check namespaces and existing fixed mock owner |
| Plan | `/plan` | Passive installed requirements/coverage; Settings updates own explicit target changes |
| Knowledge / material | `/knowledge`, material and characters subroutes | Existing dictionary/Inspector, FlashcardsContent and CharacterGridContent |
| Progress | `/progress` | StatisticsContent/Dashboard; language/target and All activity remain distinct |
| Settings / recovery | `/settings` | Existing desktop/mobile Settings, library guardian and runtime restart guards |

Desktop and mobile share ApplicationShell/ApplicationRoutes and one provider wrapper. LearningWorkspace owns foreground shortcut dispatch; real RatingMatrix/task components and canonical evidence writers remain. Open prepares, Start admits a new task, Resume activates an exact saved identity, Inspect is read-only, and Return restores the owning origin. Stored pending attempts and transaction guards prevent silent replacement.

## Removed and retained paths

Removed ordinary standalone HTML/build/index hosts for flashcards, settings, statistics, word-db-editor, character-grid, conversation-agent, word-sync, level-study and memory-browser; the static connect-qr placeholder; old embedded Plan task dispatch; FlashcardsContent direct Review/native-ingress fallback; unused FlashcardStats and automatic continueAfterBatch; dormant mobile Flashcards and six other route re-exports. Caller and data-obligation traces precede these deletions in the ledger. No learner store was deleted. Structured package requirements replace the old arbitrary goal/budget runtime; unsupported stored identities remain preserved.

Retained old navigation aliases resolve through the shared destination owner rather than a second application. Native setup/recovery, overlay/PiP, external definition, plugin isolation, graph detail, diagnostics and legal hosts retain their justified boundaries. The live mobile LicensesRoute remains. Management remains a separate role-scoped product.

## Finite journey evidence

“Native + regression” means matching production builds with copied returning data plus source regressions. It does not imply all platforms or missing content were exercised. All native packages were normally loaded; synthetic future-package fixtures are regression evidence only.

| Journey | Evidence and remaining limit |
|---|---|
| J01 clean launch / material | Returning missing Watch source and explicit retry verified natively. Clean loader reaches Welcome/EULA; acceptance confirmation pending, so clean post-setup journey remains unverified. |
| J02 returning Home | Native stable five activity cards, real recents and distinct exact Resume entries. |
| J03 paused grammar / chosen Review | Native explicit Review Start with grammar preserved and separately resumable. |
| J04 Evaluate | Native self-check writes canonical self-report with target unchanged; separate purpose/storage and regressions. |
| J05 scoped Plan practice / Return | Native per-level selection/Return; final review adds exact cross-level queue/restart and changed-target Resume regressions. Matching final-source native old-record Resume/exposure/Return passes; live structured-group cases remain unavailable. |
| J06 grammar/mock/repair | Native honest unsupported checkpoint state. Fixed mock drafts/results/repair/Return tested through real components; installed Japanese/German have no checkpoint sources, so native completed mock is unavailable. |
| J07 mixed retrieval | Native divergent four-aspect Adjust produces four rows in one attempt and advances once. |
| J08 input parity | Native Space/chord/modal/popover boundaries; regressions cover IME, repeat, focus and repeated owner disposal. |
| J09 elicitation/correction | Native original correction, exposed replay, supplied access and restart; canonical guards retained. |
| J10 Undo/rerate | Native exact retraction/replacement and distinct next item; bookkeeping-only supplied response does not cause accidental readmission. |
| J11 failed write/retry | Real copied SQLite lock, failed navigation/write, restart, same pending ID and one retry commit; safe Quit refuses during unresolved write. |
| J12 suspend/switch/resume | Native independent Review, Word, grammar practice and self-check restart; mock drafts/results regressions. |
| J13 continuous | Native 15 reports beyond former 12 boundary; no forced finish or growing finite label. |
| J14 finite | Native 35-item completion with 34 reports plus one evidence-free Skip, remaining eligible work and new finite boundary. |
| J15 media handoff | Native Reader exact anchor, Watch position/external subtitle, provided-access provenance, Messenger cancellation/Return and PiP. |
| J16 Knowledge/material | Native real history, distinct aspect knowledge, save/edit provenance. Irreversible test-card deletion confirmation pending; ignored-suggestion native subcase remains unverified. |
| J17 language/target | Native normally installed Japanese/German with independent English UI and unchanged targets; stale-owner/unknown-package regressions. Changed-target exact Resume passes regressions; real package has no structured outcome groups for that native subcase. |
| J18 Messenger/provider | Native saved conversation readable offline; real existing-registry local model recovery reaches Connected. Call notice remains unaccepted; no generated quality claim. |
| J19 boundaries/mobile | Native aliases/diagnostics/PiP; shared mobile source/build and lifecycle regressions. Capacitor device runtime unavailable (`simctl` missing); live extension installation/external lookup not fully exercised. |
| J20 content limits | Normal-loader Japanese/German missing question/category capabilities are shown honestly; no fabricated bank or validation. |
| J21 layout | Native compact/large windows, long content, mixed Adjust and anchored keyboard-dismissed popover. |
| J22 Progress | Native German target denominator agrees with Plan; Japanese and All activity remain explicitly distinct. |
| J23 recovery/managed | Native damaged-copy guardian recovery and reachable Settings. Managed/plugin auth/cleanup/privacy regressions pass; no signed-in group or installed plugin available for live verification. |
| J24 retirement/gates | Caller removals, both TS configurations, desktop/postbuild/mobile builds and integration gates recorded. Final-source gates and native compatibility recheck are recorded below. |

Rating trace samples: baseline 85.4 ms, later regular rating 82.6 ms and correction 70.4 ms, each a single sample. These establish observation, not a speedup. Comparable route/start/reveal baseline timing remains missing; no performance completion claim.

## One integrated review

The one fresh read-only review covers actual baseline `cd5a1099867697d94bf065ea79d536ec6c328ec9` through `00b9b20e`. It found no critical issue and three important grammar scope issues: cross-level truncation, invalid explicit selection falling back to generic work, and target-filtered Resume hiding a valid saved task. No second integrated review will be commissioned.

Fixes retain the full requested installed construction set, immutable queue/provenance and per-construction level; refuse malformed/stale selections with localized recovery; retain request scope after acknowledgement; and resolve exact Resume against installed content independently of the current target. Cross-level practice uses the existing honest recall/self-assessment owner, not scored contrast claims. Tests cover exact queue/restart and canonical per-item level, invalid/mixed selections and wrong handoffs, and words-only/different-grammar target Resume with unchanged durable records and no new reports.

## Current validation and dependencies

- Before review fixes: 593 files / 9194 passing tests, 23 existing skips, both TS configurations and desktop/postbuild/mobile builds.
- Review fixes: 109 focused tests pass; both TS configurations and desktop/postbuild/mobile builds pass; all six locale JSONs parse. Full integration passes 593 files / 9201 tests, with 23 existing skips, in `/tmp/mlearn-final-review-grammar-integration.log` with native/build closed and two workers.
- Red proof: `/tmp/mlearn-final-review-grammar-all-red.log` plus corrected-assertion baseline reproduction `/tmp/mlearn-final-review-corrected-scope-red.log`. First green run exposed two assertion mistakes; corrected tests still fail against original source, and final focused run passes. No guard or timeout was weakened.
- Final-source matching native Home Resume -> Pause -> Back -> Resume restores the old exposed ます cue at 1/40 twice; normal Quit exits zero. All 40 journal hashes and canonical maximum 605287 remain unchanged, as do language/target settings. Logs and read-only metadata: `/tmp/mlearn-final-review-grammar-runtime.log`, `/tmp/mlearn-final-review-grammar-native-after.json`. The WAL-only reader found no rewritten record; full old queue equality is not claimed from that reader.

The original profile and corpus were only read. Native writes belong to the named isolated returning copy; controlled locks are released and copied media restored. The clean profile is paused at the actual legal acceptance step. Pending confirmations were already requested; they are not inferred from elapsed time or the goal file's blanket pre-authorization. No cloud deployment, new learning model, forecasting/calibration system, content authoring/catalog update or pilot certification is part of this handoff.
