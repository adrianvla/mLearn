# mLearn visual specification — reference parity

The active work is the [visual-parity rewrite](docs/implementation/VISUAL-PARITY.md), authorized 2026-10-20. The previous version of this document described a v3 presentation the maintainer rejected. Its preset colors, numeric font choices, Home arrangement, titlebar and media controls are historical implementation details, not an approved design.

## Authority

Edited images in `docs/product/screenshots/` are exact visual targets for their depicted states. For existing surfaces without an edited target, inspect the corresponding isolated running `../mlearn-ts` screen, its real revision/theme/state and supporting CSS. It is now the secondary visual reference, not a mandate to copy its architectural debt. Edited images win any conflict. No new Image Gen concepts, generic dashboard, invented branding or subjective reinterpretation is requested.

This supersedes the older blanket refusal to use an unpictured legacy layout and the interpretation that Home may stay generic while `visual_pending`. Missing final maintainer acceptance remains honest; it is not permission to preserve a rejected design or stop repairing it.

## Reconstruct, do not retouch

Replace the rejected v3 theme/presets, component geometry and actual screen compositions as needed. Preserve the portable application/runtime boundaries, accessibility and existing real capabilities. Do not retain Quartz/Slate's appearance merely to minimize changes; preserve custom theme data and implement a deliberate built-in migration rather than wiping profiles.

Before coding the visual layer, derive from actual references:

- Window chrome, shell/navigation, container geometry and density at known logical sizes.
- Content and control font families/fallbacks, weight, size, line-height and wrapping.
- Icons, button/pill/field/disclosure anatomy and hover/focus/selected/disabled states.
- Materials, exact reference colors, opacity, blur, shadows and borders over matched backdrops.
- Scrolling, source clearance, caption/player composition and narrow/large-text behavior.

Record measured choices with their reference/state in the existing design/verification ledger. Do not invent fresh numeric values and then treat this document as their approval. A screenshot records appearance, not proof of working domain behavior; exercise real actions separately.

## Ownership

Semantic theme roles feed accessible shared primitives and meaningful feature compositions. Reuse working APIs, replace insufficient ones and migrate their callers. Application features may own layout, but do not reproduce a private control implementation or font system. Specialized native/window/source adaptation stays narrow. Avoid both monolithic screens and one-component-per-element wrappers.

The first-class consumers are all existing Home, Settings/package-management, Watch/transcript and Inspector states, not a showcase screen. Home and Watch chrome must visibly match their references; improving internal reuse without changing rejected output fails the task.

## Evidence

Match viewport, scale, theme, data, media time and state. Compare full windows and individual UI regions using 1:1 side-by-side and overlay/difference inspection, then exercise the real interactions. A numerical match dominated by the video background is not evidence of matched chrome. Do not mask UI differences, rebaseline to v3 or substitute generated/staged UI.

Unimplemented capabilities or missing trustworthy reference states stay explicitly incomplete; no fake actions/data. Preserve responsive and native touch/keyboard behavior and the repaired native performance. Do not confuse accessibility containment, code review or successful builds with visual conformity.

Update this file during implementation with actual reference-derived component contracts, replacing hypotheses with evidence. Completion follows VISUAL-PARITY's separate visual, structural, functional and performance gates; only the maintainer grants acceptance.

## Measured foundation, 2026-10-20

Reference revision: `1788f9c74dc73dd884b687ec80d9550c3ebf6c6b`.
The isolated development application completed its real EULA and Japanese
installation. Home was captured at 1200x700 logical pixels / 2x, with Glass and
Dark Quartz selected through Settings. Captures and the open mismatch ledger
live in ignored `.mlearn/visual-parity/manifest.json`.

- The edited Settings PNG is 2224x1744. Its dominant content material is
  `#2c2d2b`, navigation `#1b1c1b`, control `#3d3e3d`, border `#4b4c4b`,
  foreground `#f0f0f0` and secondary text `#a0a0a0`. These are decoded
  pixel measurements, not the rejected v3 Slate palette.
- Reference `styles/index.css:83-139` defines Helvetica Neue UI/content,
  16px body, 14px secondary, 18px feature titles, 20px shell title, 24px
  page title, 32px inspection title; 400/500/600/700 weights; a 4px spacing
  unit and 4/8/12/16px corner families.
- Ordinary primary actions use the reference's warm outlined/tinted treatment,
  not the rejected filled-blue v3 button: `index.css:23` sets dark primary
  `#ff5900`, `themes/quartz.css:5` sets light primary `#c44700`, and
  `Button.css:123-127` uses a 12% tint with foreground text and an accent
  boundary. Blue and green gradient Knowledge actions remain separate roles.
- `welcome.css` owns a fixed header and secondary navigation, then one
  independently scrolling content region, with 24px horizontal inset and
  20px activity-grid gaps. Feature cards have 16px inset, 12px corners,
  40px outlined icon tiles and 18px semibold titles. Recents remain actual
  source records. Only implemented activities are presented: no invented
  learning-progress metrics or absent Reader/Messenger/Review actions.
- Settings uses a 180-200px fixed navigation column and independently
  scrolling content. Its ordinary rows are divided, with label/description
  on the left and a control on the right, wrapping on narrow layouts.
- Watch uses a black source canvas, compact translucent Home/window controls
  and a bottom player rail. The seek track is above the compact playback
  controls, not a large stock slider between text buttons. Native video
  rendering and input ownership remain in the media host.
- Inspector uses 32/44 title, 20/28 definitions and 18/26 readings at 1x
  text scale, translucent dark material, 1px neutral boundary, independently
  scrolling dictionary content and an attached action footer. Knowledge
  colors and gradients carry real claims only.

### Shared component families

`Button` owns action, selection, busy/disabled and icon-only states, including
compact media and Knowledge variants. `Icon` owns portable vector geometry;
features do not recreate click targets or icon text. `Text` owns complete
typography roles. `Screen`, `Panel`, `SettingRow` and shell composition own
bounded scroll regions and shared surface anatomy. `Dialog`/`ContextPanel`
retain portal, dismissal, focus restoration and bounded scrolling semantics.
Fields, badges, selectors and disclosures use the same type/material/control
families. Native minimum touch targets remain 44 logical pixels.

### Persisted built-in compatibility

Untouched historical built-in palette/radius fingerprints resolve to the
replacement presentation at the rendering boundary. Text/density preferences
and extension data are preserved. A user-edited palette, radius or extended
document is not identified as built-in merely by its ID. SQLite remains
authoritative; rendering resolution does not create a second preference store
or wipe or rewrite profiles.
