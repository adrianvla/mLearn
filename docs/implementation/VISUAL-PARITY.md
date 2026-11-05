# Visual-parity rewrite — authorized 2026-10-20

## Outcome, not a restyle

Rebuild mLearn v3's presentation so that, at matched desktop size, content and interaction state, an ordinary side-by-side comparison with the reference does not reveal a different UI. The maintainer explicitly rejected preserving the current v3 look and requested a **large visual architecture refactor**, not a small restyle, token cleanup, component extraction with unchanged output, or another foundation report.

Work overnight and continue the capture → compare → repair loop without an arbitrary iteration count. Do not mark this goal complete while fixable visual differences remain. Resource exhaustion or a genuine missing input is `paused_incomplete` / `blocked`, never success. Do not spend tokens merely to keep a loop alive, automatically buy capacity, or expand into unrelated features.

This is a new visual-only authorization for existing `~/dev/mLearn-v3`, `agent/m01`, draft PR #44 against unchanged `agent/h00`. It supersedes the former frozen-review instruction and the previous overnight feature-expansion authorization. H00/M01 are not accepted; M02 remains partial; no M03/M04+, merge or release. Last observed remote HEAD before these instructions: `1c30c98a8255e5cf73268493099aa7d79e105585`. Read actual Git and retain newer work.

## 1. Authority and the references you must use

1. The maintainer-edited images in `docs/product/screenshots/` win for each depicted state.
2. For an existing surface not covered by those images, **the corresponding running `../mlearn-ts` UI is now the secondary visual reference**, not merely behavioral evidence. Record its actual revision, theme, viewport and state. This explicitly closes the Home `visual_pending` loophole. Do not invent a generic replacement just because Home lacks an edited PNG.
3. The old application is approximately 90% of the intended UI, not an architecture to port. Inspect its CSS, computed styles, typography, icons, assets and component behavior. Where it conflicts with an edited image, reproduce the edited target, not the discrepancy.
4. Current v3 screenshots and the former `DESIGN.md` numeric/style choices are rejected baselines, not approved targets. “Quiet neutral surfaces,” Quartz/Slate colors, the current control geometry and the existing Home arrangement must not survive merely because an agent previously documented them.

Run `npm run dev` in `../mlearn-ts` after inspecting the actual script and verifying isolated disposable profile selection. Preserve tracked source/lockfiles and live v2 data. A validated isolated setup retained from the previous run may be reused; verify it, do not guess flags. Use legally usable repository/system assets; do not download or redistribute proprietary font files. A licensing/availability problem must be named, not silently replaced with a visibly different asset.

Complete legitimate reference onboarding with isolated data when possible. If v2 is genuinely broken, diagnose the reference path far enough to capture the intended UI safely, use matching source/history evidence, and identify the exact remaining uncertainty. Never submit its EULA/crash screen as the Home or Settings reference. Do not ask the maintainer to do routine capture or comparison work.

## 2. Inventory the actual visual surface before editing

Inspect all approved images for shared conventions, then map **every currently implemented v3 surface**: Home/app shell and recents; Settings and language management; Watch/native window and player chrome; captions/transcript; Inspector and nested corrections; selectors, menus, fields, dialogs and pending/error/empty states. Do not implement future Reader/Messenger/Review backends as part of this job.

For each current surface retain a reference frame, current before frame, reproduction recipe and actual component owners. Record differences in arrangement, proportions, density, typography, controls, icons, material and interaction. A list of files to rename is not a visual inventory.

Separate missing product behavior from presentation mismatch. Preserve correct Knowledge semantics, real data and independently required controls. Never add fake pitch/levels, aggregate knowledge, successful Explain/Capture actions or fabricated metrics to imitate a reference. If an unavailable capability prevents a target state from matching, record that state as incomplete/blocked; do not silently mask the missing control, declare parity, or start an unrelated backend project. Continue fixing all independent visual work.

Reconcile active `STATE.md`, `PLAN.md`, `REFERENCE.md`, `DESIGN.md` and PR wording once so no worker treats older `visual_pending`, “minimal presentation,” “smallest edit,” “ready for review,” or no-legacy-layout wording as a veto of this authorization. Retain old evidence as historical. Make the new gate and next action easy to find, not another stack of contradictory reports.

## 3. Replace the visual foundation and screen compositions

Derive the actual system from the reference: window/titlebar integration; app shell; content and chrome typography; spacing and sizing rules; icon source/stroke/fill; button and pill anatomy; surfaces, opacity, blur, borders and shadows; focus/hover/pressed states; scrolling and overflow; source overlays, media controls and caption placement. Reference values, not new creative direction, decide these choices.

**You may replace the current theme implementation, built-in presets, primitive styling/APIs and screen layouts wholesale where necessary.** Minimize duplicated responsibility and accidental complexity, not diff size. Merely moving the same styling into shared files fails this task. Home must visibly become the reference-derived Home, not the current test-form arrangement with smaller buttons. Watch must not retain generic text-button bars and stock-looking controls when the target depicts a different player. Settings must reproduce the target navigation/content/control arrangement, not only use `SettingRow`.

Use the existing React/Expo + React Native Web/Tauri stack and Unistyles. Preserve useful accessibility and lifecycle logic; replace its presentation when wrong. Host-specific visual adaptation is allowed behind the existing platform boundary, including desktop titlebar/decorations where needed. Do not treat the current default titlebar as immutable, fork the whole UI for desktop, switch frameworks, or port legacy stores/IPC.

Implement measured semantic tokens and reusable **component families**, then compose the screens from them. Inspect existing APIs before changing them; insufficient APIs may be replaced with all real callers migrated. Buttons, icon buttons, badges, disclosures, fields, navigation, popup/frame anatomy and shared source/setting patterns must have coherent owners. Linguistic and Knowledge behavior stays with its feature/domain owners, not a generic widget. Native input and specialized source geometry may use narrow platform-specific rendering.

Prove reuse through existing consumers. A shared type/spacing/control change should reach its consumers without separate per-screen patches. Extract for real behavior, lifecycle, substantial composition or reuse, not an arbitrary line count. Do not create a universal UI schema, wrapper forest, per-tag component collection, one mega-screen, second styling system, theme aliases scattered through features or `new`/`legacy` parallel implementations.

Remove superseded v3 presentation code, tokens, presets and imports after migrating callers. Preserve backend capabilities and meaningful regression coverage. Any temporary compatibility path needs an explicit boundary and removal condition.

### The persisted-theme trap is in scope

Determine which saved built-in/theme values the normal launch actually applies. Updating defaults while restoring the rejected saved Slate document at cleanup is NOT delivery. Version/migrate built-in presentation deliberately, or resolve built-in preset identity to the new definition, while preserving genuine custom themes and learner/source data. Distinguish old built-ins from user customization; do not wipe a profile to obtain the screenshot.

The normal documented app launch, not a special QA theme or route, must display the new reference-derived design. Verify a fresh development profile and an isolated copy of the existing profile. Make any needed built-in migration explicit and tested. Do not restore the rejected theme as the final visible state.

## 4. Work in visible, connected slices

First replace the reference-derived app shell/primary controls and Home composition. Then Settings, Watch chrome/captions/transcript, and Inspector/corrections. Work may be partitioned by owner, but a single lead integrates shared APIs. Do not wait until the end to discover that Home still looks unchanged.

Before propagating a component family, capture its use in a real screen and compare it with the reference. Fix the design mechanism, not only the sample. Keep a runnable candidate during integration; no fresh scaffold or deletion of working native systems.

A visual reviewer receives the actual original targets and new captures without an “already approved” narrative. It reports discrepancies with precise region/state/owner evidence. A code reviewer separately checks reuse, authority, lifetimes and regressions. A review opinion is not maintainer acceptance. Do not run recursive reviewer fleets; reviewers should drive concrete repairs, not repetitive essays.

## 5. The convergence loop is the main job

For each important state:

**capture both → compare whole window and components → inspect code/computed geometry → repair the responsible owner → recapture and interact → compare again.**

Keep both apps at matched logical viewport, backing scale, zoom/text scale, theme and window state. Use the same real input, entry/sense, media frame/playback time and scroll position where available. Capture the approved edited composition at its intended state. Do not use degree on one side and a different long lexical entry on the other as the only proof of matching typography or density.

Inspect full-window screenshots at 1:1 and useful component crops. Use side-by-side plus overlay/blink/difference images to locate alignment and material errors. A large identical video background can conceal incorrect UI in a global score: inspect UI regions separately. Do not non-uniformly resize, warp, crop away chrome, edit screenshot pixels, alter the reference, or run DevTools-only styles to manufacture a match. Freeze visual nondeterminism through ordinary product controls, not fake application results.

Check layout silhouette, window chrome, line breaks, baselines, exact font/weight/fallback, icons, accent colors, opacity/blur over the same backdrop, control shape/size, footer anatomy, source clearance, scrolling and focus states. Required actions remain real. Test pointer/keyboard/IME, disclosure, dialog nesting and return focus, not only static appearance.

Small rasterization differences across renderers are not the same as a different typeface, titlebar, layout or control. Masks may cover only identified non-UI nondeterminism, with originals retained and the reason recorded; they may not conceal a mismatch. Numerical similarity and automated containment tests assist the judgment; neither can certify a visually different interface.

Maintain one mismatch ledger with reference, candidate, owner, repair and actual disposition. No material mismatch may be closed as “polish,” “same elements present,” “scoped approval,” or `visual_pending`. If a change creates new mismatches elsewhere, reopen them. Three unproductive passes should trigger a fresh diagnosis of reference/state/component ownership, not a fourth layer of CSS overrides. This is a strategy change, not permission to quit.

There is no fixed pass count and no eight-hour timer that converts incomplete work into success. Continue while evidence identifies useful repair work. At context compaction preserve reference identities, current diff, failing states, process ownership and next action; resume without rediscovering everything. At a genuine quota/tool/access blocker preserve the candidate and exact remaining work, then report `paused_incomplete` or `blocked`. Do not spin, purchase additional capacity, drop tests or claim completion to avoid the limit.

## 6. Keep native behavior and performance intact

Preserve the optimized Wasmi/host development profiles, portable dispatch, authentication, resource limits, cancellation and bounded analysis/Knowledge pipeline. No engine/cache redesign in a UI job without a reproduced UI-induced defect. Retain the recent measured baseline as evidence, not a portable timing guarantee: roughly 365–400 ms initialization and 1.26–1.32 s Resume-to-actionable annotations on the maintainer's tested setup.

Use matched local before/after runs to catch material regressions. Test fresh process, warm reopen, source/package change and relevant interaction; measure normal launch rather than hiding a delay with a splash. Keep errors recoverable and source/claim identities stable across restart.

Run focused UI/ownership/type checks while iterating. Run complete relevant regression and consuming native checks once a coherent candidate is integrated, and rerun affected checks after subsequent edits. Rebuild binaries whose inputs changed. Preserve real macOS/Linux and iOS/Android behavior; mobile adapts the shared system without pretending a desktop screenshot specifies a phone layout. Do not loop through lengthy mobile builds after every token adjustment, or use a browser preview as native-runtime evidence.

## 7. Completion and delivery

A success requires all four independently supported conditions:

- **Visual:** no unresolved material discrepancy on the covered desktop surfaces/states under matched comparison; Home and normal-launch appearance included.
- **Structural:** shared components and composed screens implement the result, superseded styling is removed, no duplicated semantic authority or screenshot-specific path.
- **Functional:** current real controls, source/Knowledge/package behavior, accessibility and relevant native regressions pass.
- **Performance:** the UI rewrite does not reintroduce the measured delays or resource-lifetime problems.

An incomplete target/reference state cannot be silently dropped from coverage. A functioning but distinguishably generic UI is not complete. Rewriting `DESIGN.md`, extracting a Badge, collecting 14 screenshots, or finishing 18 tasks is not success by itself.

Keep one current comparison entry point and manifest under ignored `.mlearn/visual-parity/`, linked prominently from the existing handoff. Bind evidence to candidate source, served UI, native app and package identities. Verify every image actually loads, every reference is the intended one, and the final normal launch agrees with the captures. Rejected captures remain visibly labeled before-images. Keep private originals/profiles/screenshots local.

Commit coherent visual architecture/feature batches to `agent/m01` and push to existing draft PR #44 without force. Never merge or self-accept. Do not reset another process's work. Close only owned temporary processes and preserve useful caches/reference data. End with the correct candidate straightforward to launch, actual before/reference/after evidence for every covered screen and a concise residual-risk list. No new milestone or unrelated optimization campaign.

The maintainer is buying autonomous implementation and verification, not a request to debug your intermediate screenshots. Ask only for a consequential unresolvable decision/access issue; continue all independent work. Final maintainer acceptance remains separate from your evidence-backed completion claim.
