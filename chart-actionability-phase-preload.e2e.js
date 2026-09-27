"use strict";

// Diagnostic-only instrumentation for the Playwright 1.62.1 server bundle.
// The source checks fail closed when Playwright changes; normal E2E runs never load this module.
const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const bundlePath = path.join(path.dirname(require.resolve("playwright-core")), "lib", "coreBundle.js");
const originalLoader = Module._extensions[".js"];

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Playwright diagnostic anchor changed: ${before.slice(0, 60)}`);
  return source.replace(before, after);
}

function instrumentCoreBundle(source) {
  // Preserve checkElementStates' order and result. Stable is timed inside that call,
  // then subtracted from the outer actionability interval by the trace collector.
  source = replaceOnce(source,
    "return await injected.checkElementStates(node, elementStates2);",
    `const originalStable = injected._checkElementIsStable;
            let stableMs = 0;
            injected._checkElementIsStable = async function(...args) {
              const stableStarted = performance.now();
              try { return await originalStable.apply(this, args); }
              finally { stableMs += performance.now() - stableStarted; }
            };
            try { return { result: await injected.checkElementStates(node, elementStates2), stableMs }; }
            finally { injected._checkElementIsStable = originalStable; }`);
  source = replaceOnce(source,
    `if (result2)
            return result2;
          progress2.log(\`  element is \${waitForEnabled ? "visible, enabled and stable" : "visible and stable"}\`);`,
    `progress2.log(\`  memo actionability end stableMs=\${result2.stableMs}\`);
          if (result2.result)
            return result2.result;
          progress2.log(\`  element is \${waitForEnabled ? "visible, enabled and stable" : "visible and stable"}\`);`);
  source = replaceOnce(source,
    "const frameCheckResult = await this._checkFrameIsHitTarget(progress2, point);",
    `progress2.log("  memo hit testing start");
          try {
          const frameCheckResult = await this._checkFrameIsHitTarget(progress2, point);`);
  source = replaceOnce(source,
    `hitTargetInterceptionHandle = handle;
        }
        const actionResult`,
    `hitTargetInterceptionHandle = handle;
          } finally {
            progress2.log("  memo hit testing end");
          }
        }
        const actionResult`);
  return source;
}

Module._extensions[".js"] = function loadWithPhaseDiagnostic(module, filename) {
  if (path.normalize(filename) !== path.normalize(bundlePath)) return originalLoader(module, filename);
  Module._extensions[".js"] = originalLoader;
  let instrumented;
  try {
    const version = require("playwright-core/package.json").version;
    if (version !== "1.62.1") throw new Error(`unsupported Playwright ${version}`);
    instrumented = instrumentCoreBundle(fs.readFileSync(filename, "utf8"));
    new vm.Script(instrumented, { filename });
  } catch (error) {
    process.stderr.write(`[ACTIONABILITY_PHASES] instrumentation unavailable: ${error}\n`);
    return originalLoader(module, filename);
  }
  module._compile(instrumented, filename);
};

module.exports = { instrumentCoreBundle };
