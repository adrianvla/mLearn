# mLearn — GLM implementation / Astra review workflow

This is a proposed workflow for the curriculum consolidation programme, not authorization to run the entire programme. Pair it with `mlearn_curriculum_consolidation_master_prompt_v2.md` (R01–R21, G01–G06).

## Roles

- **GLM 5.3 Flash in OMP:** repository inventory, bounded implementation, integration, targeted tests, routine repairs, render/interaction checks, and concise handoffs. Use the user's available GLM route; do not invent provider model IDs.
- **Astra:** approve consequential contracts and representative UX before broad implementation; independently review completed, bounded waves. Normal tasks, Medium as a starting setting; High only for a named identity/evidence/migration or other difficult correctness question. These are starting choices based on the user's workload and quota, not benchmark guarantees.
- **User:** accepts the interaction/visual direction and deployment decisions. A model's “looks good” does not replace user acceptance.
- **Relevant teacher/native-language reviewers:** validate representative pilot content and uncertain language grading when needed. Two models agreeing is not linguistic proof.

Keep actual role routing explicit: OMP default/task/smol or analogous worker routes should not silently escalate to Astra through advisor/slow/fallback configuration. Verify the installed harness configuration rather than copying unverified commands. Prefer the user's OMP-native browser/computer tooling; do not add Peekaboo or a collection of MCP servers for tasks already supported.

No blanket claim that GLM or Astra is always superior. Track task outcome, rework and the user's measured quota consumption. Model labels and token count alone do not establish cost or success.

## Per-wave loop

1. Agree the wave's user-visible outcome, R/G IDs, invariants and non-goals. For unsettled contract/UX questions, obtain a small Astra design review BEFORE implementation.
2. Capture a reproducible wave-start baseline, including tracked dirty changes and relevant untracked files. The user must approve the snapshot/checkpoint method. Preserve the real learner profile separately. A bare HEAD comparison is not a valid wave diff when earlier accepted work is uncommitted.
3. GLM implements only the wave, retaining a coherent working session and using repository-authoritative references. Goal mode, if chosen, is scoped to this wave with an explicit stop gate—not the master programme.
4. GLM tests and exercises the actual workflow. Provide code/fixture references and evidence, not a self-congratulatory completion claim. Stop on cross-boundary changes that would alter previously accepted semantics.
5. Pause writers. Astra reviews the frozen wave diff and relevant actual code/data, attempts to falsify the requested invariants and reproduces risk-focused behavior. Production code is read-only during review; temporary diagnostic outputs/builds are allowed in safe locations. Do not let review silently become a new implementation expedition.
6. GLM fixes concrete findings. Astra rechecks changed/risky items, not the entire project from scratch. Reopen a contract only with evidence of contradiction. Escalate unresolved root causes; do not run endless review/repair loops.
7. User accepts the relevant rendered interaction. Record the accepted artifact/baseline and remaining R/G coverage. Proceed to the next wave.

There must be a stable artifact for review. If files change while review runs, the verdict applies only to the captured version, not whatever now happens to be on disk.

## One writer, bounded parallelism

One active writer for shared state/policy/session/UI-owner files. Parallel read-only research, test planning, or disjoint content work can help, but must use agreed contracts and isolated outputs. Do not commission independent German/Japanese/Chinese schedulers or let multiple agents edit the same dirty files.

Do not create worktrees from HEAD and assume they contain uncommitted T2 work. Do not automatically stash, discard, commit or publish user work. Use approved snapshots or serialization where needed.

## Context and quota

The master brief is the requirements record, not the per-turn prompt. One coordinator can read it in full initially. Later tasks load the wave brief, relevant R/G sections, accepted decisions and precise code pointers; the reviewer may follow dependencies when necessary.

Use one small wave folder or existing management convention, not another project-management subsystem. Suggested contents:

- `scope.md`: outcome, relevant requirements, agreed boundaries, baseline reference and acceptance cases.
- `handoff.md`: at most roughly 600 words plus links to diff, changed owners, tests, screenshots/traces, limitations and unresolved questions.
- `review.md`: concrete blockers versus improvements, reproduction and suggested minimal repair; list what was not checked.

Keep full logs and data on disk, not pasted into every session. Preserve a coherent session within a wave; use a clean independent review session without replaying the entire old conversation. Do not rely on hidden memory or cross-provider cache sharing.

Check actual usage before/after an Astra task. Scope/reasoning settings are not guaranteed budget caps. Routine tests can run through GLM/local tooling; Astra should still rerun the important counterexamples rather than trusting logs blindly. Final checks and cross-cutting integration tests remain necessary—saving tokens does not mean skipping validation.

Do not install a giant skill stack or ask every agent to read all architecture documents for every change. Keep durable rules short; link task-specific context.

## Proposed waves (agent may refine dependencies, not silently drop scope)

### Wave 0 — Establish the plan and approval gates
GLM produces current owner/reuse mapping, R/G coverage and curriculum/pair inventory, preserving the dirty baseline. Astra checks the few consequential ownership and language/exam contracts and two card-preserving Home/Practice arrangements. User chooses the visual direction. No production rewrite.

First-class targets: German/CEFR, Japanese/JLPT, Chinese/HSK and supported display-language pairs. Pilot priority is German, optional smaller parallel Japanese, then Chinese. Confirm the German pilot's actual course objectives/provider; no assumption that “CEFR B2” defines one exam.

### Wave 1 — Trust-preserving observations
Reproduce/fix any remaining grammar-state discrepancy and ordinary-hover demotion. Preserve intentional claims, assistance, retractions, identity and explicit rating/chord behavior. Establish or reuse the minimal canonical trace needed to explain a result, and interruption-safe observation contracts without adding a parallel scorer. Include multilingual/pair boundary cases immediately. Gate: opening help does not write a failure or change knowledge; genuine events still do.

### Wave 2 — Card-preserving navigation plus one real practice loop
Implement the accepted grouping without removing fun action cards, live previews or direct resume. Integrate one category → current policy → real activity → canonical evidence → progress loop for German, Japanese and Chinese; include a representative non-English display pair and an existing targeted-output route. No new generator is required to prove the loop. Preserve dictionary-only use and separate useful media windows. Gate: none of the three target languages is only an unused adapter; content coverage is explicitly labelled.

### Wave 3 — Onboarding, return and calibrated use of self-report
Optional quick setup and category/skill sampling, dated qualification provenance, current evidence, and gradual correction of over/underestimated skills. No mass item claims, no compulsory thousands-word resync. Personal timing uses comparable clean attempts and ignores confounded latency. Gate: an old B2 pass is recorded without automatically marking its vocabulary Known; users can start and skip setup.

### Wave 4 — Contextual value, media fit and understandable selection
Integrate learner/media demand, local topic bottlenecks, existing translation/scaffolds and exam/practical goals with the existing policy. Retain the old weighted-level heuristic as an explicit baseline where useful; do not confuse it with comprehension. Add bounded decision/explanation traces and the proposed intensity/momentum behavior. Gate: the same learner can get different explainable priorities for an exam or chosen media; aids improve access without manufacturing unaided mastery.

### Wave 5 — Validated multilingual question/content pipeline
Precise-target generation → contrast-bank assembly → complete-item validation → graded task → canonical evidence. Batch/cache, version content and presentation language, test ambiguous answers/IME/help and invalidation. Deepen real German/Japanese/Chinese banks rather than shipping empty categories. Qualified review of representative language content remains separate from coding review. Gate: each supported real pilot path has useful correct material and honest coverage.

### Wave 6 — Checkpoints, mocks and broader output practice
Provider/version-specific blueprints, appropriate receptive/productive formats, safe assistance and timing, held-out material and post-test repair. Broaden the existing agent/writing/speech integration, not a separate chatbot. Gate: assessment does not adapt covertly to reassure, does not claim official scoring equivalence, and feeds the same learner state without duplicate credit.

### Wave 7 — End-to-end pilot hardening
Cross-wave evidence/identity consistency; supported-pair routing and deep representative semantic tests; live integrations where authorized; offline/partial-support paths; performance, accessibility, long labels/scripts, native window behavior, migration/release assets and real-profile-safe verification. User and German pilot reviewers accept the product before rollout. Japanese/Chinese capability parity remains enforced even when those deployments start later. Map every remaining requirement to completed, explicitly deferred, or blocked evidence.

These are conceptual waves. Split an oversized wave into smaller reviewable user-visible slices; do not turn a wave into a catch-all week of unrelated edits.

## Compact kickoff — GLM, Wave 0

Read AGENTS.md, the v2 master brief and this workflow. Preserve the current dirty tree. Plan only: map actual current owners, unresolved R/G requirements, first-class German/Japanese/Chinese paths and display×learning compatibility. Propose a wave plan and two restrained card-preserving Home/Practice arrangements. Flag any grammar-state/hover-demotion prerequisite with a reproduction path. Do not implement, commit, publish or modify the learner profile. Deliver a concise file/symbol-grounded handoff for a separate Astra review; keep detailed evidence on disk. Stop.

## Compact review assignment — Astra

Review the named wave against its approved scope and baseline. Treat the handoff as an index, not proof. Inspect the actual diff and relevant owners, check the target/display-language contracts, and reproduce risk-focused acceptance cases. Separate code correctness, content correctness and observed UX; test counts alone do not prove any of them. Return concrete blockers with file/symbol references and reproduction, plus nonblocking improvements and unverified paths. Do not modify production code, redesign accepted UX, broaden into a whole-T2 audit or authorize the next wave yourself. Stop after the review.

## Documentation consulted for harness guidance

- OMP tools/model roles: https://github.com/can1357/oh-my-pi
- Codex context, planning and review: https://learn.chatgpt.com/guides/best-practices
- Astra-specific prompt/context guidance: https://learn.chatgpt.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra

Read the installed version's help/config for exact commands and model selectors. These references do not promise model quality, cache hits or quota consumption.
