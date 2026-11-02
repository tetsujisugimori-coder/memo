"use strict";
// PoC only: same-origin, one IndexedDB partition, one fixed schema.
// This ledger never claims that terminate/timeout/page closure released a resource.
globalThis.SharedWorkerLedger = (() => {
  const STATES = new Set(["reserved", "running", "invalidated", "stop_requested", "unknown"]);
  function validate(record, capacity) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || !record || record.version !== 1 || record.capacity !== capacity || !Array.isArray(record.slots) ||
        record.slots.length > capacity || record.slots.some(s => !s || typeof s.id !== "string" ||
        !s.id || typeof s.owner !== "string" || !s.owner || !STATES.has(s.state)) ||
        new Set(record.slots.map(s => s.id)).size !== record.slots.length) throw new Error("ledger_invalid");
  }
  async function createFixture(name, capacity) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("capacity_invalid");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("ledger");
        store.put({ version: 1, capacity, slots: [] }, "state");
      };
      request.onsuccess = () => { const db = request.result; db.close(); resolve(); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("fixture_blocked"));
    });
  }
  async function openExisting(name) {
    return new Promise((resolve, reject) => {
      let missing = false, settled = false;
      const request = indexedDB.open(name);
      const timer = setTimeout(() => { settled = true; reject(new Error("ledger_timeout")); }, 3000);
      request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
      request.onsuccess = () => { if (settled) { request.result.close(); return; } settled = true; clearTimeout(timer); if (missing) { request.result.close(); reject(new Error("ledger_missing")); } else resolve(request.result); };
      request.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(missing ? "ledger_missing" : "ledger_unavailable")); } };
      request.onblocked = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error("ledger_blocked")); } };
    });
  }
  async function transact(name, capacity, operation) {
    const db = await openExisting(name);
    try {
      return await new Promise((resolve, reject) => {
        let answer, error, settled = false;
        const tx = db.transaction("ledger", "readwrite"), store = tx.objectStore("ledger"), get = store.get("state");
        const timer = setTimeout(() => { if (settled) return; settled = true; try { tx.abort(); } catch {} reject(new Error("ledger_timeout")); }, 3000);
        get.onsuccess = () => {
          if (settled) return;
          try { validate(get.result, capacity); answer = operation(get.result); store.put(get.result, "state"); }
          catch (e) { error = e; tx.abort(); }
        };
        tx.oncomplete = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(answer); } };
        tx.onabort = tx.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(error || new Error("ledger_unavailable")); } };
      });
    } finally { db.close(); }
  }
  async function reserve(name, capacity, owner) {
    if (typeof owner !== "string" || !owner) throw new Error("owner_invalid");
    return transact(name, capacity, state => {
      if (state.slots.length >= capacity) return { status: "capacity_unknown", available: 0 };
      const id = crypto.randomUUID(); state.slots.push({ id, owner, state: "reserved" });
      return { status: "reserved", id };
    });
  }
  async function transition(name, capacity, owner, id, next) {
    const allowed = { reserved: ["running", "unknown"], running: ["invalidated", "unknown"],
      invalidated: ["stop_requested", "unknown"], stop_requested: ["unknown"], unknown: [] };
    return transact(name, capacity, state => {
      const slot = state.slots.find(s => s.id === id && s.owner === owner);
      if (!slot || !allowed[slot.state]?.includes(next)) throw new Error("transition_invalid");
      slot.state = next; return { status: next };
    });
  }
  async function inspect(name, capacity) {
    return transact(name, capacity, state => ({ slots: state.slots.map(s => ({ ...s })), capacity }));
  }
  // Only a reservation that has not entered running can be returned. The ID is
  // unique per acquisition; a repeated or stale release cannot touch another.
  async function releaseReserved(name, capacity, owner, id) {
    if (typeof owner !== "string" || !owner || typeof id !== "string" || !id) throw new Error("owner_invalid");
    return transact(name, capacity, state => {
      const index = state.slots.findIndex(s => s.id === id);
      if (index < 0) return { status: "already_absent" };
      const slot = state.slots[index];
      if (slot.owner !== owner) throw new Error("owner_mismatch");
      if (slot.state !== "reserved") return { status: "release_unconfirmed" };
      state.slots.splice(index, 1);
      return { status: "released_before_creation" };
    });
  }
  async function start(name, capacity, owner, factory) {
    const allocation = await reserve(name, capacity, owner);
    if (allocation.status !== "reserved") return allocation;
    await transition(name, capacity, owner, allocation.id, "running");
    try { return { status: "running", id: allocation.id, worker: factory() }; }
    catch (error) {
      try { await transition(name, capacity, owner, allocation.id, "unknown"); } catch {}
      throw error;
    }
  }
  globalThis.SharedWorkerLedger = { createFixture, reserve, transition, inspect, start, releaseReserved };
  return globalThis.SharedWorkerLedger;
})();
