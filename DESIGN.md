# mLearn shared visual system

## 1. Identity and reference authority

Source-first, compact working surfaces with quiet neutral materials. The approved
edited images in `docs/product/screenshots` govern depicted states. The isolated
v2 runtime/CSS explains mechanisms, not architecture. Home is a provisional
composition, not a copied legacy dashboard or an approved final layout.

Settings uses the pictured navigation/content relationship, divided setting rows,
restrained headings and compact controls. Only real current sections are shown.
Watch keeps media dominant; Inspector retains its dense title/reading/meaning,
intact dictionary groups and granular Knowledge actions. Ordinary content and
media share typography, spacing, control semantics and accessibility.

## 2. Color and materials

`ThemeDocument.colors` owns background, surface, text, muted text, accent,
on-accent and border. Quartz and Slate are examples; arbitrary accepted theme IDs
remain runtime data. No feature may introduce a private ordinary-content palette.
Use the accepted document, not color values embedded in a screen.

Media has an intentional contrast treatment over unpredictable video: black
stage, light text, dark translucent chrome and a blurred Inspector material.
Knowledge pills have semantic neutral/positive/negative treatments, always paired
with labels. They do not redefine the underlying learner state. The ordinary
surface remains legible in light and dark; media contrast is not a second app.

## 3. Typography

Use the shared platform-compatible Helvetica Neue/system family. Semantic roles:
page heading 28/36 semibold; section heading 20/28 semibold; body 16/24;
caption 14/20; action 15 semibold, compact action 14. All scale through accepted
`textScale`. Inspector title 32, body 20 and reading 18 retain the approved dense
linguistic hierarchy. Long titles wrap or truncate deliberately, never push actions
offscreen. User content, paths and useful feedback remain selectable.

## 4. Spacing and layout

Base spacing steps: 4, 8, 12, 16, 20, 24, 32. Accepted `spacingScale` controls
these semantic gaps/insets; legacy theme documents default to 1. It does not shrink
essential 44-point native touch targets or change learner evidence. Radius is a
separate component value, not a replacement for runtime spacing support.

Ordinary content uses one bounded screen scroll owner and a readable maximum
width. Home has a compact entry action, language choice and divided recent-source
rows with time/language/context; not repeated full-width primary buttons.
Settings uses a narrow navigation region beside active content when space permits,
wrapping into a top navigation cluster at narrow widths. No empty sidebar entries.
Watch has its existing bounded media stage and source overlay. Inspector header/
dismissal stays fixed, body and oversized correction region scroll independently.

## 5. Existing primitives and meaningful composition

- `Text`: heading/section/body/caption, ordinary/media tone; dynamic typography.
- `Button`: primary outcome, secondary action, quiet navigation, media action and
  semantic Knowledge pill. Default/hover/press/focus/disabled/busy are explicit;
  native targets stay at least 44 points. Selected choices have a readable selected
  state and glyph/label, not an unexplained color.
- `TextField`: visible label, native keyboard ownership, multiline Return and iOS
  dismissal preserved; border/focus and errors use accepted theme semantics.
- `Screen`, `Stack`, `Row`, `Panel`: content limiter, vertical rhythm, wrapping
  cluster and intentional surface grouping. Divided feature rows remain local
  composition; no component for every element or universal form framework.
- `Dialog`/`ContextPanel`: one focus/layer owner with visible dismissal and source
  return. No new modal stack or duplicate Inspector/Knowledge state.

Existing real Home/Settings/Watch/Inspector consumers are the state harness.
Verify controls in those actual contexts and their changed empty/error/dialog/
narrow/large-text states, rather than adding a fake showcase consumer.

## 6. Interaction and feedback

Activation, focus and press feedback are immediate. Pending/failed work stays
beside its initiating action; success is the changed saved state. No decorative
motion, branding splash or invented progress. Desktop inspection modes belong to
one shared activation owner, never per-token global keyboard subscriptions.
Keyboard/IME and modal ownership protect unrelated input. Reduced motion does not
remove required state feedback. Source navigation retains exact durable identity.

## 7. Depth and surfaces

Use tonal separation and fine neutral dividers for ordinary content. Selected
navigation is a quiet surface treatment, not a colored stripe. Avoid card grids,
nested decorative cards, oversized empty panels and promotional headings.
Inspector keeps its actual translucent depth over media; content rows need not
be glass. Shared theme/control owners, not copied feature CSS, express the system.

## 8. Accessibility, provisional decisions and evidence

Keep native safe areas, keyboard dismissal, visible focus, descriptive names,
44-point touch targets, readable contrast, bounded scroll and 2× text usable.
At narrow widths primary content becomes one column without horizontal overflow.
Long names and real errors must not crowd essential controls.

Home composition and final mobile layout remain `visual_pending`. That is not
permission to retain integration scaffolding. Settings only includes current
appearance/language/runtime functions, not every pictured later feature.
No fixture result, screenshot-only styling or generated image proves behavior.
Evidence uses current normal native surfaces, approved targets, source identities
and a separate independent rendered assessment.
