'use strict';
// Diagnostic only: synchronous writes preserve this process's observed order,
// but can perturb timing and do not guarantee durable storage.
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
let seq = 0;
function trace(type, details = {}) {
  const file = process.env.CHART_STAGE4_TRACE;
  if (!file) return;
  try {
    fs.appendFileSync(file, JSON.stringify({id:`${process.pid}:${++seq}`, pid:process.pid, origin:'child', monoMs:performance.now(), utc:new Date().toISOString(), type, ...details})+'\n');
  } catch (_) { /* Missing records remain UNKNOWN. */ }
}
module.exports = {trace};
