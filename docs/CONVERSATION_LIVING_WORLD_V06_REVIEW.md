# V06 adversarial review — 14 September 2026

Scope: GLM's completed V06 creation and reasoning-marker wave only. Selective integration and later waves were not implemented. The working diff includes earlier waves; their presence is not V06 completion evidence.

## Verdict on the submitted V06

**Not sound as submitted. The room-linked Thread was an architectural dependency (option 2), not merely a persistent-world encounter record.**

The spec permits existing session machinery (MODEL-01); the failure is observable continuity, not the name `Thread`.

1. **P1 — Adding intent changed journal authority.** Persistent `activateScenario` created a room-linked Thread, and the modal selected its ID. App user messages, memory notes and checker sidecars selected Thread scope from that ID; `runRoomTurn` independently selected Thread scope from `input.thread.id`. Consequently both sides of a persistent-intent exchange bypassed Sea. The V06 ledger's claim that this path wrote Sea replies was incorrect. A production Director → journal → orchestrator regression failed with `{kind:'thread', threadId:...}` instead of `{kind:'sea'}`. This violates SCOPE-02.
2. **P1 — Room return lost the situation and its interaction history.** Clicking a Room deliberately selects no Thread. The compiler only read `thread.scenario`; the Room Sea projection did not contain the Thread exchange. Reload with the same saved Thread could mask this defect; ordinary Room return exposed it. Deleting the Thread also deleted its Scenario and journal. This violates ROOM-04 and DIRECTOR-04.

Room membership and generated permanent identities themselves were correctly stored in Room/world entities. That correct topology did not make the interaction persistent-world activity. Removing `WORLD_CREATE_THREAD` did not eliminate its semantic equivalent: persistent activation recreated the dependency under another entry point.

## Direct repair

- `Room` owns its persistent `scenario` and `scenarioRef`. Persistent activation atomically publishes Room, permanent cast and activation acknowledgement in the existing world save, returning that Room. It creates no Thread.
- `ScenarioActivation` returns the actual Room or sandbox Thread. The creation modal opens Room Sea scope for the former; sandbox selection is unchanged.
- The compiler accepts Room context. Orchestration, text/voice context preparation and the agent context fallback pass it through. Room Details exposes shared Scenario material. Private goals, witness-scoped knowledge and directional relationships still use the same redaction logic; the private owner objective is excluded from individual prompts.
- Scenario state survives ordinary Room selection and persistence reload. No new timer, session wrapper, integration path or scenario-evolution service was introduced.
- Existing saved Threads retain their original read, scope and deletion semantics. Pre-fix V06 persistent-intent Threads are **not automatically converted or admitted into Sea**. This repair applies to new activation; handling those historical records remains an explicit migration decision.

## Verification

- Failing regression before repair: `/tmp/v06-review-red.log`.
- Full suite after repair: **426 passed / 1 skipped files; 6,763 passed / 9 skipped tests**. Both TypeScript configurations pass. Production build passes with the existing chunk-size warning; `git diff --check` passes.
- Domain tests use actual storage, Director activation, compiler and orchestrator, with only model output controlled. They verify Room-owned Scenario publication, retry identity, private goals/knowledge, selected identity preservation, invalid-proposal nonpublication, reload, Sea exchange scope, current roster changes and immutable prior witness sets.
- Mounted App regression verifies two turns across unmount/remount: Scenario facts and permitted private material reach actual prompts, owner-private intent does not, prior speech remains available, events stay in Sea and no Thread is read. A mounted modal regression checks persistent-intent acceptance opens `{roomId, threadId:null}`.
- Canonical sanitization sanity check passes: existing split-stream/final/history/display/human-exemption cases plus a new test proving `save_memory(...)` inside either reasoning convention does not execute. No sanitizer rewrite was needed.

## Native Electron evidence

Real built Electron, actual Ollama `gemma4-e4b-q4:latest`, isolated profile `/tmp/mlearn-v06-review-verified-1789419672354`; no substituted model output. Normal clicks selected persistent scope and existing Rowan, entered garden intent, generated a Director proposal, accepted the preview and sent a message. Then the renderer reloaded, the Room was explicitly selected in the sidebar, and a second message was sent.

Room `room-f21bcf63-4133-448d-9998-276a5afddb60` owns Scenario `7f4d87f0-dd59-44c8-9db4-d701260f03c3`. Persisted topology contains **zero Threads**. The Sea contains one membership event and two user/character exchange pairs. Both character events have only Rowan and the user as witnesses. The second reply recalled basil and rosemary from the first exchange. Neither reply contains reasoning markers. Generated additional cast is fixture-tested; this native run generated a situation around an existing person.

Evidence: `/tmp/v06-review-verified.json`, `/tmp/v06-review-verified.png`, harness `/tmp/living-world-v06-review-native.cjs` (run argument `verified`). Earlier harness attempts are not exchange proof: one selected the wrong input/preview label; another used Enter instead of the composer Send button. The successful run uses explicit Send clicks and assertions against persisted event counts and scopes.

## Bounded conclusion and remaining limits

**New persistent-intent creation now uses first-class Room/world behavior for V06's foreground creation/return scope.** This is not full Living World acceptance. Foreground participation still uses the current Room roster as attendance; separate offscreen/voice absence and read-access semantics are not certified. Scenario evolution/conclusion, full source/time grounding and campaigns remain later work. Initial membership journal writes still follow the atomic entity save rather than sharing a crash-safe transaction; that is a recorded provenance gap, not proof of complete event atomicity. No A01–A45 case is globally closed, and selective integration remains untouched.
