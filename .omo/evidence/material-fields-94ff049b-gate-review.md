# Compact Material fields: bounded web checkpoint

- Candidate: `94ff049b33abf61abcf6c7cec3cbaa01b9ece652`.
- Parent: `7573f474fbecb1d7b4ba1c5f12f6597de33d8120`.
- Reviewer: `omo-native-gate-reviewer`, task `st_01a18b8a`, current subscription
  route `chatgpt-subscription/gpt-6.1-sol`.
- Verdict: **APPROVE - bounded web checkpoint only**. The reviewer did not
  provide a separate confidence label.
- Review used a clean, locked exact-source checkout. It ran no workloads and
  made no source changes. Root verified it clean, then unlocked and removed it.

## Root QA

| Scenario | Observed result | Artifact |
| --- | --- | --- |
| Old fixed field with overflowing Notes | Expected regression: no growth | `/tmp/mlearn-ci-independent.6EaZ3F/material-fields-red.log` |
| Shared role and adjacent behavior | Typecheck, ownership lint, export `86bca5ba1062bf53a3000d7a8000d8c3`, 24 affected tests passed | `material-fields-first-green.log` in the same task root |
| Augmented retained-navigation test | Passed in 3.1 seconds; exact Unicode, growth/shrink, hidden resize, save and actual native restart | `material-fields-hidden.log` in the same task root |
| Real GUI creation/save and light fields | Saved values restored in a fresh browser; desktop/narrow captures inspected | `.mlearn/m10/material-field-root-html-select-driver-error.json`, with earlier creation/save evidence in `material-field-root-select-label-error.json` |
| Dark fields and adjacent ordinary input | 60/200 px compact bounds, internal overflow; ordinary JSON input 180 px | `.mlearn/m10/material-field-root-qa.json` and `material-field-root-appearance-*.png` |
| Native persistence through the browser adapter | Exact authored text and Rust-snapshot `mlearn.dark-quartz` restored after native crash/reload | Same final JSON; `/tmp/mlearn-ci-independent.6EaZ3F/material-root-qa.log`, exit 0 |

The two light manifests retain their late driver failures rather than claiming
their entire commands passed. Unsupported handle, accessible-name and HTML-select
assumptions were corrected materially. The final continuation reused the saved
native profile and did not repeat package installation or Material creation.
All owned browser/native/preview resources closed before notification; independent
process/listener readback was empty. The unchanged resource guard remained safe.

Product source did not change after the first green export. Only the new test
gained hidden-resize assertions before its separate final run. The committed
product/test diff was compared against the audited source before and after commit.

## Independent findings

No blocking violation was found. Meaning, Context and Notes use the shared role;
authored values, callbacks, provenance and persistence ownership remain unchanged.
Ordinary multiline and Messenger retain their previous sizing paths. The reviewer
read complete changed source/tests and relevant Editor, Proposal, Settings and
Messenger callers, logs, the final receipt, and representative light/dark images.

The hidden-resize assertion uses text capped at 200 px at both widths. It detects
collapse but does not prove correct intermediate-height remeasurement after hidden
resizing. No product failure was demonstrated; no speculative mechanism was added.

The reviewer had no separate code-review report or supplied `remove-ai-slops` and
`programming` skills. It directly checked their stated criteria and found no
tautological/deletion-only tests, unnecessary production extraction/normalization,
or scope drift. No additional review panel was created.

## Limits retained

Native TextInput/content-size behavior, IME and automatic caret reveal are
unverified. Disabled/unmounted behavior was source-reviewed, not independently
executed by this reviewer. Intermediate hidden-resize remeasurement is not proved.
Meaning height/font, modal-versus-inline composition and the large narrow header
still differ from the reference. Long reference captures are not paired visual
parity proof.

This approval does not close M10, authorize M11 integration, grant platform or
maintainer acceptance, or erase the recorded M07 Windows/iOS failures.
