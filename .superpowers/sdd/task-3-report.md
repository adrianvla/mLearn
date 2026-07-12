# Task 3 Report: Historical analytics workspace

## Status

Complete.

## Delivered

- Added controlled preset, custom-range, comparison, and granularity filters to the Analytics workspace.
- Replaced the overview's legacy line chart with historical activity and recorded-session charts, visible activity-series switches, and exact history tables.
- Kept learner, content, LLM usage, policy-block, quota, and CSV-export views available under the same selected date range.
- Loaded activity history, LLM usage, and policy blocks independently so an LLM failure leaves recorded activity visible.
- Added responsive workspace styles for filter controls, panels, tables, and activity-series controls.

## TDD evidence

- Added the previous-period comparison page test first and ran it red: it could not find the Comparison control because the previous workspace had no comparison filter.
- Added the minimal workspace integration, then added the panel-isolation regression test.

## Verification

- `cd management/frontend && npm test -- --run src/pages/Analytics.test.tsx src/components/charts` — 8 tests passed.
- `cd management/frontend && npm test` — 20 files, 55 tests passed.
- `cd management/frontend && npm run typecheck` — passed.
- `git diff --check` — passed.

## Review remediation

- The stacked activity chart now renders paired current and comparison stacks, with period keys and exact-table values from both periods.
- Comparison metadata carries `Previous period` or `Previous year` into chart legends and both exact history tables; each cell includes its own bucket dates.
- Restored the scoped `Active learners` summary metric through the existing summary endpoint.
- Custom ranges now share one validation rule: ranges must be positive and at most 366 days. Invalid values show an error, disable CSV export, skip data requests, and retain already-loaded learner/content state.

### Review verification

- Focused analytics/chart tests: 12 passed.
- Full management frontend suite: 21 files, 59 tests passed.
- Typecheck and `git diff --check` passed.

## Pre-1970 validation correction

- Shared custom-range validation now rejects negative `from` or `to` timestamps as well as invalid ordering and duration.
- Regression coverage selects a pre-1970 custom start, confirms the shared error and disabled export, verifies no analytics requests are issued, and retains loaded learner rows.

### Correction verification

- Focused Analytics and filter tests: 8 passed.
- Typecheck and `git diff --check` passed.
