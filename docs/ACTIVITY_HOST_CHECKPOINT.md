# Activity host refactor — 2026-10-05

Baseline: `a2899a8c37dd651d72af52e11a2ad13bd181abc1`, branch `refactor/minimize-tech-debt`. Earlier untracked checkpoint documents are unrelated and preserved.
Started 15:16 Zurich; hard stop checkpoint 17:16 Zurich. Implements the incorporated Downloads/AGENT_PROMPT.md, superseding universal desktop chrome only.
Completed 16:34 Zurich, approximately 78 minutes elapsed. The isolated acceptance app quit cleanly; no remaining implementation slice.

## Host / route / return map

- Main: `/`, `/reader`, `/video`, `/messenger`, `/messenger/memory`; activities own chrome.
- Study: `/practise/**`, `/evaluate/**`; local purpose switch and existing task/input owners.
- My Learning: `/plan`, `/knowledge/**`, `/progress`; compact utility navigation.
- Settings: `/settings`; existing sidebar/search and recovery, without a library guard blocking access.
- Mobile retains one renderer and logical route navigation.

Native aliases and in-renderer cross-family links use the same route-to-host dispatch. One on-demand native renderer per family reuses `main.html` and the existing provider composition. Generic family activation focuses its existing subview; explicit intent sends one consumed request. Secondary close hides/suspends its renderer, retaining in-flight work; app quit uses existing canonical checkpoints. Startup reporting and updater presentation run only in Main.

Cross-family Return sends the source envelope to the receiving host. Main compares a live source identity and focuses it without resetting it; otherwise the source's established sessionStorage restore protocol runs in Main. Back remains local; Return is explicit.

## Execution slices

1. Family dispatch, local chrome, separate Settings, source-preserving Return; visually exercise first native slice before propagating.
2. Home/Study entry and utility hierarchy using actual controls and theme tokens.
3. Focused regression checks, one final integration/typecheck/desktop/mobile build pass, and final native acceptance on the changed source with copied representative data.

## Final evidence

Slice 1: `ed1117c2`. Slice 2: `29b3bacd`. Slice 3 completes focused regressions, owner layout fixes and running-app acceptance. No learning-model, scheduler, graph or evidence semantics changed.

Runtime: macOS Electron from this checkout's production `dist-electron` + `dist`, `NODE_ENV=production`, final renderer asset `app-DpMnyKj5.js`. Representative profile: `/Users/adrian/.mlearn-acceptance/mlearn-acceptance-host-families-20261005`, APFS copy of the existing returning-learner acceptance profile. Theme: Tactile / Quartz. Real learner history was untouched. Native accessibility actions exercised menus, entry, ratings, preferences, close and Return; renderer screenshots/DOM measurements used the app's local debugging endpoint.

Evidence is saved outside Git at `/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/`.

| Focused acceptance | Observed result |
|---|---|
| Layout | Home, loaded EPUB Reader, loaded Watch with external subtitles/annotations, saved Messenger history, active Review and Evaluate, Plan, Knowledge, Progress and Settings inspected at 720×580 and 1400×900. Body/document dimensions match the content viewport; panes own their scrolling. Expanded Adjust has its own scrolling. Compact Reader drawers now stay between its toolbar and status bar. |
| Entry | Native Home Resume Review reaches the exact saved card in one click, with paused grammar still available. Category Evaluate opens its useful chooser. Knowledge check admits only after its explicit action. |
| Families | Four on-demand singletons. Native Go → Evaluate agrees with in-app routing. Plan/Knowledge/Progress remain in My Learning. Ordinary family focus preserves the current subview, including Settings Behaviour. Secondary native close hides/suspends its renderer. |
| Learning | Actual native Space reveal, grade 3, expanded Adjust, mnemonic 33 and Undo exercised. Settings grading key produced no Study command. Canonical updates reached all four renderers. Fresh mixed encounter journal has empty scaffolds; exposed replay/correction retains supplied access. Evaluate creates its separate assessment namespace while nine existing practice records remain unchanged. |
| Return/retry | Real Reader sidebar → scoped Study → Return kept Reader at page 10. Plan → scoped task → native close/reopen → Return focuses the live Plan. Watch source task → native close/reopen → Return kept the identical video element paused at 16.925476 seconds with subtitles; after Main changed to Reader, Return restored Watch/time/subtitles through its established restore path. |
| Controlled pending write | On the copied profile, held one real rating command before transport, closed/reopened Study, rejected that acknowledgement and retried through the actual UI. Retry command/attempt ID are identical; one canonical event, then one Undo retraction. See `retry-undo-journal.json`. No production test hook was added. |
| Settings/recovery | Quartz → Slate propagated to all open hosts, then Quartz restored. Mnemonic preference propagated into the existing Study task, then Spatial restored. Settings recovery points are accessible in its separate host. A second disposable corrupt-library copy reached Guardian's existing pre-window protection and verified recovery offer; that boundary remains intact. Fault run quit without recovery writes and its copied file was restored. |

Representative screenshots: [Home](/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/home-large.png), [compact Reader](/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/reader-compact.png), [Watch](/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/watch-large.png), [Messenger](/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/messenger-compact.png), [expanded Adjust](/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/study-adjust-large.png), [Plan](/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/plan-large.png), [Knowledge](/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/knowledge-compact.png), [Progress](/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/progress-large.png), [Settings](/Users/adrian/mlearn-acceptance-runs/activity-host-20261005/settings-large.png). Compact/large pairs and targeted journal/namespace captures are in the same directory.

## Source gates and replacements

- One broad integration run: 592 files / 9,201 tests passed; nine failures in two files were stale Back selectors and a missing chooser mock after the authorized UI changes. Those fixtures were updated without weakening their lifecycle assertions; the affected eight-file regression set passes 376 tests (one existing skip).
- Final route/host/entry/RatingMatrix set: 58 passed. Window dispatch/resize: 85 passed. Library guard/recovery: 10 passed. Plan/content: 30 passed. Both TypeScript configurations pass; desktop production build, splash smoke check and mobile build pass. No repeated full integration campaign.
- Removed universal navigation assertion, full-window Reader/Settings/editor assumptions, global Windows activity offsets, the duplicate native menu strip in secondary hosts, Review's admission corridor and bottom Return control, oversized Plan launcher block, and the unused Compact Home summary setting control. Its persisted compatibility field remains. Optional background is below Plan coverage. Native resize now targets the requesting host. Mobile retains its full-height single-host boundary.
- Earlier untracked campaign checkpoints remain untouched and uncommitted. No new review tranche, models, accounts, content installs or device simulators.

## Limits

Native acceptance is macOS. Windows/Linux layout and mobile compatibility have source/build coverage, not native device certification. Native OS-frame screenshots were unavailable; image evidence is renderer capture with native accessibility interactions. Some old copied flashcard media references report Image unavailable; no content was manufactured to hide that limit. Guardian's corrupt-library failure occurs before native hosts exist; the in-app failed-library notice/Settings recovery-access behavior is covered by focused component/route tests, while the normal recovery controls were inspected natively.
