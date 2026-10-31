# Watch guarded departure review

Source: `1e6c4cf0..c368f4504cd2461312532002f691b791fa87374a`.
Reviewer: `st_01a18c9c`, `omo-native-gate-reviewer`,
`chatgpt-subscription/gpt-6.1-sol`. Date: October 30, 2026.

Verdict: **REQUEST_CHANGES**.

Finding: `WatchScreen.tsx:401-402,432-434` prevents removal but discards
the action while `busy` is true. The existing video-drop operation issues
`router.replace(...)` inside its busy lifetime at `:487-516`. If processed
before busy clears, the successful replacement can be swallowed without replay
or recovery. Coordinate operation-owned replacement with the guard and verify
dropping a second video changes the route/player.

The reviewer found the Home/Back checkpoint evidence otherwise supports
failure retention, Retry, held-save blocking, exact persistence and retained
Material drafts. The final log and both Back failure/pending captures were
inspected. The reviewer applied programming and code-quality review directly
and found no new tautological, deletion-only or implementation-mirroring tests
or unnecessary production extraction.

No writes or workloads were performed by the reviewer. Latest LSP and
OS-native behavior remain unverified; broader gates remain open.

Root response: the real host-drop case passed against the original web
checkpoint (`watch-drop-red.log` is a historical filename, not a red result).
The conditional conflict was not observed there. Handoff now dispatches from
an effect after busy clears, under the originating focus/source identity; the
redundant success reload is removed. The guard and native authorities remain.

The extended case invokes the actual Tauri drop callback, opens a distinct
authored source through Rust, serves its own bytes, checks route/title/media
URI and waits for actual decoding. Export
`ec0e539ea25562acc17e1d7ac4a1ceca` passes typecheck, architecture lint and
all five affected Watch cases in `watch-drop-green.log`. Root inspected the
replacement and failed/held captures; source/test LSP are clean. The earlier
114-case result remains bound to the earlier source. This section records
REQUEST_CHANGES on the original source; the exact-source resolution follows.

## Final resolution: b9f7392e

The same reviewer, `st_01a18c9c`, returned **APPROVE** for exact clean source
`b9f7392ec147461ae7d057bb2e34cceb1e9ffae0`, with no blocking findings.

The reviewer confirmed that replacement waits until busy clears, consumes the
intent once and checks source/focus ownership without bypassing departure.
Success no longer reloads the old source. The host-drop test covers distinct
source identity, route, title, media URI and decoding. Direct programming and
code-quality review found no tautological assertions or unnecessary extraction;
the decoding helper has two real callers.

The reviewer inspected `watch-drop-green.log` and the replacement capture:
typecheck, architecture lint and five affected tests pass. The original
`watch-drop-red.log` also records a pass, so the earlier conditional concern
was not experimentally reproduced. No execution or writes were performed.
Fresh LSP cleanliness was supplied evidence, not independently inspected.
The 114-case run remains bound to `c368f450`; native OS and broader milestone/
maintainer gates remain open.
