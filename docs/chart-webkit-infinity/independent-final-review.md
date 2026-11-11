# Independent final review: Chart WebKit Infinity investigation

Reviewed final harness commit caf3f697598c606df850cfd9fc94de5b7c704777, current staged evidence packaging, and locally available extracted artifacts for CI run 42960691579. No product/source changes or extra browser trials were made. This review does not assert final-head ordinary CI completion.

## Verdict

PARTIAL / UNKNOWN. The bounded focused-feature comparison is complete and passed. The original failing ordering was not reproduced; root cause and PR448 causal influence remain UNKNOWN. No product fix, weakened assertion, or assertion timeout extension is justified by this evidence.

## Verified counts and identity

- local-matrix: 12 trials, all passed; plan count/status agrees; six protected-file hashes independently match Git blobs before and after.
- ci-initial/webkit: 12 trials, all passed; plan count/status agrees; six protected-file hashes independently match Git blobs before and after.
- ci-initial/chromium: 2 trials, all passed; plan count/status agrees; six protected-file hashes independently match Git blobs before and after.

Subjects match main08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d and PRa581cb66cb0dc4889ff8ce3434c1edad88546431. Protected files are app.js, chart-block.e2e.js, chart-block-utils.js, typing-derived-ui-scheduler.js, package.json, and package-lock.json. This verification covers those six files, not a claim that every repository file was independently compared.

CI metadata confirms Ubuntu26.04.1 LTS, Nodev22.23.4, Playwright1.62.1, WebKit26.5 browser manifest revision2336; Chromium151.0.7922.34. Local runs use Debian13/Nodev24.22.1. CI restores matching original OS/browser/version classes, but does not recreate every timing condition of the failed job.

Recomputed downloaded ZIP SHA256:
- WebKit: 2af89bca6c20c1bbd5378b8725bfb3c12b22c6baed729945c6bfeb95631cd3f3
- Chromium: fec2b0a6b90e71254d28a9a4f3a1848392f930260a98f259709fb22281a97f99

## Event evidence

All eight instrumented CI WebKit trials retain target events in page-1-before-reload-1.json with dropped=0. Light files contain360 events, detailed files654. In every one, prior move fallback focus occurs BEFORE numeric-field focus; Infinity beforeinput/input then reaches the intended numeric node. The following move click refocuses that same node while its value remains Infinity. The unchanged target assertion and following value/order assertions pass. Detailed focus stacks locate the actual rejection handler. No adverse focus overlap or invalid-input-destroying editor rebuild appears in these successful target sequences.

CI event times (document performance.now ms): prior move focus / input focus / Infinity input / rejection refocus:
- main rep1 light: 5382 / 5390 / 5391 / 5446
- main rep1 detailed: 5344 / 5353 / 5354 / 5408
- PR rep1 light: 5456 / 5465 / 5466 / 5511
- PR rep1 detailed: 5392 / 5400 / 5401 / 5458
- main rep2 light: 5490 / 5498 / 5501 / 5547
- main rep2 detailed: 5409 / 5417 / 5418 / 5468
- PR rep2 light: 5366 / 5375 / 5376 / 5431
- PR rep2 detailed: 5414 / 5424 / 5425 / 5478

Uninstrumented WebKit and Chromium controls provide pass outcomes, not missing-event evidence: they intentionally have no during-action event recorder. An empty event list in those modes must not be interpreted as Infinity never arriving.

Original failure evidence establishes changed order January/March/February, associated series moved, success status for February movement, and timeout at the focus-plus-error predicate. It does not establish the original live input value, focus ordering, or node survival before click. These successful captures cannot fill those missing historical observations. The static RAF/fill interference hypothesis remains a hypothesis.

## Harness and packaging review

45-minute CI budget exceeds12×180-second bounded trials plus setup allowance. Upfront plan preserves not_started entries; actual attempted failures have separate outcomes. No assertion/timer/storage-writer mutation found. Detailed focus wrapper catches only recorder failures and preserves native focus return/errors; wait wrapper rethrows original errors. Observation overhead can still perturb timing.

Current preload.cjs and run.cjs bytes match caf3f697 exactly. Staged diff changes only dedicated diagnostic trigger/evidence documents/log packaging. No standard CI check is disabled. Dedicated workflow types:[opened] intentionally prevents docs-only synchronization from rerunning the exhausted finite matrix; it also means future harness changes will not be exercised automatically on this existing PR. That limitation is acceptable for this final docs-only update because harness hashes are unchanged. Any future harness change would need a separately explicit validation plan.

The original WebKit gzip decompresses byte-for-byte to caf3f697's original plain raw log. Its decoded SHA256 is990e65743b1e9d453c4b77313ab5d52f6030ae959b75e4c3d0d50400277821a8. Both gzip headers have mtime0. Chromium decoded SHA256 matches recorded1e4ee154a74a6b8f1ebb1c0dda768d43e7ae4e4a66d8d375c57c3db49c8b6558; no independent prior-commit Chromium plain blob was available for byte comparison. Staged git diff --check passes. Deterministic packaging removes raw-log trailing-whitespace noise without changing the preserved WebKit evidence or relaxing ordinary CI.

## Outstanding classification and NOT_TESTED

No P1/P2 defect found in the reviewed diagnostic harness/evidence. No substantive P3 blocker identified. Final ordinary CI on exact final head remains pending and must be reported separately, not inferred from earlier green diagnostic runs.

NOT_TESTED by this matrix:
- Original full-suite execution/order and earlier-feature/browser-process history. Original log invoked test:e2e:chart:all; comparison invokes only --feature chart-multi-series. A fresh feature context reduces shared page-state risk but does not reproduce process/server/load/order conditions.
- A failing target event sequence, adverse RAF/fill interleaving, or deterministic reproduction of that proposed mechanism.
- A product repair, its regression protection, or production/browser environments outside the recorded matrix.
- Statistical equivalence between sources/modes, or absence of a rare timing race. Two WebKit repetitions per mode per SHA are a finite diagnostic sample, not reliability certification.
- PR448 causal independence; passing both subjects cannot rule out timing effects.
- Comprehensive application full-suite acceptance of PR448 or authorization to merge it.

Recommended closeout wording: focused comparisonC completed; original issue remains nonreproduced with mechanismUNKNOWN; preserve evidence and refrain from speculative product edits. Any further experiment requires a narrowly justified next question rather than unbounded repetition.
