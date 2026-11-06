"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { snapshot } = require("./storage-guide.e2e.cjs");

// Test-only binding for a future implemented conflict UI. Absent UI/receipts
// remain absent evidence; this does not install or simulate any product feature.
const PANEL = "[data-memo-conflict]";
const EXPORT = "[data-memo-conflict-export]";

async function captureState(page, noteId, tab) {
  const scope = await page.evaluate(async () => ({ primary: db.name,
    names: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((item) => item.name) : null }));
  const storage = await snapshot(page);
  const ui = await page.evaluate(({ panelSelector, exportSelector, id }) => {
    const panel = document.querySelector(panelSelector);
    const button = panel?.querySelector(exportSelector);
    const visible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none");
    return {
      at: Date.now(), currentId, title: document.querySelector("#titleInput").value, editor: document.querySelector("#editor").value,
      save: noteSaveFoundation.getState(id), badge: document.querySelector("#browserSaveStatusBtn").textContent,
      badgeState: document.querySelector("#browserSaveStatusBtn").dataset.state, pending: pendingMemoSync, notice: saveStatusNotice,
      saveTimerPending: scheduledSaveNoteId === id && saveTimer !== null,
      messages: window.__observedMessages || [],
      conflictUi: { visible: visible(panel), text: panel?.textContent || "", noteId: panel?.dataset.noteId || null,
        requestId: panel?.dataset.requestId || null,
        committedBody: panel?.querySelector("[data-conflict-committed-body]")?.textContent ?? null,
        draftBody: panel?.querySelector("[data-conflict-draft-body]")?.textContent ?? null,
        exportEnabled: visible(button) && !button.disabled },
    };
  }, { panelSelector: PANEL, exportSelector: EXPORT, id: noteId });
  return { ...ui, tab, stored: storage.stores.notes?.find((note) => note.id === noteId), storage, storageScope: scope,
    storageComplete: Array.isArray(scope.names) && scope.names.every((name) => name === scope.primary) };
}

async function capturePair(pages, noteId) {
  // Record read order explicitly; these reads are not claimed to be an atomic
  // cross-tab snapshot or a complete sequence of transaction commits.
  const states = [];
  for (const [index, page] of pages.entries()) states.push(await captureState(page, noteId, index === 0 ? "A" : "B"));
  return states;
}

async function pollOutcome(readPair, { timeout = 10000, interval = 50, stableMs = 200 } = {}) {
  if (![timeout, interval, stableMs].every(Number.isFinite) || timeout <= 0 || interval <= 0 || stableMs < 0 || stableMs >= timeout) throw new Error("Finite positive observation bounds are required");
  const start = performance.now();
  const elapsed = () => performance.now() - start;
  const samples = [];
  let signature, stableSince;
  do {
    let states;
    let readTimer;
    try {
      states = await Promise.race([Promise.resolve().then(readPair), new Promise((_, reject) => {
        readTimer = setTimeout(() => reject(Object.assign(new Error("Persistence/UI read exceeded observation deadline"), { code: "READ_TIMEOUT" })), Math.max(1, timeout - elapsed()));
      })]);
      if (!Array.isArray(states) || states.length !== 2) throw new Error("Persistence/UI read did not return both tabs");
    } catch (error) { return { kind: error.code === "READ_TIMEOUT" ? "timeout" : "execution-error", reason: error.stack, elapsedMs: elapsed(), samples }; }
    finally { clearTimeout(readTimer); }
    const sample = { readOrder: samples.length, observedAt: Date.now(), states };
    samples.push(sample);
    const idle = (s) => s.stored?.id === s.currentId && typeof s.stored.body === "string" && Number.isSafeInteger(s.stored.revision)
      && s.save && ["activeRevision", "pendingRevision", "dirty"].every((key) => Object.hasOwn(s.save, key))
      && s.save.activeRevision == null && s.save.pendingRevision == null && s.saveTimerPending === false;
    const saved = (s) => idle(s) && s.save.status === "saved" && !s.save.dirty && s.badgeState === "saved";
    const stopped = (s) => idle(s) && s.conflictUi.visible && s.badgeState !== "saved";
    const kind = states.every(saved) ? "saved" : states.every((s) => saved(s) || stopped(s)) && states.some(stopped) ? "conflict-stopped" : null;
    const next = kind && JSON.stringify({ kind, states: states.map((s) => ({ record: s.stored, save: s.save, badge: s.badgeState, ui: s.conflictUi })) });
    if (next && next === signature && performance.now() - stableSince >= stableMs) return { kind, elapsedMs: elapsed(), samples, states };
    if (next !== signature) { signature = next; stableSince = performance.now(); }
    if (states.some((s) => s.save?.status === "error" && !s.conflictUi.visible)) return { kind: "execution-error", reason: "Save error without an observable conflict-stop UI", elapsedMs: elapsed(), samples, states };
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (elapsed() < timeout);
  return { kind: "timeout", reason: "No stable committed or conflict-stopped observation before the finite deadline", elapsedMs: elapsed(), samples, states: samples.at(-1)?.states };
}

async function waitForOutcome(pages, noteId, options) { return pollOutcome(() => capturePair(pages, noteId), options); }

async function exerciseRecovery(pages, noteId, output) {
  for (const [index, page] of pages.entries()) {
    const tab = index === 0 ? "A" : "B";
    const before = await captureState(page, noteId, tab);
    if (!before.conflictUi.visible || !before.conflictUi.exportEnabled) continue;
    try {
      const downloaded = page.waitForEvent("download", { timeout: 10000 });
      await page.locator(`${PANEL} ${EXPORT}`).click();
      const download = await downloaded;
      const file = await download.path();
      if (!file) throw new Error("Recovery download did not provide a readable file");
      const text = await fs.readFile(file, "utf8");
      await fs.writeFile(path.join(output, `${tab}-recovered-draft.txt`), text);
      return { action: "export-draft", selector: EXPORT, tab, before,
        download: { fileName: download.suggestedFilename(), text }, after: await captureState(page, noteId, tab) };
    } catch (error) { return { status: "FAILED", tab, before, reason: error.stack }; }
  }
  return { status: "UNAVAILABLE", reason: "No implemented conflict-draft export UI observed. Manual copy is not assumed to be recovery." };
}

module.exports = { captureState, capturePair, waitForOutcome, pollOutcome, exerciseRecovery };
