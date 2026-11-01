"use strict";
window.runLifecycleControl = async condition => {
  const dbName = `idb-lifecycle-${crypto.randomUUID()}`, life = window.__life;
  life.set({ dbName, iteration: 0 });
  const result = { condition, dbName, outcome: "FAIL", cleanup: { status: "NOT_RUN" } };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function finishOpen(request) {
    const requestInfo = { ...life.state.requests.at(-1) };
    return new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => { expired = true; life.log("upgrade_timeout", requestInfo); reject(new Error("IndexedDB open timeout")); }, 8000);
      request.addEventListener("success", () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); });
      request.addEventListener("error", () => { clearTimeout(timer); reject(request.error); });
    });
  }
  try {
    const first = indexedDB.open(dbName, 1); first.addEventListener("upgradeneeded", () => first.result.createObjectStore("notes"));
    const held = await finishOpen(first);
    life.stage("T7 iteration 1");
    if (condition === "A") held.close();
    const upgrade = indexedDB.open(dbName, 2), completion = finishOpen(upgrade);
    // Attach rejection handling immediately, while the positive-control window is observed.
    completion.catch(() => {});
    if (condition === "B") {
      let blocked = false; const blockedEvent = new Promise(resolve => upgrade.addEventListener("blocked", () => { blocked = true; resolve(); }, { once: true }));
      await Promise.race([blockedEvent, wait(300)]);
      result.positiveControlBlocked = blocked; result.closedAtMs = performance.now(); held.close();
    }
    const db = await completion; result.sameUpgradeRequestCompleted = true; db.close();
    const observed = window.__lifeEvents;
    result.versionchange = observed.some(e => e.event === "versionchange");
    result.outcome = condition === "B" && (!result.positiveControlBlocked || !result.versionchange) ? "FAIL" : "PASS";
    if (result.outcome === "FAIL") result.error = "positive_control_not_established";
  } catch (e) { result.error = e.message; }
  finally {
    await window.__saveBeforeCleanup({ control: result, events: window.__lifeEvents, mainState: life.state });
    result.cleanup = await window.WorkerPocCleanup.deleteDatabaseObserved({ factory: indexedDB, dbName,
      record: (event, details) => life.note(event, details) });
  }
  return result;
};
