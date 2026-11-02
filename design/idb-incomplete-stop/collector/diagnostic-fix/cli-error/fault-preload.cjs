'use strict';
// Installed in a real Node child process. Only the explicitly named synthetic input fd is affected.
// Real reads and crypto are used. Close injection throws AFTER the real close to avoid a leaked test fd.
const fs = require('node:fs'), path = require('node:path');
const original = { open: fs.openSync, read: fs.readSync, close: fs.closeSync, writeFile: fs.writeFileSync };
const file = path.resolve(process.env.CLI_FAULT_FILE), mode = process.env.CLI_FAULT_MODE;
const trace = { mode, file, model: 'JS fs API fault injection; not real OS EIO; hash is not mocked', events: [] }, handles = new Map();
const event = (type, extra = {}) => trace.events.push({ type, ...extra });
function injected(stage, long = false) {
  const error = new Error(`EIO injected ${stage} failure${long ? ' ' + '\u{1f642}'.repeat(9000) : ''}`); error.code = 'EIO';
  event(`${stage}.throw`, { code: error.code, messagePrefix: error.message.slice(0, 80), messageCodePoints: [...error.message].length, injected: true }); return error;
}
fs.openSync = function (name, ...args) {
  if (typeof name !== 'string' || path.resolve(name) !== file) return original.open.call(fs, name, ...args);
  event('open.call');
  if (['open', 'open-long'].includes(mode)) throw injected('open', mode === 'open-long');
  try { const fd = original.open.call(fs, name, ...args); handles.set(fd, { calls: 0 }); event('open.return', { fd }); return fd; }
  catch (e) { event('open.throw', { injected: false, code: e.code, messagePrefix: e.message.slice(0, 80) }); throw e; }
};
fs.readSync = function (fd, buffer, offset, length, position) {
  const state = handles.get(fd); if (!state) return original.read.call(fs, fd, buffer, offset, length, position);
  const index = state.calls++; event('read.call', { index, offset, requestedLength: length });
  const partial = ['partial-read', 'partial-read-close', 'short-success'].includes(mode);
  if (['read', 'read-close', 'read-long-close'].includes(mode) || (partial && mode !== 'short-success' && index > 0)) throw injected('read');
  const count = original.read.call(fs, fd, buffer, offset, partial && index === 0 ? Math.min(17, length) : length, position);
  event('read.return', { index, bytes: count }); return count;
};
fs.closeSync = function (fd) {
  if (!handles.has(fd)) return original.close.call(fs, fd);
  handles.delete(fd); event('close.call'); original.close.call(fs, fd); event('close.real-completed');
  if (['close', 'read-close', 'partial-read-close', 'read-long-close'].includes(mode)) throw injected('close', mode === 'read-long-close');
  event('close.return');
};
process.on('exit', code => { trace.processExitCode = code; original.writeFile.call(fs, process.env.CLI_FAULT_TRACE, JSON.stringify(trace, null, 2) + '\n'); });
