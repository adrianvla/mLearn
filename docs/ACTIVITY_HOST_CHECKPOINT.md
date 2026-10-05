# Activity host refactor — 2026-10-05

Baseline: `a2899a8c37dd651d72af52e11a2ad13bd181abc1`, branch `refactor/minimize-tech-debt`. Earlier untracked checkpoint documents are unrelated and preserved.
Started 15:16 Zurich; hard stop checkpoint 17:16 Zurich. Implements the incorporated Downloads/AGENT_PROMPT.md, superseding universal desktop chrome only.

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

## Evidence and limits

Pending. Runtime uses current checkout via the existing Vite server, isolated copied profile `/Users/adrian/.mlearn-acceptance/mlearn-acceptance-host-families-20261005` cloned from the previous returning-learner acceptance profile. Real user profile/history is not used.

Slice 1 committed as `ed1117c2`. First native Home → saved Reader → separate Settings → Main Return exercised on copied data. Reader remained at page 10 with its toolbar/canvas/status bar; Settings had only its own sidebar/search. Screenshots in `/tmp/mlearn-host-evidence/first-reader.png` and `first-settings.png`. These establish layout/source preservation for that flow, not all lifecycle acceptance.

Slice 2 removes the admission corridor from direct Review Start/Resume, provides a passive useful Review chooser, restores package-declared language flag and usable media preview height, adds compact Home secondary access, foregrounds Plan target/coverage, groups Knowledge views, and consolidates the existing Review toolbar. Settings' unused Compact Home summary control is removed; its persisted compatibility field remains. Shared scheduling/evidence/task logic is retained. Focused route/entry/Plan/Review tests and both TypeScript configurations pass; final native/build acceptance remains pending.
