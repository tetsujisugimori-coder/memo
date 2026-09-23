"use strict";

const { performance } = require("node:perf_hooks");

function createE2eTiming(suite, filter = "", reproduceCommand = "npm run test:e2e:chart -- --feature") {
  const started = performance.now();
  const results = [];
  let current = null;

  function duration(from) {
    return `${((performance.now() - from) / 1000).toFixed(1)}s`;
  }

  function beginStep(name) {
    if (!current) throw new Error("An E2E feature must be active before a step");
    endStep();
    current.step = { name, started: performance.now() };
    console.log(`[START] ${suite} > ${current.name} > ${name}`);
  }

  function endStep() {
    if (!current?.step) return;
    console.log(`[PASS] ${suite} > ${current.name} > ${current.step.name} ${duration(current.step.started)}`);
    current.step = null;
  }

  async function feature(name, run) {
    if (filter && name !== filter) return;
    const entry = { name, started: performance.now(), step: null };
    current = entry;
    console.log(`[START] ${suite} > ${name}`);
    try {
      await run({ beginStep, endStep });
      endStep();
      results.push({ name, status: "PASS", duration: duration(entry.started) });
      console.log(`[PASS] ${suite} > ${name} ${duration(entry.started)}`);
    } catch (error) {
      const failedAt = entry.step ? ` > ${entry.step.name}` : "";
      results.push({ name, status: "FAIL", duration: duration(entry.started) });
      console.log(`[FAIL] ${suite} > ${name}${failedAt} ${duration(entry.started)}`);
      console.log(`Reproduce: ${reproduceCommand}${reproduceCommand.endsWith("--feature") ? ` ${name}` : ""}`);
      throw error;
    } finally {
      current = null;
    }
  }

  function summary() {
    for (const entry of results) console.log(`[RESULT] ${suite} > ${entry.name} ${entry.status} ${entry.duration}`);
    console.log(`[TOTAL] ${suite} ${duration(started)}`);
    if (filter && results.length === 0) throw new Error(`Unknown E2E feature: ${filter}`);
  }

  return { feature, summary };
}

module.exports = { createE2eTiming };
