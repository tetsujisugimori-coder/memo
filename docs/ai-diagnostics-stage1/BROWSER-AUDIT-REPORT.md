# Browser and diagnostic audit results — 2026-11-14 JST

Overall PARTIAL. Synthetic-service application automation and diagnostic import audit passed within the tested scope. Root cause of real-model symptoms remains UNKNOWN. Keep Draft / merge NO. No production application, prompt, model configuration or save behavior changed.

## Fixed source and results

Tested code HEAD `bd919551b4741cac3f81d4ee00bc5c1d2212b7fc`, tree `a7a0ec9d7c80f9bcfaa8a4d6e573198196ba5e62`. [Dedicated run 43524681395](https://github.com/tetsujisugimori-coder/memo/actions/runs/43524681395) completed successfully in all three jobs. This evidence records that exact HEAD; later documentation/evidence commits do not change the recorded producer HEAD. Assess subsequent CI separately.

| Environment | Unit/mock/import tests | Application scenarios | Request/log comparisons | Browser generation requests |
| --- | --- | --- | --- | --- |
| Ubuntu, Chromium 151.0.7922.34 | 145/145 PASS, skip 0 | 27/27 PASS | 14/14 consistent | 30, no retries |
| Ubuntu, WebKit 26.5 | 145/145 PASS, skip 0 | 27/27 PASS | 14/14 consistent | 30, no retries |
| Windows runner, Chromium 151.0.7922.34 | 145/145 PASS, skip 0 | 27/27 PASS | 14/14 consistent | 30, no retries |

The 145 tests are the unchanged original harness 16, new import/audit 9 and existing AI suite 120; do not add these again or aggregate environment repetitions as new test cases. Each report's 41 rows comprise 27 scenario assertions and 14 metadata comparisons. Browser runs used the unchanged product UI and real loopback HTTP streaming from a dedicated synthetic server, never real Ollama. A/B input expectations include a fixed synthetic note title because the application sends it in selected-text reference messages.

Passed scenarios: A2/B5/C2/D5 with full request-content identity, Japanese/English/Japanese selection, alternate synthetic model, diagnostic OFF/ON, empty/thinking-only/missing-done/malformed/HTTP-error fixtures, Stop during a partial HTTP response, completion while panel is hidden and new conversation reset, delayed old response exclusion, unchanged editor content and no page errors. Visibility is the limited DOM/style/viewport/hit-test observation described in [BROWSER-AUDIT.md](BROWSER-AUDIT.md), not a human visual or semantic review.

Windows PS7 plan parsing, localhost read-only probe and rejection of run without -Execute passed. The raw probe correctly says `platform=win32`, `windowsExecution=PROBE_ONLY`, `ollamaCli=NOT_FOUND`, `service=BLOCKED`, no installed models. Its `browserExecution=NOT_TESTED` describes the probe itself; the separate browser report subsequently establishes the synthetic application run. This does not test the user's Windows installation or real inference.

## Retrieval verification and retained evidence

All three artifact ZIPs were retrieved after the jobs completed. A new Python process checked the GitHub artifact SHA-256, every ZIP entry CRC and each report manifest's full-byte hash/size. Separate Node processes imported all 14 diagnostic records per environment with the strict importer. Reports are retained byte-for-byte in [browser-audit-evidence](browser-audit-evidence/); the combined manifest records their sizes, hashes, source HEAD, run and original artifact digests. Raw answer/prompt/thinking strings and screenshots are not retained. The local Linux 145/145 transcript is also retained, without substituting it for Windows/browser results.

The separate Windows probe JSON has only CRLF line endings normalized to LF for repository whitespace checks. Its original byte size/hash and the normalized file size/hash are both recorded in the combined manifest; the three browser reports remain byte-identical.

## Earlier failures and other workflows

- `92f10bb…`: the first dedicated workflow stopped before jobs, due to its output path context; corrected without changing product behavior.
- [43524274891](https://github.com/tetsujisugimori-coder/memo/actions/runs/43524274891), `e48a5c7…`: Chromium's first translation detected the omitted note title in the test fixture. Corrected the fixture, retaining full payload equality. Ubuntu WebKit's unit step observed 144/145 with the existing expiry-observer test receiving two notifications around a 5ms wall-clock boundary. The test now advances an injected clock before the scheduled callback; the one-notification and empty-store assertions remain. Product timer code is unchanged. Do not reinterpret these earlier runs as PASS.
- [Feature palette 43524681262](https://github.com/tetsujisugimori-coder/memo/actions/runs/43524681262), tested HEAD: Chromium timed out waiting for tablePasteDialog after CSV import, WebKit passed. The same symptom was recorded on a prior baseline HEAD; cause remains UNKNOWN. No retry, timeout relaxation or palette change was made.
- [Palette integration 43524681364](https://github.com/tetsujisugimori-coder/memo/actions/runs/43524681364) passed. [Track A 43524681373](https://github.com/tetsujisugimori-coder/memo/actions/runs/43524681373) failed its unchanged fixed-old-source guard; Track B was conditionally skipped. Overall CI is not claimed all green. Current/final HEAD status belongs in the PR summary separately.

## Remaining

User Windows checkout and its installed service/models, real Ollama/model inference and language quality, real-device Safari, the broader mobile/normal-motion/accessibility matrix and independent review remain NOT_TESTED. Authentication of user-supplied diagnostic producers and independently trusted transport identity are not established by JSON validation or matching hashes. The importer is a local diagnostic tool, not an arbitrary-log upload or automatic public-sharing feature. Real inference still requires a deliberate run with an already installed model; no model/service installation, download or real inference occurred here.
