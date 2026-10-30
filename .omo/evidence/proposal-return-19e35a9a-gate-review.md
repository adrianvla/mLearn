# Proposal Return checkpoint review

- Source: `19e35a9a9132672e2d110d44de54a0e1fa3b7598`.
- Verdict: **APPROVE**, moderate-high confidence for this bounded increment.
- Independent reviewer: `st_01a18bfb`, `omo-native-gate-reviewer`,
  `chatgpt-subscription/gpt-6.1-sol`.
- Review checkout: clean, detached and locked
  `/tmp/mlearn-ci-independent.6EaZ3F/proposal-return-review-19e35a9a`.
- The reviewer read source, tests, existing owners, logs and captures. It ran
  no tests, builds, devices or servers and wrote no files.
- This is not M10 completion, M11 readiness, platform acceptance, visual-parity
  approval or maintainer acceptance. PR44 and PR45 must stay draft/unmerged.

## Reviewed behavior

Proposal Return carries a stable proposal ID, not a renderer-owned anchor.
Reader, Watch and captured-message owners resolve the stored source through
the existing native authority. Reader validates document identity and restores
the exact selection through reload. Watch validates its video identity and
restores the captured subtitle. Messenger displays the captured original.
The initiating Inspector closes only after successful native Return resolution.
The reviewer found no concrete blocking regression, competing store, new
protocol authority, dependency or native implementation.

## Evidence audited

| Scenario | Evidence | Result |
| --- | --- | --- |
| Original missing selection | Task-root `proposal-selection-red.log` | Real Reader regression failed because the selected word stayed transparent |
| Pending proposal Return | `.mlearn/m10/proposal-return-root-qa.json`, `proposal-return-root-pending-{1080,390}.png` | Root omowright GUI restored exactly Children, no stranded Inspector or horizontal overflow |
| Native restart and fresh document | Same manifest, `proposal-return-root-native-restart-{1080,390}.png` | Same pending revision and selected word survived |
| Adjacent management reopening | Same manifest, `proposal-return-root-management-1080.png` | Authored meaning/notes remained unchanged; no generation request |
| Normal product checks | Task-root `proposal-selection-final.log` | Typecheck, architecture lint and fresh export passed |
| Final affected regressions | Task-root `proposal-selection-settled.log` and results | All 40 passed in one invocation, including real source/SQLite flows and separate decoded-media departure |
| Cross-origin captures | Settled-results `watch-proposal-return-{1080,390}.png` and `message-proposal-return-{1080,390}.png` | Destination selection/original restored without the initiating Inspector |
| Preserved polling-driver failure | Task-root `proposal-selection-final.log`, `messenger-poll-final-trace/test.trace` | Earlier 39-pass/1-failure run preserved; exact-request synchronization repaired without weakening cleanup assertions |

Task root is `/tmp/mlearn-ci-independent.6EaZ3F`. The final product export is
`index-a8e5f48bc2d012a3bd23050edd89a00f.js`. The root manual replay closes its
browser, native owner and preview before notification; its genuine pending
proposal profile is preserved at `proposal-return-root-native.vkMSua`.

## Nonblocking limits

- Closed-dialog/route-change races were audited statically, not independently
  executed. The proposal dialog retains its inherited mounted-only completion
  guard; the review does not certify this wider lifetime contract.
- Image proposal Return, native devices, IME and Tauri asset-server behavior
  remain unverified. Source-only Watch proposal captures show unsupported media
  and do not prove decoding.
- Inspector action-rail clipping and cat/CAT lexical alternatives remain visible
  and outside this repair.
- The reviewer could not load the named programming/deslop skills and directly
  checked the corresponding quality concerns instead. It found no blocking
  test tautology, unnecessary abstraction or scope drift.
- The reviewer did not independently query PR status under its no-network
  constraint. Draft/unmerged status is not granted by this verdict.
