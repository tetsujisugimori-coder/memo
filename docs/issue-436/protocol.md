# Issue #436 bounded startup investigation

Dependent on Draft #435, source HEAD `478d8b3ea59b242e4ddd5cc82e12b44169223047`.
Legacy source `8f35ca25001ffa031abfd304dd2a5e9a3d9197dd`. No product source changes.
Investigate Windows 1280px AB before expanding conditions. Unreached work is NOT_TESTED.

`node issue436-startup-diagnostic.cjs webkit fixed` runs the unchanged dedicated runner
against a git archive verified byte-for-byte against every JS/CJS/HTML/CSS git blob.
Use `old` for legacy, `chromium` for Chromium, and optional `deep` for synchronous
startup/IDB stamps in served app.js/indexeddb-lifecycle.js. Each run needs a new
I436_OUTPUT directory; existing evidence is never overwritten. Source hashes,
served instrumentation hashes and the diagnostic SHA are retained. No writer,
280ms autosave timer or BroadcastChannel implementation is replaced. No new await
is inserted into product startup. Production files on disk remain untouched.

The original 10s locator deadlines and every acceptance assertion remain intact.
The outer 150s child deadline is process cleanup, never a replacement acceptance
deadline. It stops only its own child tree. Expected old product exit 1 is retained;
the comparison runner establishes RED only with completed execution and proven edit
loss, never from launch/timeout failure. `issue436-comparison.cjs` runs four cases,
sequentially, one per fixed/old × WebKit/Chromium on each OS in the dedicated CI.

The passive observer adds lifecycle/guard observation, console and request logging,
and readonly snapshots after ready/error. Deep adds stamps around init awaits and
open request events. Neither is assumed timing-neutral. The original, uninstrumented
SMOKE run is a separate control. Sync JSONL writes and snapshots may affect scheduling;
differences are correlations unless confirmed by an isolated intervention. Read/screen
capture deadlines themselves can be delivered late under process/resource stalls.
Snapshot request/receipt time is not the exact timeout state. Browser epoch/timeOrigin
and NavigationTiming are preferred over Node event receipt order for page causality.

T0 browser launch; T1 context; T2 page/navigation; T3 DOMContentLoaded; T4 load;
T5 init; T6 open; T7 upgrade/blocked/success/error/versionchange/close; T8 each init
await; T9 guard release; T10 editor/save state; T11 unchanged runner persistence,
reload/reopen/recovery/re-conflict and explicit resolution. A missing event remains
unobserved. The deep open request reference permits readonly pending/done inspection.
Upgrade transactions are observed using native listeners. General writer transactions
are not instrumented; their commit/abort evidence comes from existing tests, not a
claim that every transaction was traced. Page/context counts distinguish page close
from context close. Tab destruction does not prove internal backend connection close.

Synthetic `issue436-transport-probe.cjs webkit` serves 64 inert scripts without app or
IDB, comparing routed zero-page, unrouted zero-page, and routed sentinel-page variants.
Each includes first/second open, reload, close and reopen. It records request/route/server
events plus event loop/heartbeat information. Its COMPLETE is never product acceptance.
Routing disables HTTP cache; therefore its removal changes more than one internal
mechanism and cannot alone identify a browser bug ([Playwright reference](https://playwright.dev/docs/api/class-page#page-route)).

Independent synthetic VM boundary checks use verbatim product functions and real
foundation/conflict modules with fixture DOM/IDB. They do not prove browser scheduling,
quota, PWA/Safari, or real data durability. Diagnostic listener checks ensure pending
request.error is not accessed ([IndexedDB request definition](https://www.w3.org/TR/IndexedDB/#request-api)).

Evidence: local ignored e2e-artifacts/issue436; selected raw evidence is packaged with
SHA256 in docs/issue-436 for repository retention. CI artifacts retain 14 days; exact
expiry and IDs are read back after upload. Prior Windows/Linux reports are historical
evidence, separately labeled. No expiry is promised for local temporary storage.

J2/U-C=UNKNOWN; conditionU=NOT_RUN; executionAuthorization=NOT_GRANTED;
startCondition=BLOCKED; productionWorker=HOLD. Synthetic temporary browser contexts
only. No real MCP/OAuth, production Worker stops/recovery, user data or deployment.
No merge/publication or existing PR/main/research branch changes.

2026-11-08 JST
