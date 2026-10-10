"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { MAX_HISTORY, TTL_MS, REQUEST_ID_PATTERN, exactKeys, fault } = require("./dummy-preview-queue.js");
const MAX_HISTORY_BYTES = 1024 * 1024;
const checksum = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const defaultDirectory = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Memo-Nexus", "received-history");
function validateHistory(records) {
  const ids = new Set(), itemIds = new Set(), noteIds = new Set(), attempts = new Set();
  if (!Array.isArray(records) || records.length > MAX_HISTORY) throw fault("history_corrupt", 503);
  let active = 0;
  function valid(record, parent) {
    if (!record || typeof record !== "object") throw fault("history_corrupt", 503);
    const multiple = Object.hasOwn(record, "items"), planned = Object.hasOwn(record, "savePlan");
    const keys = ["request", "state", "receivedAt", "expiresAt", ...(!parent ? ["digest"] : []), ...(multiple ? ["items"] : []), ...(planned ? ["savePlan", "attemptId"] : [])];
    const reqKeys = ["formatVersion", "requestId", ...(multiple ? [] : ["dummy"]), ...(parent ? ["itemId"] : [])];
    if (!exactKeys(record, keys) || !exactKeys(record.request, reqKeys) || record.request.formatVersion !== 1
      || typeof record.request.requestId !== "string" || !REQUEST_ID_PATTERN.test(record.request.requestId)
      || !Number.isSafeInteger(record.receivedAt) || record.receivedAt < 0 || !Number.isSafeInteger(record.expiresAt)
      || record.expiresAt - record.receivedAt !== TTL_MS || (!multiple && typeof record.request.dummy !== "boolean")) throw fault("history_corrupt", 503);
    if (!parent) {
      if (ids.has(record.request.requestId) || !/^[a-f0-9]{64}$/.test(record.digest)) throw fault("history_corrupt", 503);
      ids.add(record.request.requestId);
    } else {
      if (record.request.requestId !== parent.request.requestId || record.request.dummy || typeof record.request.itemId !== "string" || !REQUEST_ID_PATTERN.test(record.request.itemId)
        || itemIds.has(record.request.itemId) || record.receivedAt !== parent.receivedAt || record.expiresAt !== parent.expiresAt) throw fault("history_corrupt", 503);
      itemIds.add(record.request.itemId);
    }
    if (multiple) {
      if (parent || planned || !Array.isArray(record.items) || record.items.length < 1 || record.items.length > 5) throw fault("history_corrupt", 503);
      record.items.forEach((item) => valid(item, record));
      const unresolved = record.items.some((item) => ["queued", "saving", "save_failed"].includes(item.state));
      if (!(record.state === "queue_full" && record.items.every((item) => item.state === "queue_full"))
        && record.state !== (unresolved ? "queued" : "completed")) throw fault("history_corrupt", 503);
    } else {
      if (!["queued", "saving", "save_failed", "saved", "rejected", "expired", "queue_full"].includes(record.state)
        || (["saving", "save_failed", "saved"].includes(record.state) && !planned)
        || (planned && (record.request.dummy || !["saving", "save_failed", "saved", "rejected"].includes(record.state)))) throw fault("history_corrupt", 503);
    }
    if (planned) {
      if (!exactKeys(record.savePlan, ["noteId", "collectionId"]) || typeof record.savePlan.noteId !== "string" || !REQUEST_ID_PATTERN.test(record.savePlan.noteId)
        || typeof record.savePlan.collectionId !== "string" || !record.savePlan.collectionId || record.savePlan.collectionId.length > 200
        || typeof record.attemptId !== "string" || !REQUEST_ID_PATTERN.test(record.attemptId) || noteIds.has(record.savePlan.noteId) || attempts.has(record.attemptId)) throw fault("history_corrupt", 503);
      noteIds.add(record.savePlan.noteId); attempts.add(record.attemptId);
    }
    if (!parent && (record.items || [record]).some((item) => ["queued", "saving", "save_failed"].includes(item.state))) active++;
  }
  records.forEach((record) => valid(record));
  if (active > 1) throw fault("history_corrupt", 503);
  return records;
}
async function openHistory({ directory = defaultDirectory(), io = fs } = {}) {
  // Canonical path also makes aliases use the same OS-held loopback lock.
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  directory = fs.realpathSync(directory);
  if (process.platform === "win32") {
    // Replace the directory DACL, including pre-existing explicit grants.
    // Pass paths as data through the environment, never as PowerShell source.
    const permissionScript = "$ErrorActionPreference = 'Stop'; $taskSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; $taskAcl = [System.Security.AccessControl.DirectorySecurity]::new(); $taskAcl.SetOwner($taskSid); $taskAcl.SetAccessRuleProtection($true, $false); $taskRule = [System.Security.AccessControl.FileSystemAccessRule]::new($taskSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow); $taskAcl.AddAccessRule($taskRule); [System.IO.Directory]::SetAccessControl($env:MEMO_HISTORY_PERMISSION_PATH, $taskAcl)";
    try { execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", permissionScript], {
      windowsHide: true, stdio: "pipe", env: { ...process.env, MEMO_HISTORY_PERMISSION_PATH: directory }
    }); } catch { throw fault("history_permissions", 503); }
  } else if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  const canonical = process.platform === "win32" ? directory.toLowerCase() : directory;
  const port = 20000 + (parseInt(createHash("sha256").update(canonical).digest("hex").slice(0, 8), 16) % 30000);
  const lock = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    lock.once("error", () => reject(fault("history_locked", 503)));
    lock.listen({ port, host: "127.0.0.1", exclusive: true }, resolve);
  });
  const file = path.join(directory, "history.json"), temporary = path.join(directory, "history.next");
  let records = [];
  try {
    if (io.existsSync(file)) {
      if (io.statSync(file).size > MAX_HISTORY_BYTES) throw fault("history_corrupt", 503);
      const envelope = JSON.parse(io.readFileSync(file, "utf8"));
      if (!exactKeys(envelope, ["version", "records", "checksum"]) || envelope.version !== 1 || envelope.checksum !== checksum(envelope.records)) throw fault("history_corrupt", 503);
      records = validateHistory(envelope.records);
    } else if (io.existsSync(temporary)) {
      // A first commit may have failed before publication: never silently start fresh.
      throw fault("history_corrupt", 503);
    }
  } catch { lock.close(); throw fault("history_corrupt", 503); }
  function commit(next) {
    validateHistory(next);
    const bytes = JSON.stringify({ version: 1, records: next, checksum: checksum(next) });
    if (Buffer.byteLength(bytes) > MAX_HISTORY_BYTES) throw fault("history_capacity", 503);
    let descriptor;
    try {
      descriptor = io.openSync(temporary, "w", 0o600);
      io.writeFileSync(descriptor, bytes); io.fsyncSync(descriptor); io.closeSync(descriptor); descriptor = undefined;
      io.renameSync(temporary, file);
      if (process.platform !== "win32") {
        const dir = io.openSync(directory, "r");
        try { io.fsyncSync(dir); } finally { io.closeSync(dir); }
      }
    } catch {
      if (descriptor !== undefined) try { io.closeSync(descriptor); } catch { /* fail closed */ }
      throw fault("history_write_failed", 503);
    }
  }
  // Establish an empty, checksummed journal before accepting the first request.
  try { if (!io.existsSync(file)) commit([]); }
  catch (error) { lock.close(); throw error; }
  let closing;
  return { records, commit, directory, close: () => closing ||= new Promise((resolve) => lock.close(resolve)) };
}
module.exports = { openHistory, validateHistory, defaultDirectory, MAX_HISTORY_BYTES };
