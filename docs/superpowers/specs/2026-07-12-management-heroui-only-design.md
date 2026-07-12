# Management Console HeroUI-Only Design

## Goal

Make every interactive surface in `management/frontend` a HeroUI component so the School Console has one visual system and no browser-native form popovers or controls.

## Scope

The rule applies to every management frontend route, including the unauthenticated bootstrap and sign-in routes. It covers buttons, text/password/number inputs, textareas, selects and comboboxes, checkboxes and switches, date pickers, dialogs, confirmation prompts, tabs, menu-like group switching, and CSV import controls. Semantic structure such as headings, paragraphs, tables, lists, labels, and form layout wrappers remains ordinary HTML where it is not itself interactive.

## Architecture

The frontend will use the installed `@heroui/react` component packages directly and centralize recurring form controls in small console components. The shared layer will provide input, select, switch, date-picker, dialog, and action-button wrappers with the accessibility label and controlled-value contracts already used by the pages. Pages continue to own their request state and API calls; they only replace native rendering primitives with those shared HeroUI controls.

HeroUI popovers and dialogs own interaction, focus management, and visual treatment. Existing CSS remains responsible only for page layout, table structure, responsive placement, and non-interactive visual hierarchy. Page CSS must not recreate form control, overlay, or popup behavior.

## User-visible behavior

- Date filters and school-term dates open the HeroUI calendar rather than the operating system/browser picker.
- Policy rule selection uses HeroUI selection controls; setting values use HeroUI inputs, selects, and switches.
- Authentication, user/group, analytics, logging, LLM gateway, and settings forms present HeroUI components with the same labels, validation, keyboard operation, disabled states, and request behavior as before.
- Confirmations and editor overlays use HeroUI modal/dialog primitives instead of hand-rolled dialog markup.
- No visible native select dropdown, checkbox, date picker, or browser-styled input remains in the management frontend.

## Compatibility and accessibility

Existing accessible names are preserved so screen-reader usage and page tests retain their contracts. Components stay controlled by their existing React state. Where HeroUI implements an accessibility synchronization input internally, it is acceptable as an implementation detail, but it must not be the visible UI or invoke the browser-native picker.

## Verification

Each migrated shared component gets focused rendering and interaction tests. Page tests retain request/serialization coverage while mocking shared controls where interaction plumbing is not the page's responsibility. The complete frontend test suite, TypeScript check, and production build must pass. A browser session validates a policy rule selection and date-picker interaction on desktop plus a narrow viewport after the rebuilt frontend is served.
