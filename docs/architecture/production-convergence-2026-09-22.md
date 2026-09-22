# Production architecture convergence — 22 September 2026

## 1. Verdict

**BLOCKED for a release that includes school-managed tutoring.** The desktop sends system-role prompts, while management deliberately rejects client system roles and installs an administrator-owned prompt profile. Accepting `usage_scope` repairs one real API mismatch, but does not repair this policy conflict. Management and desktop also disagree about allowed setting names; affected policies cannot be consumed reliably. Resolve the task/prompt contract and registry migration before claiming school compatibility.

The bounded persistence, local runtime, renderer lifetime and local-server defects discovered in this pass have been fixed and regression-tested. This is a risk-driven architecture review of the available checkout, not a claim that every line or every platform was manually exercised. The separate cloud website/worker checkout was unavailable, and no deployed service was changed. Complete open-world task extensibility remains explicitly unfinished; current-language support and opaque data preservation must not be marketed as that stronger guarantee.

## 2. Codebase census

Initial census counted physical lines including comments/blanks in tracked and nonignored text. Test/fixture files were separated where identifiable; Rust inline tests remain in the Rust figure. Minified/data files make LOC an imperfect size measure.

| Area | Approximate lines | Files |
|---|---:|---:|
| Renderer | 132,395 | 722 |
| Electron | 27,717 | 81 |
| Shared TypeScript | 23,081 | 94 |
| Python runtime | 7,616 | 17 |
| Management Rust, including inline tests | 35,680 | 94 |
| Management UI | 6,106 | 69 |
| Separate tests/fixtures | 151,804 | 518 |
| Language packaging/data | 51,389 | 47 |
| Localization | 22,962 | 6 |
| Lockfiles | 18,135 | 3 |
| Browser extension | 5,746 | 19 |
| Example plugins | 3,187 | 15 |
| Other configuration, tooling, documents and assets | about 8,000 | — |

**Does approximately 250k LOC make architectural sense? Yes, as a rough application-source figure, with qualifications.** The six main runtime buckets total about 233k before extension/examples and miscellaneous source; inline Rust tests inflate that total. The whole text checkout is closer to 494k. This is several products: desktop learning/media UI, conversation/world simulation, local NLP/runtime installation, mobile bridges, extension, and a separately administered school backend/UI. Language sources, six translations and substantial tests explain much of the rest. Android/iOS native projects were absent here; there is no hidden Tauri application in this checkout.

Size alone does not justify deletion. Concentration is more concerning: FlashcardContext was about 4,457 lines, ReaderRoute 3,216, shared types 3,055, capacitorBridge 2,201 and languageFeatures 2,193. These combine orchestration with domain semantics. Management quota's approximately 3,746 lines include substantial tests. Neither these totals nor the large renderer bundle imply that all of that code is redundant.

## 3. Major hidden findings

- Corrupt/inaccessible world data could be interpreted as a new empty world and overwritten. The journal similarly conflated absence with failed reads and could truncate committed corruption as if it were an interrupted final append.
- A stream's terminal UI event did not mean its native provider resources were disposed. Releasing the router at the former boundary let a subsequent request overlap the latter. Ollama also lacked a reliable awaitable dispatch lifetime.
- Anki grammar imports looked up prior evidence only for word keys, so repeating the same import could append the same grammar evidence again.
- Surface-scoped package capabilities were correctly understood by some readers but not by rating/claim/clear writers: those writers omitted the language metadata and spread evidence to related forms.
- World/model lifecycle correctness was obscured by a build that retained emitted JavaScript after source deletion. Real stale service files existed in `dist-electron`.
- Mobile's always-mounted diagnostic console exposed a mock-data button that replaced the real card store and injected fabricated evidence.
- Management's request schema rejected a field emitted by the real desktop adapter. Its recording deadline also used configuration retention rather than the stricter compiled policy deadline.
- A late cloud refresh could restore credentials after logout, or a late unauthorized result could clear a newer login.
- Local extension/Anki/WS routes trusted requests too broadly. Local binding alone does not establish browser-origin trust. Settings responses exposed more than each caller needed.
- Real packaged use revealed conversation/compaction prompts and NLP lookup text in ordinary logs despite developer mode being disabled; equivalent provider code had already gated its logging. Both leaks are now removed from ordinary logging.
- Existing language-provider tests were partly not being run: the command used unittest discovery against pytest-style tests. Once executed properly, stale fixture assumptions and a test writing into real package source became visible.

## 4. Divergences found

| Implementations/boundary | Real divergence? | Resolution and owner |
|---|---|---|
| Router terminal event vs builtin/Ollama dispatch cleanup | Yes: admission before provider settlement | Router owns queue/active request until both terminal state and dispatch settlement; each provider owns its awaited resources |
| Model selection/status vs loaded model cache | Yes: loaded identity/lifecycle could disagree | Builtin service serializes load/generate/unload/delete and retains exact loaded path until disposal succeeds |
| Package capability reader vs FlashcardContext writers | Yes: metadata omitted at writer | Shared scope interpretation receives the same installed language metadata on all four write paths |
| Native evidence vs imported Anki grammar evidence | Yes: incomplete deduplication lookup | Import adapter looks up actual word and grammar targets; canonical knowledge event writer remains unchanged |
| World/journal missing-file vs corrupt-file handling | Yes: failed reads became empty state | Main persistence services distinguish ENOENT from corruption/I/O failure; initialization reports failure and exits |
| Reader OCR work vs active document; media stats request vs active media | Yes: late work could mutate another selection | Route-owned OCR generation and hook-owned media generation fence all writes; old subscriptions are removed |
| Cloud refresh operation vs current account | Yes: operation outlived its authority | Session manager ties refresh to generation, endpoint, user and credentials, including group-readiness waits |
| Rust gateway DTO vs CloudLLMAdapter | Yes: usage_scope rejected | Explicit optional enum plus shared JSON fixture exercised through the real application router |
| Management configuration vs policy retention | Yes: policy limit ignored for recording | Resolved route carries compiled policy retention; recorder uses the minimum of config and policy from the quota-verified snapshot |
| Rust policy registry vs TS policy registry | Yes, still unresolved | Requires one versioned/shared registry and deliberate legacy-key migration, not stripping rejected keys |
| Desktop system prompts vs management prompt profiles | Yes, still unresolved | Requires an explicit school task/context contract; do not silently weaken managed prompt authority |
| Extension, desktop renderer and paired mobile credentials | Different trust classes, previously collapsed | Shared server guard; narrow main-frame Anki credential injection; renderer pairing accessor scoped to the paired origin |
| Electron/Capacitor bridges and Python HTTP/cloud adapters | Intentional platform/provider separation | Retained: shared interfaces do not imply identical transport or local filesystem authority |
| Knowledge journal, projections, SRS schedule and media statistics | Related but distinct | Retained: observations, inferred knowledge, review timing and per-media sessions are different concepts |

Representative end-to-end traces:

- **Rate:** study UI → FlashcardContext attempt/target semantics → SRS answer/retention calculation and knowledge-event append → main history persistence → capability/graph projection → renderer refresh. The writer metadata fix repairs scope; optimistic materialized updates versus durable append remain the transaction debt below.
- **Exposure:** Reader text/OCR or video subtitles → common tokenizer/package word-form identity → dictionary/knowledge lookup → trackWordSeen → throttled knowledgeRollup → shared evidence/projection. OCR and media selection lifetime are local owners; media-session statistics do not redefine lexical knowledge.
- **Anki:** parser/review normalization → exact word/grammar target identification → prior review-ID query → canonical imported evidence → projection and study state. External scheduling remains an adapter boundary.
- **Local AI:** settings/model identity → packaged readiness/runtime resolution → router admission → provider context/session → terminal chunks → journal-backed conversation → awaited native cleanup → next admission.
- **School:** login/group → compiled policy and route → session-bound cloud adapter → management auth/quota validation → provider → recording under effective retention. Prompt roles and policy setting names are the documented unresolved boundaries.

## 5. Code removed / architecture collapsed

Deleted the 620-line mockStatsData module and its sole production control/import. This removes an actual route for fabricating learner state, not merely a development dependency. The diagnostic console itself remains.

Replaced module-global Reader OCR lifetime with a per-route owner. Removed the router's premature release path, swallowed persistence failures, incomplete import deduplication and duplicated pairing-token reads. Build/dev now remove only owned compiled Electron/shared output before emission; runtime environments and user-like data under `dist-electron` are preserved. Production packaging excludes emitted application test/typecheck files.

The starting working tree already deleted legacy localStorage migration source/tests and contained extensive acceptance changes. Those deletions are **not credited to this pass**. This pass prevents their previously emitted JavaScript from surviving into a package. No dependency was removed merely because a textual import search missed native/plugin/peer usage.

## 6. Production defects fixed

| Problem → cause → change | Proof |
|---|---|
| World overwrite after corrupt/unreadable load → broad empty fallback → reject malformed JSON/envelopes and non-ENOENT I/O; retain unknown fields; await initialization recovery and show a native failure dialog | Real-filesystem world regressions, startup failure and world IPC/integration coverage |
| Journal loss/false-empty reads → broad recovery and cached failed head → only malformed unterminated tail is recoverable; committed corruption/invalid sequences reject; failed reads never cache empty | 13 journal tests, including three new red-to-green boundaries |
| Reimported grammar evidence → word-only history lookup → query exact grammar targets too | Repeat import changes from duplicate import to zero; 21 import tests |
| Surface evidence leaking across forms → missing package metadata → pass metadata at rating/claim/clear boundaries | Four synthetic-capability writer regressions; 241 FlashcardContext tests at targeted verification |
| Next native request overlaps cleanup → terminal-driven release → wait for provider settlement, serialize native lifecycle and fence late chunks | Router/Ollama and 39 builtin tests; real packaged check recorded below |
| Stale OCR/media results → lifetime shared across selections → route/hook generations, reset/disposal invalidation and current identity checks | OCR lifetime and media A→B→A/disposal regressions; OCR tests cover owner boundaries rather than pretending to be a full mounted Reader smoke |
| Late refresh mutates another session → refresh authority not versioned → generation/identity checks and abort | 24 cloud session tests, including logout, account switch and readiness wait cases |
| Desktop request rejected before school inference → missing usage_scope field → validated optional foreground/internal enum | Shared desktop fixture, CloudLLMAdapter tests and real Rust application-router e2e; unknown scopes still reject |
| Record retained beyond school policy → configuration used alone → min(policy, configuration) from same resolved snapshot | E2e exercises 1-day versus 90-day policies both ways; does not retroactively rewrite existing deadlines |
| Untrusted local browser routes/WS and secret-bearing settings → broad route trust → validate socket/Host/Origin or paired token, restrict settings projections, no-store token response | 60 web-server tests including real HTTP and WS upgrades; renderer credential gating and paired mobile header rotation/removal tests |
| Mobile Anki regression found during review → new server gate without existing paired token at HttpBackend → single scoped pairing accessor and cache re-evaluation | 175 backend/Capacitor tests; explicit empty overrides preserved; cross-origin token inference denied |
| Deleted source shipped as live JS → tsc does not clean output → ownership-scoped prebuild cleanup and packaging exclusions | Four build tests, including actual tsc deletion and builder matchers; final archive inspected |
| Sensitive prompts/history/NLP text in ordinary logs → inconsistent logging gates → conversation/compaction dumps require devMode; Python NLP logs counts only | Four actual-logger renderer regressions, two Python caplog regressions, and rebuilt packaged log inspection |
| Language tests skipped or mutated production sources → wrong runner and ROOT fixture → pytest runner, temporary package root, updated expanded-vocabulary fixture bounds | 25 Node language-package tests and 26 Python provider tests |

## 7. Architecture intentionally left alone

The shipped-data `legacyMigration` path is retained. History and reachability distinguish a real upgrade obligation from the obsolete emitted source found in the build; deleting all files named “migration” would strand users.

Graph projections, journal history, materialized cards and schedule state are not collapsed into one mutable object. They have different durability and query responsibilities. The large FlashcardContext remains an orchestration debt; a pre-release rewrite would change too many rating/import/sync assumptions at once.

`adm-zip` in main and `fflate` in renderer have different environment constraints. Vendored PDF runtime is actively consumed. Capacitor core/native plugins and optional Python components cannot be judged unused solely from TypeScript imports. No speculative library replacement was made.

World sandbox and persistent Room state remain separate because consent and provenance differ. Main-owned scenario/reflection/integration operation ledgers are durable retry boundaries, not interchangeable copies of chat state. Their full state-machine redesign is outside this bounded pass.

## 8. Remaining architectural debt

### Release blockers

1. **School prompt contract:** `management/backend/src/llm/provider.rs` rejects client system roles; desktop conversation and ordinary completion callers supply them. The management README explicitly promises admin-owned system prompts. Define supported task/context envelopes and prompt-profile behavior, then run a real desktop-generated chat request against management. The new adapter fixture proves DTO compatibility, not complete school tutoring compatibility.
2. **School policy registry drift:** Rust retains `colour_known`, `do_colour_known`, `wordSyncStaleLearningDays`; TS uses newer names and additional settings. Current validation can reject the whole policy. Generate/consume one canonical contract and migrate old policy keys deliberately. This blocks affected policies, not every policy response.

### Architecture/product work

- **Open-world semantics:** opaque unknown features round-trip, but core-inferred accesses, task templates, familiar entity kinds and a builtin Japanese prosody implementation constrain behavior. See [the exact extension boundary and acceptance design](open-world-language-boundary.md). An unfamiliar package can carry data the core cannot yet assess. This is a blocker to claiming full open-world task support, not a reason to discard the data.
- **Knowledge transaction ownership:** renderer orchestration coordinates event appends and materialized updates. Atomic per-file writes do not prove an all-or-nothing multi-store transaction or power-loss durability. Future work should make one main-owned command/replay boundary explicit; do not add another renderer cache to compensate.
- **Identity/resume:** media titles used as hash inputs can collide; Reader page-index resume is unstable across repagination. Stable source identity and logical text/location anchors need migration, not an isolated new hash.
- **School disclosure:** authorized staff visibility is tested. Custom-provider legal consent is delegated to that provider; this pass did not verify an explicit learner-facing teacher-visible-prompt disclosure across the complete school onboarding journey. Verify that product promise before deployment.
- **Frontend concentration:** context/route orchestration, large reactive dependencies and the approximately 2.27 MB main JS chunk remain structural costs. Vite's mixed static/dynamic import warnings show that some lazy paths are not actual split points. No microbenchmark claim is made.
- **Release/platform coverage:** final macOS artifact is unsigned and unnotarized for local testing. Windows/Linux packages, native iOS/Android, signed update delivery and deployed cloud were not exercised. Existing artifact-verification scripts pass; this is not proof of a released updater chain.
- **Diagnostics:** pip writes harmless update notices to stderr, which the startup UI/log currently labels as errors even when reconciliation succeeds. Observed during the smoke; recoverability is intact, but diagnostic severity should be separated from process failure.

## 9. Local AI status

The packaged macOS arm64 app used a disposable profile, an installed Gemma 4 E2B Q4 model, its real bundled native runtime and a real Python backend. Two assistant turns completed in succession. A third request was cancelled through the visible Stop control; the next request completed. The UI returned to idle after both completion and cancellation. No `No sequences left` error or renderer page error occurred.

The first real scenario-generation request completed inference but produced a proposal referencing an unselected person; validation rejected it without publishing a conversation. To isolate chat lifecycle from stochastic scenario quality, the test then seeded one temporary sandbox participant through the actual main-owned world store. User sends, cancellation, inference, journal writes and UI rendering were real. This is not evidence that arbitrary generated scenarios always succeed.

Persisted journal evidence contains seven sequential unique events: four user messages (including the cancelled request) and three nonempty assistant replies. There is one sandbox thread, no persistent Room and no fabricated assistant completion for the cancelled turn. Living World remained disabled. The first shutdown exited Electron and its Python child, released ports 7752/7753 and logged a clean Python exit.

The live smoke also exposed unconditional full-prompt logging in conversationAgent despite developer mode being disabled; the equivalent llmProvider path already respected that setting. Both conversation and compaction prompt dumps now require explicit developer mode; NLP logging reports character counts only. After rebuilding, the saved conversation restored and a fourth assistant reply completed in the final artifact. The UI was idle, no renderer page errors occurred, and fresh logs contained neither prompt dumps nor raw NLP input. Both initial and final shutdown released the backend ports and exited the Python child. Evidence is retained in `final-restart-evidence.json` and the chat snapshots under the local validation directory.

## 10. Validation

- `npm run typecheck`: both renderer/shared and Electron configs pass on final code.
- `npm run test -- --run`: **443 files passed, 3 skipped; 7,293 tests passed, 21 skipped**. The final run includes pairing rotation/removal and default-mode prompt-logging fixes. Earlier transient failures were captured during test-first work and resolved; they are not counted as final failures.
- `cargo test --manifest-path management/backend/Cargo.toml`: **326 tests passed** across unit/integration suites (310 + 7 + 2 + 5 + 1 + 1).
- Disposable Python environment: `python -m pytest src/root-of-app -q`: **241 passed**, 27 warnings.
- `PATH=/tmp/mlearn-acceptance-venv/bin:$PATH npm run test:language-data`: **25 Node + 26 pytest tests passed**.
- Management UI: **93 tests passed**, typecheck and production build passed.
- Build ownership tests: **4 passed**; update-artifact tests **5 passed**; existing acceptance-tooling test **1 passed**.
- `npm run build`, `npm run build:mobile`, `npm run build:extension`: passed. Vite large-chunk/static-dynamic warnings remain.
- `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir -c.mac.notarize=false -c.directories.output=/tmp/mlearn-convergence-20260922/package-final`: passed. The final archive has 3,607 entries, zero emitted application test/typecheck files and zero stale `localStorageMigration`/`schedulerService` modules.
- Live packaged checks: completed/repeated/cancelled/recovered turns, restart/history restoration, final-artifact response, ordinary-log privacy, protected Anki fetch (200), hostile origin rejection (403), and clean child-process/port shutdown passed. The scenario-generation proposal was rejected safely; this stochastic output path is not claimed universally successful.
- All six locale JSON files parsed successfully.
- `git diff --check`: passed. Incremental changes reviewed against the reconstructed **starting dirty tree**, not only against HEAD. Independent review caught and fixed paired-mobile credential propagation before final build.

Logs and baseline artifacts are under `/tmp/mlearn-convergence-20260922`; these are local evidence, not committed runtime code. No acceptance instrumentation was added to production source for the live test.

## 11. Repository state

Branch **dev**, starting HEAD **8c0f11ce** (origin/dev at census). No commit, push, merge, deployment or release publication was performed. The tree was substantially dirty before this task and remains intentionally uncommitted. Baseline status/patch/HEAD and a reconstructed starting tree are retained locally so prior acceptance work is distinguishable from this pass. New tests, the scoped build cleaner, pairing accessor, OCR lifetime owner and architecture notes belong to this pass; existing lockfiles/acceptance harness and numerous other edits predate it.

## 12. Final system map

- **Language meaning and lexical identity:** installed language package metadata/assets/adapters define normalization, features and behavior. Shared hashing/addressing produces stable application keys from those identities; graph entities/relations provide lexical structure. Core still infers familiar learning concepts at the documented task boundary.
- **Learner observations:** `knowledgeEvents`/`knowledgeHistoryStore` and shared history archives hold durable learner evidence. These are distinct from `journalService`, which owns conversation/world events. Ratings, exposures and Anki imports enter knowledge events; repeated-import identity is resolved before append. Unknown package-owned feature/target payloads must survive serialization.
- **Derived knowledge:** shared capability/effective-knowledge folds and main graph/history projections derive what evidence supports. These are not independent sources of learner truth. Presentation should query them rather than reinvent confidence.
- **Scheduling:** shared `srs/retentionScheduler.ts` owns native retention scheduling; card state persists schedule results. Anki schedule/import adapters translate external evidence rather than redefining native ratings.
- **Renderer:** owns UI selection, reactive view state, route-local jobs and user-command orchestration. It accesses platform authority through bridges and settings through the settings context; it does not own native process lifetime.
- **Electron:** owns files, IPC validation, journal/world persistence, installed packages, local HTTP/WS authority, child processes and native AI. `llmRouter` owns queue/admission/cancellation routing; builtin/Ollama services own provider resource lifetimes.
- **Conversation/world:** worldStore owns durable entity topology; journal owns messages/observations; projections derive social/knowledge state. Main scenario/reflection/integration services own durable operation ledgers. Sandbox baselines isolate temporary practice from persistent Living World consent.
- **Python:** generic HTTP NLP/OCR/voice service, invoking installed package adapters and declared runtime dependencies. It is not another scheduler or learner-knowledge database.
- **Cloud:** separate first-party service/asset publication repository, absent from this checkout; renderer/main adapters own outbound session/stream integration locally. This audit cannot establish the unavailable worker's internal correctness.
- **Management:** separate school authority for identity/groups, compiled policies, provider routes, quotas, pricing and retained teacher-visible conversations. It shares external contracts with desktop, not its local stores. The unresolved prompt and setting-registry contracts are the remaining concrete contradictions.
