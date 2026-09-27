"use strict";

// Run the existing 120-condition tooltip E2E with diagnostic-only Playwright timing.
process.env.MEMO_NEXUS_E2E_BROWSER = "webkit";
if (process.argv.includes("--without-diagnostics")) delete process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
else process.env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES = "1";
process.argv.push("--feature", "chart-tooltips");
require("./chart-block.e2e.js");
