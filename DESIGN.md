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

There is one reference-derived visual system, not selectable interface styles.
Integrate the maintainer-selected reference presentation without a style name;
ignore the other reference style variants. The legacy Interface style setting, its
persisted preference, parallel component implementations and selector
compatibility machinery are excluded. Approved translucency/material effects
belong to the shared v3 component system. Quartz/Dark Quartz and custom themes
remain separate palette/theme choices, not interface-style modes.

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

The October 21 clarification supersedes the initial alternate-style selection
for future reference measurements. The isolated reference now uses the selected
presentation, with its actual setting read back before capturing Home/Settings.
Its source style file adds no structural overrides: the base controls, panels
and palette own the appearance. Integrate those owners directly; do not copy a
style axis, alternate grouping overrides or a named v3 mode. Earlier captures
remain historical evidence, not authority for another style variant.

- The edited Settings PNG is 2224x1744. Its dominant content material is
  `#2c2d2b`, navigation `#1b1c1b`, control `#3d3e3d`, border `#4b4c4b`,
  foreground `#f0f0f0` and secondary text `#a0a0a0`. These are decoded
  pixel measurements, not the rejected v3 Slate palette.
- Reference `styles/index.css:83-139` defines Helvetica Neue UI/content,
  16px body, 14px secondary, 18px feature titles, 20px shell title, 24px
  Settings title (20px in the running Settings layout), 32px inspection title;
  400/500/600/700 weights; a 4px spacing
  unit and 4/8/12/16px corner families. Shared web text roles retain Helvetica
  Neue first, then Helvetica/Arial and generic sans-serif: Windows without the
  reference face must not fall through to the browser's default serif.
  Fields preserve that shared web role when adding compact search geometry.
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
  Measured rows use 12px inset, 14px labels, 12px descriptions and a 2px gap.
  Navigation inherits the reference's 16px body size with 18px icons;
  inactive items use secondary foreground. Desktop search/navigation controls
  are 32/36px high, with native 44px touch targets preserved.
  Appearance selectors are 166px wide with 14px chevrons. Section titles use
  15.2/23px semibold type and a 2px by 1em marker, rather than a full-line rule.
- Running light Quartz uses `#cacacb` canvas, `#111418` foreground,
  `#242a31` secondary text and `#a4a5a7` boundaries. Shared glass is white
  at 50% in light appearance and `rgba(130,130,130,.2)` in dark appearance.
  Home retains the reference's vertical canvas gradient, 160px media preview
  and full-width continuation rows with a separate Resume action. Breakpoints
  at 950/550px yield three/two/one activity columns without invented activities.
  Icon tiles and circular play controls use the reference's 25% white outline
  in dark appearance; the preview has a second inset boundary.
- Quartz and Dark Quartz request actual desktop-native materials. The native
  desktop owner derives this from accepted theme identity/palette, applies
  macOS under-window vibrancy or Windows Mica (Acrylic on supported older
  Windows), and clears it for opaque Slate and independent/custom palettes.
  Startup reads the same saved native theme before showing the window.
  Chrome appearance follows the active palette; macOS vibrancy activity follows
  window activity. The host publishes actual effect availability, not a
  platform/titlebar guess, so failed/unsupported effects keep an opaque fallback.
  This is theme behavior, not another setting or styling system.
  Navigation ancestors
  must remain transparent. Home and Settings navigation reveal the material;
  Settings content and media retain their own opaque canvases. Browser/mobile and
  custom palettes retain their saved opaque background. Matched 1200x700 / 2x
  composited captures over identical color bands establish the dark black 38%
  tint and the WebKit light white 75% floor. The latter compensates for the
  different native/renderer composition; copying Chromium's white 50% body tint
  left the actual app visibly too dark. Quartz also uses the reference's
  blur(8px), saturate(.82), contrast(.92), brightness(1.04) backdrop treatment.
  Window-only screenshots flatten native vibrancy and cannot verify this gate.
- Watch uses a black source canvas, compact translucent Home/window controls
  and a bottom player rail. The seek track is above the compact playback
  controls, not a large stock slider between text buttons. Native video
  rendering and input ownership remain in the media host.
  The compact volume range has an 80px width, 26px rounded trough and 30px
  thumb; its transparent native input preserves keyboard and pointer semantics.
  Main subtitle type is 40/64px, measured from the reference's 40px/1.6 rule.
  Authored subtitle newlines and literal readings remain authoritative source
  content. A package may project a ruby base that removes duplicated inline
  reading markers while retaining original bytes, offsets and context. The
  renderer must not infer this transformation or substitute a lemma.
  The resumed synchronization composition uses the pictured previous/next
  cue-alignment controls with real cue starts and the existing persisted offset.
  Rust owns alignment decisions; manual editing and reset remain available.
  Apply/Reset must not be substituted for the distinct alignment actions.
- Inspector uses 32/44 title, 20/28 definitions and 18/26 readings at 1x
  text scale, translucent dark material, 1px neutral boundary, independently
  scrolling dictionary content and an attached action footer. Knowledge
  colors and gradients carry real claims only.
  The matched courage entry exposed extra definition gaps and badge padding:
  definition baselines are 28px apart and readings have 4px vertical inset.
  Shared web typography requests grayscale antialiasing to match the edited
  text strokes; native typography does not consume that web-only adaptation.
  The shared Helvetica Neue family resolves CJK through platform fallback,
  without a forced Mincho override. Glass uses rgba(60,60,60,.5) with
  blur(20px) saturate(2): the matched magenta region is exactly [157,30,157],
  rather than the rejected candidate's [81,26,81].

### Shared component families

The resumed linguistic renderer is a specialized source-display owner shared by
captions, transcript, Inspector and dictionary cards, not a second analysis or
Knowledge owner. `SubtitleWord.css` measures ruby at 0.45em with centered reading
and 0.05em letter spacing; `index.css:190,243-244` specifies a 2px contour stroke,
high `#e8687b` and low `#4e86ca`. Contours consume the package's normalized display
units and retain pronunciation alternatives rather than interpreting a Japanese
taxonomy in React. Original UTF-8 source coordinates stay authoritative.
The matched Inspector pill crop has brighter contour endpoints, `#ff4a64` and
`#3387ff`; these belong to the pill role, not the muted source-overlay palette.
Part-of-speech metadata has an opaque neutral `#565656` backing in that crop,
so its fill does not inherit the video hue.
The approved 1200x700-pixel courage-panel crop uses a distinct 16/28px bold
pronunciation-pill role, with 4px vertical inset. Its contour spans the compact
reading line; large source overlays span glyph height rather than the 64px
subtitle line box. A pill shows the reference continuation mark only when the
package supplies a following height; source overlays use a fading continuation.
The edited Inspector pairs pronunciation/reading pills with package-declared
level badges above the dictionary disclosure. Static metadata is not a claim.
Absent metadata leaves ordinary source text intact.
Native ruby and non-ruby words share the source-line baseline, including
punctuation and 44px touch controls. Align their source-box bottoms: Yoga's
first-text baseline can otherwise align a neighbour to the ruby reading.

`LiveWordTranslator.css` measures compact meaning/reading cards at 300x30px,
20px horizontal inset, 10px gaps and a column-first two-row flow beneath window chrome.
Cards use the shared glass material and actual dictionary summaries. A single
source/revision/package-bound native batch supplies at most six distinct
targets; bounded history expires after the reference's 30-second lifetime and
is released on source/package/focus changes. Narrow layouts preserve reachable
cards and controls rather than clipping the media or Inspector.

`Button` owns action, selection, busy/disabled and icon-only states, including
compact media and Knowledge variants. The selected reference's text ghost
buttons retain the shared default button's `blur(8px)` backdrop while clearing
their CSS fill and border. Chromium's native dark composition still produces
a dark backing; WebKit blur alone leaves the underlying canvas unchanged.
The WebKit quiet text material uses a 35% black tint in dark appearance and
no tint in light appearance to retain that measured contrast.
Shared quiet text actions consume that material; icon-only
quiet controls remain unbacked. This is a web rendering treatment, not a saved
interface preference or a separate component implementation.
`Icon` owns portable vector geometry;
features do not recreate click targets or icon text. `Text` owns complete
typography roles. `AppShell`, `Panel`, `SettingRow` and shell composition own
bounded scroll regions and shared surface anatomy. `Dialog`/`ContextPanel`
retain portal, dismissal, focus restoration and bounded scrolling semantics.
The approved nested Inspector preview uses the same translucent panel family:
the reference Tooltip consumes `rgba(60,60,60,.5)` with a blurred backdrop, not
the player rail's nearly opaque chrome. The web correction popover consumes
`media.panel` and `media.backdrop`; native retains its legible opaque fallback
because that rendering boundary has no backdrop blur.
Web backdrop layers sit beside interactive content rather than wrapping it.
Putting backdrop filtering on a content ancestor creates a nested backdrop root:
attached correction popovers and live cards can then show sharp text through
their material instead of blurring it. `ContextPanel`, `MediaOverlay` and
`AppShell` keep their own material layers non-interactive while retaining the
same native fallback, geometry and focus/hover owners.
Read-only progress uses the reference preview's outlined 6px trough and equal
title/track allocation. The shared `Progress` owner exposes its actual range to
assistive technology and uses the existing neutral control outline, not a border
that disappears into the footer. Home source positions and package transfer bytes
remain native facts; an unknown transfer total has no invented percentage.
Fields, badges, selectors and disclosures use the same type/material/control
families. Native minimum touch targets remain 44 logical pixels.
Compact shell headers share navigation's bounded 35% viewport budget and can
scroll independently when enlarged text exceeds it. A fixed header must not
consume the source workspace; ordinary desktop headers remain stationary.
Watch retains the approved black top rail so source identity stays readable over
bright frames. A fresh loaded comparison supersedes the earlier two-column
assumption: cards fill down two rows before starting the next 300px column,
with scoped scrolling when that bounded history exceeds available width.
Resting cards own their backing. The edited hovered image and reference CSS
reveal the enclosing material and leading dismissal only on hover; keyboard
focus must reveal the same controls, and touch keeps dismissal reachable.
The shared media-overlay boundary owns those input/material states for cards
and synchronization rather than feature-local hover controls.
Synchronization uses one shared enclosing material, not a second filled box
around its numeric offset. `SubtitleSync.css` measures its number at 1.5rem
(24px from the 16px root), 30px arrow glyphs and a 50px ordinary bar. The shared
numeric control role scales with saved text size; enlarged/native layouts grow
rather than clipping, while retaining 44px native targets.
Shared buttons project expanded/busy/checked states through the supported ARIA
aliases. Selected buttons expose a pressed state on web; non-button roles keep
their applicable selected state. Native accessibility state remains intact.
Native dialog content leaves pan ownership to its scrolling body rather than
claiming the initial touch above it; controls retain their own activation and
keyboard/escape behavior.

### Persisted built-in compatibility

Untouched historical built-in palette/radius fingerprints resolve to the
replacement presentation at the rendering boundary. Text/density preferences
and extension data are preserved. A user-edited palette, radius or extended
document is not identified as built-in merely by its ID. SQLite remains
authoritative; rendering resolution does not create a second preference store
or wipe or rewrite profiles.
