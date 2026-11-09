"use strict";
// Stage #436-B opt-in observability. No production module, writer or timer changes.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");

function describeDurations(events, begin, end) {
  const starts = new Map(), durations = [];
  for (const e of events) {
    if (e.event === begin) starts.set(e.key, e.monoMs);
    if (e.event === end && starts.has(e.key)) {
      durations.push(Math.max(0, e.monoMs - starts.get(e.key)));
      starts.delete(e.key);
    }
  }
  durations.sort((a, b) => a - b);
  return { count: durations.length, pending: starts.size,
    maxMs: durations.length ? durations[durations.length - 1] : null,
    p95Ms: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : null };
}
function summarize(events) {
  return {
    http: describeDurations(events, "http:received", "http:finish"),
    route: describeDurations(events, "route:start", "route:end"),
    browser: { snapshots: events.filter(x => x.event === "browser:snapshot").length },
    host: { samples: events.filter(x => x.event === "host:sample").length, windowsCounters: events.filter(x => x.event === "win:counters").length },
    rootCause: "UNKNOWN", productAcceptance: "SEE_UNCHANGED_RESULTS_JSON",
  };
}
function safePath(url) {
  try { const u = new URL(url, "http://127.0.0.1"); return u.pathname; }
  catch { return "INVALID_URL"; }
}
function install({ support, playwright, dir }) {
  const mode = process.env.I436B_MODE || "full";
  const include = name => mode === "full" || mode.split(",").includes(name);
  const events = [];
  let drops = 0, nextId = 0;
  const maxEvents = 18000;
  const mark = (event, fields = {}) => {
    if (events.length >= maxEvents) { drops++; return; }
    events.push({ event, monoMs: performance.now(), epochMs: Date.now(), ...fields });
  };
  const lag = monitorEventLoopDelay({ resolution: 20 });
  const started = new Date().toISOString();
  const initialCPU = process.cpuUsage();
  const initialHost = { freeMemory: os.freemem(), totalMemory: os.totalmem(), platform: process.platform, release: os.release() };
  lag.enable();
  const tick = setInterval(() => {
    if (!include("host")) return;
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage(initialCPU);
    mark("host:sample", { freeMemory: os.freemem(), rss: mem.rss, heapUsed: mem.heapUsed,
      nodeUserCpuMs: cpu.user / 1000, nodeSystemCpuMs: cpu.system / 1000,
      nodeEventLoopLagMaxMs: lag.max / 1e6 });
    lag.reset();
  }, 500);
  tick.unref();
  // Windows-native counters are best-effort, asynchronous and deliberately opt-in.
  // Each PowerShell sample is bounded; failure never implies paging was absent.
  let counterTimer;
  if (process.platform === "win32" && include("host")) {
    const { execFile } = require("node:child_process");
    let active = false;
    const command = [
      "$ErrorActionPreference='Stop'",
      "$m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory",
      "$p=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\"",
      "$d=$null",
      "try { $d=Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter \"Name='_Total'\" } catch {}",
      "[pscustomobject]@{pagesPerSec=$m.PagesPersec;pageReadsPerSec=$m.PageReadsPersec;availableMBytes=$m.AvailableMBytes;processorPct=$p.PercentProcessorTime;diskAvgSec=$d.AvgDisksecPerTransfer}|ConvertTo-Json -Compress",
    ].join("; ");
    const poll = () => {
      if (active) return;
      active = true;
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
        { timeout: 5500, maxBuffer: 16384, windowsHide: true }, (error, stdout) => {
          active = false;
          if (error) return mark("win:counters-unavailable", { reason: error.code || error.message });
          try {
            const payload = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
            mark("win:counters", { ...payload });
          } catch (parseError) { mark("win:counters-unavailable", { reason: parseError.message }); }
        });
    };
    counterTimer = setInterval(poll, 8000);
    counterTimer.unref();
    const first = setTimeout(poll, 2000);
    first.unref();
  }
  process.once("exit", () => {
    clearInterval(tick);
    clearInterval(counterTimer);
    lag.disable();
    const output = {
      schema: "issue436b-telemetry-v1", started, finished: new Date().toISOString(),
      mode, process: { pid: process.pid, node: process.version, playwright: require("playwright/package.json").version },
      initialHost, finalHost: { freeMemory: os.freemem(), rss: process.memoryUsage().rss },
      sampleLimit: maxEvents, droppedEvents: drops, clockContract: {
        node: "monoMs=Node performance.now(); epochMs=Date.now(); durations ONLY within this clock",
        browser: "ResourceTiming offsets refer to browser timeOrigin, never subtract from Node monoMs",
        snapshot: "asynchronous after ready/error; cannot assert timeout-instant state",
        windowsPaging: process.platform === "win32" ? "BEST_EFFORT_ASYNC_CIM; failures/missing samples mean UNKNOWN" : "NOT_MEASURED_ON_NON_WINDOWS_HOST"
      },
      summary: summarize(events), events
    };
    try { fs.writeFileSync(path.join(dir, "stage436b-telemetry.json"), JSON.stringify(output, null, 2) + "\n"); }
    catch (error) { process.stderr.write("issue436b telemetry flush failed: " + error.message + "\n"); }
  });
  if (include("http")) {
    const original = support.createServer;
    support.createServer = (...args) => {
      const server = original(...args);
      server.prependListener("request", (req, res) => {
        const key = "h" + (++nextId), urlPath = safePath(req.url);
        mark("http:received", { key, path: urlPath, method: req.method });
        res.once("finish", () => mark("http:finish", { key, path: urlPath, status: res.statusCode }));
        res.once("close", () => { if (!res.writableFinished) mark("http:closed-early", { key, path: urlPath }); });
      });
      return server;
    };
  }
  async function capture(page, label, outcome) {
    if (!include("browser")) return;
    let timer;
    try {
      const info = await Promise.race([
        page.evaluate(() => {
          const entries = performance.getEntriesByType("resource");
          const compact = entries.slice(-450).map(e => {
            let pathname = "INVALID_URL";
            try { pathname = new URL(e.name).pathname; } catch {}
            return { path: pathname, type: e.initiatorType, startMs: e.startTime,
              fetchMs: e.fetchStart, requestMs: e.requestStart, responseStartMs: e.responseStart,
              endMs: e.responseEnd, transferBytes: e.transferSize, durationMs: e.duration };
          });
          const nav = performance.getEntriesByType("navigation")[0];
          return { timeOrigin: performance.timeOrigin, readyState: document.readyState,
            navigation: nav ? { domContentLoadedEndMs: nav.domContentLoadedEventEnd, loadEndMs: nav.loadEventEnd,
              responseEndMs: nav.responseEnd } : null,
            resources: compact, totalResources: entries.length, truncated: Math.max(0, entries.length - compact.length) };
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("browser resource read deadline")), 1500); }),
      ]);
      mark("browser:snapshot", { label, outcome, page: page.__i436 ?? null, info });
    } catch (error) {
      mark("browser:snapshot-unavailable", { label, outcome, error: error.name + ": " + error.message });
    } finally { clearTimeout(timer); }
  }
  if (include("browser")) for (const name of ["openApp", "appReady"]) {
    const original = support[name];
    support[name] = async (page, ...args) => {
      let outcome = "SUCCESS";
      try { return await original(page, ...args); }
      catch (error) { outcome = "ERROR"; throw error; }
      finally { await capture(page, name, outcome); }
    };
  }
  if (include("route") || include("browser")) for (const engine of ["webkit", "chromium"]) {
    const launch = playwright[engine].launch.bind(playwright[engine]);
    playwright[engine].launch = async (...args) => {
      const browser = await launch(...args);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...ctxArgs) => {
        const context = await newContext(...ctxArgs);
        if (include("route")) {
          const routeMethod = context.route.bind(context);
          context.route = (matcher, handler, options) => routeMethod(matcher, (route, request) => {
            const key = "r" + (++nextId), urlPath = safePath(route.request().url());
            mark("route:start", { key, path: urlPath });
            let outcome;
            try { outcome = handler(route, request); }
            catch (error) { mark("route:error", { key, name: error.name }); throw error; }
            return Promise.resolve(outcome).then(value => {
              mark("route:end", { key, path: urlPath }); return value;
            }, error => { mark("route:error", { key, name: error.name }); throw error; });
          }, options);
        }
        return context;
      };
      return browser;
    };
  }
  mark("telemetry:installed", { mode });
  return { mark };
}
module.exports = { install, describeDurations, summarize, safePath };
