# Chart WebKit Infinity investigation (Issue #449)

Status: investigation in progress; no root-cause or repair claim.

## Fixed subjects and original failure

- Main: `08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d`, tree `bc6709ee93d44d8722ac653ef9cd960d99b93c03`.
- PR #448: `a581cb66cb0dc4889ff8ce3434c1edad88546431`, tree `51298dab411abe16f02f52d0c021ec506d1e5216`.
- [Original run](https://github.com/tetsujisugimori-coder/memo/actions/runs/42947740643/job/130284500412): Playwright1.62.1, WebKit26.5/build2336, Ubuntu26.04.1, Node22.
- Original `chart-block.e2e.js:1620` requires both invalid-input focus and finite-number error. At timeout, chart order was January/March/February and all three series followed that order. Status reported successful February move. Error text predicate was false. Actual focus, input DOM value, input event ordering and exact wait-start were not captured by that original job.
- Original chart failure log is preserved verbatim in `raw/job-130284500412.log`; it includes the complete model snapshot and stack. No chart screenshot/trace artifact was listed for this failed job. The logged state is sampled after timeout, not the state immediately before timeout.

## Hypotheses and finite plan

1. Prior successful move writes model immediately but defers focus/status via requestAnimationFrame. Test line1614 waits only model order. Its next fill may overlap the deferred focus transfer. Predictions: the numeric field receives focus but loses it before beforeinput/input; Infinity does not reach the field; the following move sees the previous finite value.
2. Infinity reaches the DOM but a later editor rebuild discards it. Predictions: input event carries Infinity, then the node is detached/replaced before click; detailed mutation/focus records identify the sequence.
3. Validator or move handler sees Infinity and erroneously accepts it. Predictions: same live input remains Infinity at click capture, yet chart moves. Static code currently contradicts this path, so direct event evidence is required.
4. Save/render scheduling or PR448 changes expose a race. Compare fixed sources in the same environment. Equal success/failure is not proof of causal independence; failure limited to one SHA is not proof of causation.
5. Instrumentation changes outcome. Compare none (no during-action browser observation), light (passive event records) and detailed (also focus wrapper/mutation records). A few runs are not statistical equivalence.

Initial comparison budget: two repetitions per SHA per mode on WebKit (12 trials) and one uninstrumented Chromium control per SHA. Stop repeating this matrix after budget exhaustion. A single targeted semantic-boundary or deterministic diagnostic experiment may follow only to test a supported mechanism. No timeout extension or weakened assertion.

Every formal diagnostic trial uses the unchanged full `chart-multi-series` feature, same synthetic fixture, 1100x820 initial viewport, original30s waits. Sources, package lock and test hashes are recorded. Fresh context and task-owned TMPDIR are used. Diagnostic output is outside tested checkout to avoid recursive `node --test` inclusion. Process180s bound is an outer safety cap, not a changed application/test wait.

## Limits and boundaries

Local comparison uses Debian13, not original Ubuntu26.04.1; official CI comparison is separate. The pinned WebKit2336 downloaded successfully from Playwright's official fallback mirror. Local Chromium downloads returned invalid ZIP responses and are recorded as environment setup failures, not product test failures. The existing shared `/tmp` was nearly full and was not cleaned or moved. No real user data, real MCP/OAuth, Worker stop/recovery or production adoption.

No product changes yet. PR448 branch untouched. CAS, IndexedDB safety, conflict preservation/recovery, tombstones,280ms autosave and research HOLD unchanged. No merge or public deployment. This evidence PR does not authorize merging PR448.
