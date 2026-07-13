# Task 7 report: authorized global search

## Status

Implemented the read-only `GET /api/search` route and the management top-bar search control. Results are scoped independently by `members.view`, `group.view`, and `policies.view`; named policies additionally require their group to be visible. Queries are normalized, bounded to 2 through 100 characters, and escaped before `LIKE` matching. The search result surface uses HeroUI `ComboBox.Popover`, `ListBox`, `ListBoxSection`, and `ListBoxItem`; mouse and ArrowDown/Enter selection both navigate, clear the query, and close the overlay.

## Tests

- `cargo test --manifest-path management/backend/Cargo.toml routes::search`
- `npm test -- --run src/components/GlobalSearch.test.tsx` (from `management/frontend`)
- `npm test` (from `management/frontend`)
- `npm run typecheck` (from `management/frontend`)
- `git diff --check`

## Concerns

No open implementation concerns. `cargo fmt --check` reports pre-existing formatting differences across unrelated backend files, so only the new search route was formatted.
