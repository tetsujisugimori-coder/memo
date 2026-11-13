# Independent review — AI diagnostics Stage 1

Initial fixed target: 0a809bf5c448c8c2197189c0a40ed99d9e20fe97
Tree: 99803c1e308544d5344d27fd77c4489b7fc9aff9
Base: 08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d
Reviewer: independent_review (not implementation author)

## Initial findings

1. P1 — startup regression. app.js initialized aiDiagnostics after invoking runGuardedStartup. The real runGuardedStartup calls init synchronously, and init calls renderAiUi before its first await. The new renderer therefore read aiDiagnostics in its temporal dead zone. Independent extraction of the actual init prefix and diagnostic renderer produced `Cannot access 'aiDiagnostics' before initialization` and never reached openDb. This affects ordinary startup, not merely the AI panel. Fixed by moving initialization before startup invocation.
2. P2 — observation changes generation for malformed thinking. New `String(event.message?.thinking || "")` executes outside the observer's exception boundary. A valid NDJSON object with message `{content:"answer",thinking:{toString:null}}`, done:true yielded answer on the base but failed with connection and zero text on the initial candidate, even with no observer. Independent base/candidate execution confirmed this. Fixed with string-only length checks in both complete-line and EOF-tail paths.

## Independent execution

- Initial fixed target: ai-diagnostics, ai-provider, Ollama, Gemini suites: 67/67 PASS, no skip. These existing/new unit tests did not detect startup ordering; that gap is documented rather than treating them as browser startup proof.
- startup-order.cjs: fixed original => failure, openDb not reached; corrected working source => success, openDb reached.
- malformed-thinking.cjs: base => answer; fixed original => connection error, zero answer.
- Added one regression to ai-diagnostics.test.js at implementation author's request. It uses the actual startup/init ordering and real lifecycle helper, with unrelated UI setup stubbed. No implementation file edited by reviewer.
- Corrected working candidate diagnostics suite: 28/28 PASS, no skip (includes implementer's malformed thinking regressions and reviewer's startup-order regression).

## Boundaries

No changed save writer, IndexedDB schema, Worker, MCP, Codex, prompts or model settings in the reviewed diff. Streaming yields and existing user-facing completion semantics are preserved after the two fixes. The existing app still calls empty normal completion completed, and Gemini's existing extraction includes thought-marked text in display; diagnostics classify these separately. These are pre-existing behavior, not fixes promised by Stage 1.

Request callbacks close over distinct records; stale UI results continue to be rejected by the existing app requestId guard. Current mocked delayed-response and consecutive-run tests exercise actual app generation functions. Metadata serialization uses a whitelist; body/question/reference/thinking strings and errors are not copied. Model identifiers remain metadata and should not be interpreted as anonymized values. Age/count/serialized-record bounds and disable/clear invalidate stored handles.

Real Ollama, installed models, real API calls, painted browser UI, and full application startup in an actual browser remain PENDING_MANUAL or NOT_TESTED here. DOM text assignment in the function harness is not proof of painted visibility. Root cause of the user's model symptoms remains UNKNOWN.

Final fixed-commit review pending receipt of the implementation author's corrected commit SHA. No merge approval is given.

## Final fixed implementation review

Corrected fixed target: bb52b287a4e86f71d26f38b56eb25031f94cc76e
Tree: 82f10b599831d30b3c8520a713d244181bb083af

Verified the implementation and test working files equal that commit before independent execution. Compared the entire original-to-corrected implementation diff. Only initialization ordering, guarded thinking length, UI-purpose/language metadata and targeted regressions were added after the original reviewed commit.

- P1 startup ordering: CLOSED. The diagnostic store is initialized with the existing AI state before startup invocation. The independent old/corrected counterexample and committed startup regression establish the previously failing path now reaches openDb in the function harness.
- P2 malformed thinking interference: CLOSED. Both streaming line and EOF-tail paths use string-only length checks. Corrected regression verifies content remains available without an observer, preserving base behavior.
- Independent fixed-target AI regression: 118/118 PASS, fail 0, cancelled 0, skipped 0. This includes the 28 diagnostic tests; those are not additional counts to sum separately.
- Base-to-corrected git diff --check: PASS.
- No remaining P1/P2 found in the reviewed implementation scope. This is bounded source/mock review, not an assertion that all races or models are correct.

Reviewed the pending docs/ai-diagnostics-stage1/README.md and MANUAL.md content separately from the fixed implementation commit. Their UNKNOWN/PENDING_MANUAL statements and distinction between EOF, parsing, DOM assignment and real painted visibility are appropriate. Suggested a copyable fixture-generation command for the manual to avoid requiring users to author their own helper. These pending documents are not claimed as part of bb52b287.

The implementation author reports full suite 2019 total / 1993 PASS / 25 FAIL / 1 cancelled, including sandbox loopback EACCES constraints; this reviewer did not independently rerun that full suite. Remote CI and actual browser/model checks were not executed by this reviewer. Preserve those failures/limitations in the final report and maintain Draft. This review does not authorize merge or claim real Ollama stability.
