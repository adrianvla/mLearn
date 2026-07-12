# Management Console HeroUI Dashboard and Shell Design

## Goal

Rebuild the complete management-console shell and dashboard to match the supplied stock HeroUI dashboard reference while preserving every existing management feature and route.

## Visual direction

The supplied HeroUI dashboard screenshot is the selected visual target. The console will use its restrained black background, narrow bordered sidebar, large greeting-style page heading, pill-shaped segmented navigation, compact circular and rounded toolbar actions, four equal metric cards, and balanced two-column analytics panels. The result must feel like a stock HeroUI application rather than a custom theme layered over native controls.

The supplied HeroUI light and dark theme variables become the canonical global theme tokens. Existing hard-coded colors and control-specific CSS will be replaced by HeroUI semantic tokens wherever they affect interactive surfaces, panels, borders, typography, focus, or selection state.

## Shell

The sidebar retains the mLearn brand, signed-in account, selected school scope, every authorized navigation route, and log-out action. Its proportions, row height, selection treatment, dividers, typography, and spacing follow the reference. The top bar becomes a compact HeroUI toolbar while retaining group switching and responsive navigation.

No route, permission check, group-scoping behavior, sign-out behavior, or mobile navigation behavior is removed.

## Dashboard

The dashboard retains all existing school-management data and interactions:

- Overview, Usage, and Security views.
- Seven, thirty, and ninety day periods.
- Refresh behavior.
- Managed users, active learners, LLM requests, policy blocks, token usage, costs, policy enforcement, and recent activity.
- Existing API requests and group scope.

The content is recomposed into the reference hierarchy:

1. Large contextual heading and compact toolbar.
2. HeroUI segmented tabs plus refresh and period controls.
3. Four uniform HeroUI metric cards.
4. Two balanced HeroUI surface cards for learning/LLM activity and school controls.
5. A full-width recent-activity data surface below.

Empty, loading, error, and zero-data states remain clear and occupy the same card geometry as populated states so the layout does not collapse or drift.

## Other routes

Users, Groups, Policies, Analytics, Conversation Logs, LLM Gateway, Settings, Diagnostics, and authentication retain their complete feature sets. They adopt the same shell, surface, field, table, tabs, modal, button, and spacing system. Legacy CSS that assumes native `button`, `input`, or `select` sizing must not override HeroUI component anatomy.

The Policies page specifically fixes the selected policy card height and status alignment. Policy name, state, rule controls, publish workflow, and history remain unchanged.

## Responsive behavior

Desktop follows the supplied wide dashboard. At narrower widths, metric cards collapse from four to two to one column, paired panels stack, toolbar controls wrap without clipping, tables scroll inside their surfaces, and the sidebar becomes the existing mobile drawer. No primary action or selected value may be clipped or pushed off-screen.

## Accessibility and behavior

All controls remain HeroUI components with their existing accessible names. Keyboard focus, selected state, disabled state, dialogs, popovers, and field labels remain visible. The implementation preserves API contracts and authorization behavior; this is a visual and component-structure rebuild, not a backend change.

## Verification

The implementation is complete only when:

- The management frontend tests, TypeScript check, and production build pass.
- Browser QA covers every authorized route at desktop width and the shell/dashboard at a mobile width.
- The browser console has no relevant errors or warnings.
- Dashboard tabs and period selection visibly update state.
- The Policies selected card contains both its name and status inside one aligned border.
- A visual comparison against the supplied HeroUI reference has no unresolved P0, P1, or P2 differences.
- `design-qa.md` records `final result: passed`.
