# Reader departure and nested reset gate review

Source: `98f4f1f8..c78ef60b4a0620356f920c29f401070f9e0df75d`.
Reviewer: `st_01a18c8a`, `omo-native-gate-reviewer`,
`chatgpt-subscription/gpt-6.1-sol`. Date: October 30, 2026.

Verdict: **APPROVE**, with no concrete scoped NAV-02 blocker.

The reviewer inspected the five changed files, relevant persistence/router
internals, cited logs and two captures. The review found that departure reuses
existing persistence, serializes attempts and guards action replay by source
identity. Patch upgrade handling retains version/hash/drift checks.

The direct overfit/code-quality review found no weakened assertions,
tautological tests, duplicate authority or unnecessary extraction. New tests
exercise failure recovery, retained Material drafts and restart persistence.
The reviewer inspected evidence reporting 89 tooling, 202 client/owner and the
corrected 110 browser tests passing. No workloads were rerun or files written.

Evidence: `/tmp/mlearn-ci-independent.6EaZ3F/reader-back-final.log`,
`reader-back-fixed-width.log` and `reader-back-fixed-width-results/`.
Root inspected all four final desktop/narrow failure/restored-draft captures.
The earlier resize-related test timeout remains recorded in STATE and its log;
it is not passing evidence.

The locked review checkout was
`/tmp/mlearn-ci-independent.6EaZ3F/reader-back-c78ef60b`.
This verdict covers only the named increment. Separate code-review skill
coverage was not supplied. OS-native gesture certification, broader NAV-02/M10,
M11 integration and maintainer acceptance remain open.
