"use strict";

const { yauzl } = require("playwright-core/lib/utilsBundle");

function readTrace(tracePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(tracePath, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(openError);
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        if (entry.fileName !== "trace.trace") return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            try {
              resolve(Buffer.concat(chunks).toString("utf8").trim().split("\n").map((line) => JSON.parse(line)));
            } catch (error) {
              reject(error);
            } finally {
              zip.close();
            }
          });
        });
      });
      zip.on("end", () => reject(new Error("trace.trace is missing")));
      zip.readEntry();
    });
  });
}

const phases = ["actionability", "stable", "scroll", "hitTesting"];
const round = (value) => Math.round(value * 1000) / 1000;

function summarize(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const totalMs = values.reduce((sum, value) => sum + value, 0);
  const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { count: values.length, totalMs: round(totalMs), maxMs: values.length ? round(sorted.at(-1)) : null,
    averageMs: values.length ? round(totalMs / values.length) : null,
    p50Ms: values.length ? round(percentile(0.5)) : null,
    p95Ms: values.length ? round(percentile(0.95)) : null };
}

function analyzeTrace(events) {
  // Total wait runs from the first resolved-element attempt to the final pointer
  // dispatch boundary. Retry delays and point calculation remain in "other".
  const calls = new Map();
  for (const event of events) {
    if (!event.callId) continue;
    const call = calls.get(event.callId) || { logs: [], before: null, after: null };
    if (event.type === "before" && event.method === "click") call.before = event;
    if (event.type === "after") call.after = event;
    if (event.type === "log") call.logs.push(event);
    calls.set(event.callId, call);
  }
  const results = [];
  for (const [callId, call] of calls) {
    if (!call.before) continue;
    const samples = Object.fromEntries(phases.map((phase) => [phase, []]));
    let firstAttempt = null;
    let lastReady = null;
    let retries = 0;
    let actionabilityStart = null;
    let scrollStart = null;
    let hitStart = null;
    for (const log of call.logs) {
      const { message, time } = log;
      if (message === "attempting click action") {
        if (firstAttempt === null) firstAttempt = time;
      } else if (message === "retrying click action") {
        retries++;
      } else if (message.includes("waiting for element to be visible") && message.includes("stable")) {
        actionabilityStart = time;
      } else if (message.startsWith("  memo actionability end stableMs=")) {
        const stableMs = Number(message.slice("  memo actionability end stableMs=".length));
        if (actionabilityStart !== null && Number.isFinite(stableMs)) {
          const combinedMs = time - actionabilityStart;
          if (stableMs >= 0 && stableMs <= combinedMs) {
            samples.stable.push(stableMs);
            samples.actionability.push(combinedMs - stableMs);
          }
        }
        actionabilityStart = null;
      } else if (message === "  scrolling into view if needed") {
        scrollStart = time;
      } else if (message === "  done scrolling") {
        if (scrollStart !== null) samples.scroll.push(time - scrollStart);
        scrollStart = null;
      } else if (message === "  memo hit testing start") {
        hitStart = time;
      } else if (message === "  memo hit testing end") {
        if (hitStart !== null) samples.hitTesting.push(time - hitStart);
        hitStart = null;
      } else if (message.startsWith("  performing click action")) {
        lastReady = time;
      }
    }
    const failed = Boolean(call.after?.error);
    const end = failed ? call.after?.endTime : lastReady ?? call.after?.endTime ?? null;
    const rawTotalWaitMs = firstAttempt === null || end === null ? null : end - firstAttempt;
    const phaseMs = phases.reduce((sum, phase) => sum + samples[phase].reduce((a, b) => a + b, 0), 0);
    const rawOtherMs = rawTotalWaitMs === null ? null : rawTotalWaitMs - phaseMs;
    results.push({ callId, status: failed ? "failed" : lastReady === null ? "not-ready" : "ready", retries,
      totalWaitMs: rawTotalWaitMs === null ? null : round(rawTotalWaitMs),
      phases: Object.fromEntries(phases.map((phase) => [phase, summarize(samples[phase])])),
      otherMs: rawOtherMs === null ? null : round(rawOtherMs),
      accountingValid: rawOtherMs === null || rawOtherMs >= -0.01 });
  }
  return results;
}

function summarizeCalls(calls) {
  const completed = calls.filter((call) => call.totalWaitMs !== null && call.accountingValid);
  const totals = Object.fromEntries(phases.map((phase) => [phase, {
    ...summarize(completed.filter((call) => call.phases[phase].count > 0)
      .map((call) => call.phases[phase].totalMs)),
    attempts: completed.reduce((sum, call) => sum + call.phases[phase].count, 0)
  }]));
  totals.other = summarize(completed.map((call) => call.otherMs));
  const dominant = Object.entries(totals).filter(([, stats]) => stats.count > 0)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)[0];
  return { clickCount: completed.length, retryCount: completed.reduce((sum, call) => sum + call.retries, 0),
    invalidAccountingCount: calls.filter((call) => !call.accountingValid).length,
    totalWait: summarize(completed.map((call) => call.totalWaitMs)), phases: totals,
    dominantByTotal: dominant ? dominant[0] : null };
}

module.exports = { readTrace, analyzeTrace, summarize, summarizeCalls };
