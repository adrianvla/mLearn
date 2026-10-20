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
