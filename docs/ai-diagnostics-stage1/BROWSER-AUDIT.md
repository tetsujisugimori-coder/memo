# Application automation and diagnostic import audit

Status at implementation: PARTIAL, root cause UNKNOWN, Draft / merge NO. Production application, prompts, provider settings, save behavior and historical Track A guard are unchanged. This adds a separate test path; it does not implement a product log upload feature.

The completed synthetic-service results, exact tested HEAD and remaining boundaries are recorded in [BROWSER-AUDIT-REPORT.md](BROWSER-AUDIT-REPORT.md).

The subsequent translation-only prompt version 2 candidate and its separate real-model acceptance boundary are described in [TRANSLATION-CANDIDATE.md](TRANSLATION-CANDIDATE.md). Historical note-title payload assertions below belong to prompt version 1; the current browser test checks the version 2 body-only single-reference contract.

## Diagnostic input

`node scripts/ai-stage1-audit.cjs <local-diagnostic.json>` reads an explicitly selected local file with a 64 KiB descriptor-read bound and accepts only the application's diagnostic export array (at most 20 records). It returns a schema summary, never raw input or exception text. No network, writes or model inference. Unknown/missing fields (including arbitrary answer/thinking/error fields), duplicate JSON keys including escaped spellings, duplicate request IDs, malformed UTF-8, bad counters, inconsistent roles, HTTP/stream/done/UI and result contradictions are rejected. The descriptor stays open throughout the bounded read; symlinks are refused where O_NOFOLLOW is supported. Windows does not provide that flag: only regular files are accepted, but path provenance is not authenticated.

The application comparator also requires a one-to-one observation-to-request mapping, matching model/task/language/reference/history/roles/input counts, equal full-request hashes in the direct and browser lanes, finalization and matching visible DOM counts for text. Missing, unexpected, duplicate, hidden or contradictory observations produce INCOMPLETE. Zero rows never count as success. Interrupted/error/stale samples are checked by negative browser scenarios and cannot count as successful application comparison. Reordering records never supplies causality.

CONSISTENT_METADATA means consistency with the supplied observations only. Neither hashes nor schema checking establish producer authenticity; coordinated tampering of both sides is not detected. A trusted independent source of observations is still required. Model identifiers can be private metadata: inspect them before sharing even a schema-valid file. Normalized diagnostics are not automatically safe for arbitrary public upload.

## Real application with a synthetic HTTP service

`node ai-stage1-browser.e2e.cjs` serves the unchanged application on a random loopback port, launches a fresh browser context, and configures that context through the actual settings controls to a dedicated synthetic HTTP endpoint. It never contacts real Ollama, reads an existing browser profile or downloads a model. All off-origin browser requests are fulfilled locally with empty resources. Optional CDN features are outside this test. The only browser API stub is clipboard write capture, used by the real diagnostic-copy button; storage, app generation functions, diagnostics and browser fetch are not replaced.

- A2/B5/C2/D5: independent new conversations versus continuing histories, exact outgoing synthetic messages (including the selected-text reference's fixed synthetic note title) compared with buildAiMessages and direct Node lane; full request hashes, response counts, exported metadata and the actual answer element checked before evidence is retained. The original direct/adapter harness fixture omitted a note title; its old input cannot be treated as identical to an app request containing one.
- Japanese → English → Japanese task selection; alternate **synthetic** installed-model ID; diagnostics OFF/ON with unchanged visible synthetic answers.
- Empty, thinking-only, missing-done, malformed stream and HTTP failure fixtures; negative samples never count as normal completion.
- Actual partial HTTP stream followed by Stop; close while streaming, completion while hidden and explicit new conversation; delayed old response after a new request must not enter new UI. No app request IDs or state are injected.
- Note editor content remains unchanged during generation. No answer-insert/new-note action is invoked. Page errors fail the run.

Visibility here is an automated style, viewport and hit-test check on the real DOM after scrolling the answer into view. It is not a human visual review, screen-reader test, response-language check or model correctness claim. Scope is desktop 1280×800 with reduced motion, not the full mobile/normal-motion matrix. Request association uses sequential explicit sends and copied request IDs, not cryptographic transport identity. Direct and browser response timings/chunk partitions may differ; they receive the same synthetic answer events and identical request contents.

Maximum 40 browser generation requests, no retries. Each UI wait has a 15-second bound and the dedicated CI job has a 10-minute bound. Outputs use a new UUID directory under MEMO_AI_STAGE1_OUTPUT (default: task temporary storage). Only whitelisted diagnostic records, request hashes, counts, fixed scenario labels, source hashes and generic failure categories are retained. No screenshots, raw prompts/answers/thinking or arbitrary exceptions. A manifest supplies full-byte SHA-256 and sizes for the JSON report; verify it after retrieval before archival claims. Incomplete/failing runs retain a failure report and exit nonzero.

## Environments and remaining work

`.github/workflows/ai-stage1-browser.yml` runs the same mock/import/AI tests and application scenario on Ubuntu Chromium, Ubuntu WebKit and Windows Chromium. Windows additionally executes the PS7 wrapper plan, read-only localhost service probe and rejection of run without -Execute. A Windows runner is not the user's Windows installation. Its probe may correctly report no Ollama/service/models, which is not real-inference success.

The current local Linux probe found no Ollama CLI or service/models. Local Chromium startup failed due to an OS socket restriction; the managed browser download returned an invalid archive. Those are execution constraints, not app failures or evidence of model behavior. CI must establish browser results on each submitted HEAD separately. User Windows checkout, its PS7/service permissions, actual installed models, real inference, real language/correctness and real-device Safari remain NOT_TESTED. No real-inference command runs as part of this workflow.
