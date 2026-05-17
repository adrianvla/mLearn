# renderer Knowledge Base

## OVERVIEW
SolidJS UI layer. Platform-agnostic. All windows, components, hooks, and contexts live here.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add reusable component | `components/common/{Name}/{Name}.tsx` + `.css` → `common/index.ts` |
| Add window | `windows/{name}/` with `{Name}Window.tsx` entry |
| Add hook | `hooks/use{Name}.ts` |
| Add context provider | `context/{Name}Provider.tsx` |
| Add service module | `services/{name}.ts` |
| Add utility | `utils/{name}.ts` |
| Add desktop route | `App.tsx` |
| Add mobile route | `MobileApp.tsx` (HashRouter, wrapped in MobileLayout) |
| Change context nesting order | `App.tsx` or `MobileApp.tsx` root renders |

## CONVENTIONS
- Components: PascalCase directory + files, co-located `.css`, exported via `common/index.ts`
- Hooks: `use` prefix. Return objects or tuples, never raw signals unless simple.
- Contexts: `Provider` suffix, export `use{Name}()` hook that throws if outside tree
- State: `createSignal` for primitives, `createStore` for nested/complex state
- Effects: `createEffect` for reactive side effects, `onCleanup` for disposal
- Platform: `getPlatform()` from `@shared/platform` for OS checks
- IPC: `getBridge()` / `getBackend()` only. Never touch `window.mLearnIPC`.
- Settings: `updateSetting()` from Settings context. Never raw `setStore`.
- Refs: Use Solid `ref` prop. Never `document.querySelector` inside components.
- Themes: `body.theme-{name}` CSS selectors only. No hardcoded colors anywhere.
- Localization: `t('mlearn.Section.Key')` with `{param}` interpolation.

## ANTI-PATTERNS
- Never import `shared/bridges`, `shared/backends`, or `shared/platform.ts` directly. Use helpers.
- Never run side effects during render body. Use `createEffect` or event handlers.
- No inline styles except dynamic positioning where CSS cannot reach.
- No `setInterval` / `setTimeout` unless an external API demands it.
- No hardcoded language-specific logic (JLPT levels, conjugation tables, etc.).
