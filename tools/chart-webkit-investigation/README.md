# Finite chart multi-series investigation

These diagnostic files run the original `chart-block.e2e.js --feature chart-multi-series` without changing product code, test code, assertions, app functions, timers, rAF, or IndexedDB writers. No browser downloads are performed.

## Run

```sh
node tools/chart-webkit-investigation/run.cjs \
  --source main=/absolute/sources/main --source pr=/absolute/sources/pr \
  --revision main=08572bb --revision pr=a581cb6 \
  --git-repo /absolute/investigation-checkout \
  --node-modules /absolute/investigation-checkout/node_modules \
  --output /absolute/evidence/new-run-directory \
  --browser webkit --modes none,light,detailed --repeats 2
```

The default is two repetitions, sequentially visiting each source and each of `none`, `light`, `detailed`. Use `--browser chromium` for the control. Each run has a fresh TMPDIR, stdout/stderr, UTC start/end, SHA-256 hashes before/after for app.js, chart-block.e2e.js, chart-block-utils.js, typing-derived-ui-scheduler.js, package.json, and package-lock.json, full source-file hash manifest, source content-tree hash, and (when resolvable) requested Git commit and tree IDs. The content manifest excludes `.git`, `node_modules`, and `e2e-artifacts`; Before each trial, those six key files are byte-verified against git show at the requested commit. A mismatch stops execution. The manifest provides hashes for the remaining source files; they are not separately byte-verified against Git. Use an output directory outside source trees. Existing run directories are never overwritten. plan.json lists every planned trial as not_started up front and records progress, including interrupted or unstarted trials. Each run also records OS release, Node version, installed Playwright browser manifest/revisions, and original fixture viewport/default timeout metadata.

The child process group is terminated at 180 seconds by default (`--timeout` can lower, not increase this). A forced kill follows within two seconds if needed. `run.json` distinguishes `passed`, `test_failure`, `startup_failure`, and `controller_timeout`. A timeout can prevent close-time capture; existing logs remain. The controller finishes the finite matrix and exits nonzero if any run fails or any of the six protected file hashes change. This is not an unbounded retry loop.

With no executable option, the installed Playwright browser is used unchanged, suitable for CI. Local compatibility overrides only the browser launch executable:

- `--webkit-executable /absolute/webkit-launch.sh`, or `CHART_DIAG_WEBKIT_EXECUTABLE`.
- `--chromium-executable /absolute/chromium`, or `CHART_DIAG_CHROMIUM_EXECUTABLE`.

For standalone preloading, set `CHART_DIAG_OUTPUT` (a directory), `CHART_DIAG_MODE`, `MEMO_NEXUS_E2E_BROWSER`, and optionally `CHART_DIAG_PW_MODULE` (absolute Playwright module directory), then use `node --require /absolute/preload.cjs chart-block.e2e.js --feature chart-multi-series` from the source root. Set `NODE_PATH` if the source tree does not have its own node_modules. The controller supplies these when `--node-modules` is provided. It clears inherited `NODE_OPTIONS` and unrelated `MEMO_NEXUS_E2E_*` switches to avoid unrelated optional instrumentation or remote-server selection.

## Observation boundaries

- **none:** no browser init script, event listener, mutation observer, focus wrapper, reload capture, or wait wrapper during tested actions. Launch metadata and post-test/pre-close DOM + screenshot capture still occur. This is the least-instrumented control, not a completely unmodified Node process.
- **light:** one init script installs passive capture listeners for beforeinput/input/focusin/focusout/pointerdown/click in chart editors and the source textarea. Records include monotonic browser timestamp, node identity, live value, aria-label, dataset, connectivity, and active element. The in-page buffer is bounded to 6,000 entries per document, with a dropped count; no event causes a Node roundtrip.
- **detailed:** light plus a child-list MutationObserver and main-world HTMLElement.focus wrapper, forwarding the native call with its original receiver/arguments/result. Focus stacks and node replacement data may perturb execution. Playwright's isolated-world internal focus calls need not traverse this main-world wrapper. A Node-only wrapper around waitForFunction records the exact function source and performance-clock start/end when its source contains `2件目の売上の数値`; it calls the original directly, without an extra evaluate or pre-wait await. This does not instrument all waits.

Light/detailed capture a uniquely named JSON snapshot immediately before each explicit `page.reload` to preserve earlier events that a new document would otherwise discard. This adds a Node/browser roundtrip at reload, later than the target wait interval. Close-time capture runs before native page.close in all modes. Screenshots use a 5-second cap. Browser and Node timestamps have separate time origins, both included; do not directly subtract their monotonic clock values without accounting for origins.

Snapshots include chart editor HTML/live fields, parsed source-chart state, active element, status text, scheduler read-only pending getters, and the read-only note-save foundation state when accessible. There are no storage transactions or save/flush calls. Missing global lexical state is reported as unavailable. Capture errors are explicit; an unavailable field is not evidence of an empty state. A close snapshot describes the page at cleanup, not necessarily at the instant a wait timed out.

## Checks performed

- `node --check preload.cjs` and `node --check run.cjs`.
- Real WebKit 26.5 / Playwright 1.62.1 smoke: main document input, targeted wait, reload, and close; verified event buffer, pre-reload JSON, detailed wait timing, browser metadata, final snapshot, and PNG.
- No product or existing-test files edited by these diagnostics.
