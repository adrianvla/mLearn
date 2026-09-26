# Sol A5/A6 handoff — 2026-09-26

This pass implements A5 and A6 on top of the accepted repair foundation and Astra's bounded A1/A2/A3/A4/A7 changes. It also reconciles the remaining percentage display. It is **not** a release-readiness claim. No commit, push, deploy, catalog publication, or original learner-profile mutation occurred.

## Implementation

### A5 — grammar study session

- Added a shared `studySessionState` presentation contract used by both Grammar Coverage and Word Sync. It reports loading, question, revealed, saving, save-failed, answered, and complete phases, plus progress and rating/advance eligibility. Word Sync now uses the same phase gate for its RatingMatrix.
- Grammar self-assessment now starts with an unassisted pattern question, persists a `revealed` cursor under the existing per-language Web Lock, shows the package's localized answer when available, and only then arms the existing RatingMatrix and keyboard controls. Where no localized answer exists, the explicit answer stage says so before self-rating.
- The existing grammar question identity, bank validation, contrast item provenance/scaffolds, denominator validation, Web Locks, and pending-write reservation remain in place. Self-assessment writes carry `taskType: grammar-self-assess`. The cursor advances only after `onProbe` acknowledges the durable journal write. A failed write leaves the question and attempt ID reserved and exposes **Try again**; retry reuses that attempt ID. Revealed state survives close/reopen and relaunch. Ordinary ratings update the current view without remounting the Learning Plan window.
- Added focused session-phase, reveal/resume, and failed-write/retry tests. Added localized UI strings in all six existing locale files.

### A6 — Japanese media-frequency curriculum

- Added a pinned source builder at `scripts/language-data/providers/build-japanese-subtitle-frequency.py`, its tests, the generated `ja.media.freq.json`, and a license/source notice. `build:language:ja` regenerates this asset before packaging.
- `ja.json` declares a second package-owned provider, `media-frequency`, alongside the existing `jlpt` provider. The media provider has its own asset, label, rank bands, and source version; JLPT remains the default. Generic package discovery and active-provider resolution load both without a Japanese branch in renderer/shared runtime code.
- Settings now retain a target per language **and provider**, and a level-system selection per language **and provider**. The Learning Plan selector restores each provider's target/scope when switching; edits still go through `updateSettings()`.
- The local packager can stage a selected language and reuse already installed dictionary-pack references, allowing the Japanese package/catalog to be prepared without publishing or rebuilding unrelated large packs.

### Percentage presentation

- Comprehensive known percentages and the Learning Plan preview use the same one-decimal rounding. For the protected QA counts, JLPT N4 is **559 / 639 = 87.5%** in both the detailed Learning Plan and the main preview. The knowledge counts/model were not changed.

## Frequency source, normalization, and license

- Source: [jkindrix Japanese language data subtitle-frequency enrichment](https://github.com/jkindrix/japanese-language-data/blob/28ae0f545aee9d9bc3547ce4bd7725b55e9b00f1/data/enrichment/frequency-subtitles.json), pinned commit `28ae0f545aee9d9bc3547ce4bd7725b55e9b00f1`, raw SHA-256 `7aef89336af9ec00da408ded3e31f6be5811dd93fd3e9c4950968e40345dbc46`. The project's [source documentation](https://github.com/jkindrix/japanese-language-data/blob/main/docs/sources.md) traces the frequency data to FrequencyWords/OpenSubtitles. FrequencyWords states CC BY-SA 4.0; the staged package includes attribution and the share-alike notice. This is subtitle-corpus frequency, not JLPT membership.
- Builder policy: verify the pinned source hash; NFC-normalize and trim surface and reading; reject malformed entries, nonascending ranks, or invalid counts; deduplicate exact surface/reading pairs; preserve source rank and occurrence count. Rank bands are 1–1,000, 1,001–3,000, 3,001–5,000, 5,001–8,000, and 8,001+.
- The staged asset has 8,598 rows. Representative source-aligned records: rank 1 `あなた` / `あなた`, 61,249 occurrences; rank 1,000 `皇帝` / `こうてい`, 293; rank 1,001 `王女` / `おうじょ`, 293; rank 8,001 `行脚` / `あんぎゃ`, 1. `あなた` is absent from the JLPT asset; 5,296 media surfaces are absent from that asset. The media asset SHA-256 is `6ea9d8695794bbd45da883f791a8cbb3840dedaefca5af10396a8afdadb3bf64`.

## Local staged artifacts and packaged build

- Japanese archive: `/tmp/mlearn-sol-a5a6-stage-20260926/release/ja/language-package-2026.09.26-frequency-r1-8a35aa3ab532.tar.gz`; SHA-256 `8a35aa3ab532626e00f1c5bab071b01ebc8cf591496c0223e5779710a7673433`.
- Local-only catalog: `/tmp/mlearn-sol-a5a6-stage-20260926/language-catalog.json`. Neither artifact was uploaded or deployed.
- Native app: `/tmp/mlearn-sol-a5a6-package-20260926/mac-arm64/mLearn.app`, version 2.9.11, Electron 42.11.4, macOS arm64, unsigned `--dir` package. `app.asar` SHA-256 `06469932a4c5facf70604636d7a4571136cd713cacb8a40f0e1954b685abc6d2`; main executable SHA-256 `6db1122494c4ad159383467c59671cdf2c1cdd421c77ea6584f92032bfe826b0`.
- QA profile: `/tmp/mlearn-sol-a5a6-qa-20260926`, cloned from Astra's protected replay. Only the new Japanese metadata, media asset, and license notice were installed there from the local archive. The original replay database's initial SHA-256 was `61dc9a5a383202a1905137def31745311d43061ba697c3e53892425d967750d9`; the QA copy initially matched it. All runtime writes below were confined to the QA copy.

## Packaged-app replay evidence

- Opened Learning Plan in the packaged app using the QA profile. JLPT vocabulary and Japanese media frequency appeared as independent choices. JLPT N2 showed 4,828 words up to target; media Core 1,000 showed 1,000 words. The package rows and installed metadata were inspected directly in the local archive.
- Selected media frequency and Core 1,000, switched back to JLPT and saw its N2 target restored, then returned to media and saw Core 1,000 restored. After quitting and relaunching the native app, media frequency and Core 1,000 were still selected. QA `settings.json` retained `frequencyProviderSelections.ja = media-frequency` and `frequencyProviderTargets.ja = { jlpt: 2, media-frequency: 1 }`.
- Word Sync used a different candidate set after switching: media Core 1,000 showed **0 / 78 words** with `農場`; JLPT N2 showed **0 / 203 words** with `地質`. This is runtime evidence that the selection changes actual candidates, not just labels. The 1,000-versus-694 first-band totals and distinct installed assets provide a second check.
- Started a real JLPT N4 grammar pass in the packaged app. Question 1 of 40 was `たら`; ratings were disabled until **Reveal answer** displayed `if/when (conditional)`. Selecting **Struggled** advanced to question 2 (`ていく`) in the same Learning Plan HTML view, with no whole-view loading skeleton between rating and next question. Closing and reopening the window restored question 2; quitting and relaunching the app restored it again.
- For question 2, revealed `to go on / to continue`, held a write lock on the **QA copy** of `knowledge-history.sqlite3`, and selected **Struggled**. The UI showed “We could not save your answer” and **Try again** while staying on question 2. After releasing the lock, **Try again** advanced to question 3 (`させられる`). The event query found exactly one `grammar-self-assess` row for question 2.
- Persisted QA rows: `たら` at row 799225, attempt `4280d5fd-f01b-448d-a4e1-d68e904dc2ca`; `ていく` at row 799508, attempt `ae7b8333-da8e-41c4-92b3-4ba92cd38819`. Both are `kind=rating`, `quality=struggled`, `origin=grammar-probe`, `taskType=grammar-self-assess`, with grammar-recognition targets. The failure/retry path produced one `ていく` row.
- The packaged main preview and detailed Learning Plan both displayed JLPT N4 **87.5%** for the same 559 known / 639 total count.

## Verification

- Focused renderer tests: 266 passed across seven files. Integration tests: 261 passed across two files.
- `npm run typecheck`: passed both TypeScript configurations.
- `npm test`: 472 files passed, 3 skipped; 7,522 tests passed, 21 skipped.
- `uv run --no-project --with pytest -- npm run test:language-data`: 26 Node packaging tests and 28 Python provider tests passed. `uv` supplied `pytest` in an isolated temporary environment because system `python3` did not have it.
- `npm run build`: passed. `electron-builder --mac --dir --publish never` with code-sign discovery disabled: passed. `git diff --check`: passed.

## Limits and Astra recheck

- The media source is an 8,598-entry subtitle frequency enrichment, with corpus bias and JMdict-linked readings. The rank bands are explicit product policy, not claims of JLPT or general-language proficiency. Astra should review the CC BY-SA 4.0 attribution/share-alike obligations before any public catalog publication.
- The local package was installed into the QA profile by verified archive extraction; the app's remote download/update flow was not exercised. The packaged app displayed an existing “Language Data Update Available” notice based on the remote catalog. Astra should recheck install/update behavior against an approved local catalog or a future staging endpoint, without publishing this catalog yet.
- This native replay covered the grammar self-assessment pass and its controlled retry. Existing automated tests cover contrast question-bank identity, validation, and provenance; Astra should recheck a real contrast pass if its acceptance gate requires separate native evidence.
- The build is unsigned and unstapled. No distribution or release readiness is asserted.
