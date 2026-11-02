'use strict';
// A document checker only. No browser, worker, IDB, runner or network dependency.
const fs = require('node:fs');
const crypto = require('node:crypto');
const MAX_BYTES = 8 * 1024 * 1024;
const SCHEMA_HASH = '0a8ec40c25dec0d454763bef8b246295c719133c06a2ba7c4049f5daef7e2f7f';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(sortKeys(value));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
  return value;
}
function guards() {
  return { executionAuthorization: 'NOT_GRANTED', startCondition: 'BLOCKED', realExperiment: 'NOT_RUN',
    conditionU: 'NOT_RUN', productionWorker: 'HOLD',
    hypotheses: { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' } };
}
function result(reasons, normalized = null, files = []) {
  reasons.sort((a, b) => canonical([a.code, a.path, a.detail]).localeCompare(canonical([b.code, b.path, b.detail]), 'en'));
  const has = level => reasons.some(r => r.level === level);
  const documentStatus = has('schema') ? 'INVALID_SCHEMA' : has('conflict') ? 'INCONSISTENT' : has('missing') ? 'INCOMPLETE' : 'CONSISTENT';
  return { documentStatus, exitCode: documentStatus === 'INVALID_SCHEMA' ? 2 : documentStatus === 'CONSISTENT' ? 0 : 1,
    scope: 'SUBMITTED_DOCUMENTS_ONLY', ...guards(), normalized, reasons, files };
}
// A complete, deliberately narrow data grammar, never a shell interpreter.
function parseUpstreamConfig(text) {
  const assignments = [], issues = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^[ \t]*(?:#[^\r\n]*)?$/.test(line)) return;
    const match = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)="([A-Za-z0-9_./:@+-]*)"[ \t]*$/.exec(line);
    if (!match) {
      issues.push({ level: 'missing', code: 'UPSTREAM_CONFIG_UNSUPPORTED_SYNTAX', suffix: `/line/${index + 1}`, detail: 'line outside supported literal-assignment/comment grammar; not interpreted' });
      return;
    }
    if (match[1] === 'BASE_REVISION') assignments.push({ value: match[2], line: index + 1 });
  });
  if (!assignments.length) issues.push({ level: 'missing', code: 'METADATA_FIELD_MISSING', suffix: '/upstreamRevision', detail: 'one supported BASE_REVISION assignment is required' });
  if (assignments.length > 1) issues.push({ level: 'conflict', code: 'UPSTREAM_CONFIG_MULTIPLE_REVISION', suffix: '/upstreamRevision', detail: `multiple BASE_REVISION assignments at lines ${assignments.map(a => a.line).join(', ')}; no value selected` });
  for (const assignment of assignments) {
    if (!/^[0-9a-f]{40}$/.test(assignment.value)) issues.push({ level: 'conflict', code: 'UPSTREAM_CONFIG_INVALID_REVISION', suffix: `/line/${assignment.line}`, detail: 'BASE_REVISION must be one lowercase 40-hex literal' });
  }
  return { revision: issues.length ? undefined : assignments[0].value, issues };
}
function validateSchema(value, schema) {
  const errors = [];
  const fail = (path, detail) => errors.push({ level: 'schema', code: 'SCHEMA', path, detail });
  function walk(v, rule, path, depth) {
    if (depth > 32) return fail(path, 'maximum JSON depth exceeded');
    if (rule.$ref) rule = schema.$defs[rule.$ref.slice('#/$defs/'.length)];
    const type = v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
    if (!(Array.isArray(rule.type) ? rule.type : [rule.type]).includes(type)) return fail(path, 'invalid type');
    if (rule.enum && !rule.enum.includes(v)) fail(path, 'invalid enum');
    if (typeof v === 'string') {
      if ((rule.minLength && v.trim().length < rule.minLength) || (rule.maxLength && v.length > rule.maxLength)) fail(path, 'invalid string length');
      if (rule.pattern && !new RegExp(rule.pattern).test(v)) fail(path, 'invalid pattern');
    }
    if (type === 'integer' && (!Number.isSafeInteger(v) || (rule.minimum !== undefined && v < rule.minimum))) fail(path, 'invalid integer');
    if (type === 'array') {
      if (v.length > rule.maxItems) return fail(path, 'too many items');
      v.forEach((item, i) => walk(item, rule.items, `${path}/${i}`, depth + 1));
    }
    if (type === 'object') {
      for (const key of rule.required) if (!Object.hasOwn(v, key)) fail(`${path}/${key}`, 'required');
      for (const key of Object.keys(v)) {
        if (!Object.hasOwn(rule.properties, key)) fail(`${path}/${key}`, 'unknown property');
        else walk(v[key], rule.properties[key], `${path}/${key}`, depth + 1);
      }
    }
  }
  walk(value, schema, '', 0);
  return errors;
}
// provided is a Map<ID, Buffer>; this pure function does not read files.
function checkDocuments(plan, schema, provided = new Map()) {
  if (sha256(canonical(schema)) !== SCHEMA_HASH) return result([{ level: 'schema', code: 'SCHEMA_DEFINITION', path: '/schema', detail: 'unsupported schema definition' }]);
  const errors = validateSchema(plan, schema);
  if (errors.length) return result(errors);
  const reasons = [];
  const add = (level, code, path, detail) => reasons.push({ level, code, path, detail });
  const sources = new Map();
  plan.sources.forEach((s, i) => {
    if (sources.has(s.id)) add('conflict', 'DUPLICATE_SOURCE', `/sources/${i}`, s.id);
    sources.set(s.id, s);
  });
  for (const id of provided.keys()) if (!sources.has(id)) add('conflict', 'UNDECLARED_SOURCE', '/sources', id);
  for (const [id, source] of sources) {
    const bytes = provided.get(id);
    if (!bytes) add('missing', 'SOURCE_UNAVAILABLE', `/sources/${id}`, 'explicit source file not supplied or unreadable');
    else if (sha256(bytes) !== source.sha256) add('conflict', 'HASH_MISMATCH', `/sources/${id}`, 'supplied bytes differ from declared sha256');
  }
  // Narrow, fixed metadata adapters; declarations alone cannot replace these reads.
  const roles = ['LOCK', 'BROWSERS', 'UPSTREAM_CONFIG', 'SAVED_LOG'];
  const roleSources = new Map();
  for (const role of roles) {
    const found = plan.sources.filter(s => s.role === role);
    if (!found.length) add('missing', 'METADATA_ROLE_MISSING', '/sources', role);
    if (found.length > 1) add('conflict', 'METADATA_ROLE_DUPLICATE', '/sources', role);
    if (found.length === 1) roleSources.set(role, found[0]);
  }
  const compare = (actual, expected, path) => {
    if (actual === undefined || actual === null || expected === null) add('missing', 'METADATA_FIELD_MISSING', path, 'required field unavailable');
    else if (actual !== expected) add('conflict', 'METADATA_MISMATCH', path, `recorded ${actual}; target ${expected}`);
  };
  const browserSource = roleSources.get('BROWSERS'), configSource = roleSources.get('UPSTREAM_CONFIG');
  if (browserSource && configSource && browserSource.revision !== configSource.revision) add('conflict', 'DEPENDENCY_REVISION_MISMATCH', '/sources', 'browser metadata and upstream config belong to different dependency revisions');
  for (const [role, source] of roleSources) {
    const bytes = provided.get(source.id);
    if (!bytes) continue;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      const path = `/sources/${source.id}`;
      if (role === 'LOCK') {
        const packages = JSON.parse(text).packages;
        compare(packages?.['node_modules/playwright']?.version, plan.target.playwrightVersion, path + '/playwright');
        compare(packages?.['node_modules/playwright-core']?.version, plan.target.playwrightVersion, path + '/playwright-core');
      } else if (role === 'BROWSERS') {
        const browser = JSON.parse(text).browsers?.find(b => b.name === 'webkit');
        compare(browser?.browserVersion, plan.target.browserVersion, path + '/browserVersion');
        compare(browser?.revisionOverrides?.[plan.target.platform] ?? browser?.revision, plan.target.browserRevision, path + '/revision');
      } else if (role === 'UPSTREAM_CONFIG') {
        const config = parseUpstreamConfig(text);
        for (const issue of config.issues) add(issue.level, issue.code, path + issue.suffix, issue.detail);
        if (!config.issues.length) compare(config.revision, plan.target.upstreamRevision, path + '/upstreamRevision');
      } else {
        const downloads = [...text.matchAll(/Downloading WebKit ([^ ]+) \(playwright webkit v([0-9]+)\) from (https:\/\/[^\s]+)/g)];
        if (!downloads.length) add('missing', 'DOWNLOAD_RECORD_MISSING', path, 'no saved WebKit download record');
        for (const download of downloads) {
          compare(download[1], plan.target.browserVersion, path + '/browserVersion');
          compare(download[2], plan.target.browserRevision, path + '/browserRevision');
          compare(download[3].match(/\/webkit\/([0-9]+)\//)?.[1], plan.target.browserRevision, path + '/downloadRevision');
          const filenames = { 'ubuntu24.04-x64': 'webkit-ubuntu-24.04.zip', 'ubuntu24.04-arm64': 'webkit-ubuntu-24.04-arm64.zip' };
          const filename = filenames[plan.target.platform];
          if (!filename) add('missing', 'PLATFORM_UNSUPPORTED', '/target/platform', 'no saved-log platform adapter for this target');
          else compare(download[3].split('/').pop(), filename, path + '/platform');
        }
      }
    } catch {
      add('missing', 'METADATA_UNREADABLE', `/sources/${source.id}`, 'required metadata cannot be decoded by the fixed adapter');
    }
  }
  function references(refs, path, revision = null) {
    if (!refs.length) add('missing', 'NO_REFERENCE', path, 'no supporting reference');
    refs.forEach((ref, i) => {
      const at = `${path}/${i}`, source = sources.get(ref.sourceId);
      if (!source) return add('conflict', 'BROKEN_REFERENCE', at, ref.sourceId);
      if (revision && source.revision !== revision) add('conflict', 'SOURCE_REVISION_MISMATCH', at, ref.sourceId);
      const bytes = provided.get(ref.sourceId);
      if (!bytes) return;
      const lines = bytes.toString('utf8').replace(/\n$/, '').split('\n').length;
      if (ref.endLine < ref.startLine || ref.endLine > lines) add('conflict', 'REFERENCE_RANGE', at, 'line range outside source');
    });
  }
  const v = plan.versionMapping;
  references(v.refs, '/versionMapping/refs');
  if (v.status !== 'VERIFIED_METADATA') add('missing', 'VERSION_MAPPING_' + v.status, '/versionMapping/status', 'binary equivalence is not established by metadata');
  if (!v.facts.length) add('missing', 'NO_VERSION_FACTS', '/versionMapping/facts', 'no direct facts documented');
  if (!plan.target.upstreamRevision) add('missing', 'UPSTREAM_UNKNOWN', '/target/upstreamRevision', 'no fixed source revision');
  [...v.unknowns.map((x, i) => [`/versionMapping/unknowns/${i}`, x]), ...plan.unknowns.map((x, i) => [`/unknowns/${i}`, x])]
    .forEach(([path, detail]) => add('missing', 'DECLARED_UNKNOWN', path, detail));
  if (!plan.sources.length) add('missing', 'NO_SOURCES', '/sources', 'no source documents');
  if (!plan.candidates.length) add('missing', 'NO_CANDIDATE', '/candidates', 'no evidence candidate documented');
  const ids = new Set();
  const engineIds = new Set(), declaredStates = new Set();
  plan.candidates.forEach((c, i) => {
    const at = `/candidates/${i}`;
    if (ids.has(c.id)) add('conflict', 'DUPLICATE_CANDIDATE', at, c.id);
    ids.add(c.id);
    for (const [key, expected] of [['targetId', plan.target.id], ['sourceRevision', plan.target.upstreamRevision], ['transactionId', plan.transactionId]]) {
      if (expected !== null && c[key] !== expected) add('conflict', key.toUpperCase() + '_MISMATCH', at + '/' + key, 'candidate belongs to a different target, revision or transaction');
    }
    if (c.engineTransactionId === 'UNKNOWN') add('missing', 'ENGINE_ID_UNKNOWN', at + '/engineTransactionId', 'application to engine ID mapping unobserved');
    else engineIds.add(c.engineTransactionId);
    if (c.access === 'UNKNOWN') add('missing', 'ACCESS_UNKNOWN', at + '/access', 'required access unknown');
    if (c.status !== 'CANDIDATE') add('missing', 'CANDIDATE_' + c.status, at + '/status', 'candidate does not establish an available method');
    const boundaries = { identityMapping: c.identityMapping, ...c.boundaries };
    for (const [name, boundary] of Object.entries(boundaries)) {
      const path = name === 'identityMapping' ? `${at}/identityMapping` : `${at}/boundaries/${name}`;
      references(boundary.refs, path + '/refs', c.sourceRevision);
      if (boundary.status !== 'DOCUMENTED') add('missing', 'BOUNDARY_' + boundary.status, path, boundary.description);
    }
    for (const state of ['NORMAL_UNTERMINATED', 'COMMIT', 'ABORT', 'ABNORMAL']) {
      if (!c.statesDistinguished.includes(state)) add('missing', 'STATE_NOT_DISTINGUISHED', at + '/statesDistinguished', state);
    }
    if (new Set(c.statesDistinguished).size !== c.statesDistinguished.length) add('conflict', 'DUPLICATE_STATE', at + '/statesDistinguished', 'duplicate state');
    if (c.statesAtBoundary.length !== 1) add(c.statesAtBoundary.length ? 'conflict' : 'missing', 'EXCLUSIVE_BOUNDARY_STATE', at + '/statesAtBoundary', 'exactly one documentary state or UNKNOWN is required');
    if (c.statesAtBoundary.includes('UNKNOWN')) add('missing', 'STOP_STATE_UNKNOWN', at + '/statesAtBoundary', 'actual stop state unobserved');
    c.statesAtBoundary.filter(state => state !== 'UNKNOWN').forEach(state => declaredStates.add(state));
  });
  if (engineIds.size > 1) add('conflict', 'ENGINE_BINDING_CONFLICT', '/candidates', 'same application transaction is bound to different engine transactions');
  if (declaredStates.size > 1) add('conflict', 'CROSS_CANDIDATE_STATE_CONFLICT', '/candidates', 'same boundary has contradictory state declarations');
  const normalized = { schemaVersion: plan.schemaVersion, plan: plan.plan, target: plan.target, transactionId: plan.transactionId,
    versionMappingStatus: v.status, candidates: plan.candidates.map(c => ({ id: c.id, status: c.status, access: c.access, statesAtBoundary: c.statesAtBoundary })).sort((a, b) => a.id.localeCompare(b.id, 'en')) };
  return result(reasons, normalized);
}
function readFile(path) {
  const stat = fs.statSync(path);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('invalid input file');
  const bytes = fs.readFileSync(path);
  if (bytes.length > MAX_BYTES) throw new Error('input too large');
  return bytes;
}
function main(args) {
  const files = [], reasons = [], supplied = new Map(), paths = new Map();
  let schemaPath, planPath;
  try {
    for (let i = 0; i < args.length;) {
      const flag = args[i++];
      if ((flag === '--schema' || flag === '--plan') && args[i] && !args[i].startsWith('--')) {
        if (flag === '--schema') { if (schemaPath) throw 0; schemaPath = args[i++]; }
        else { if (planPath) throw 0; planPath = args[i++]; }
      } else if (flag === '--source' && args[i] && args[i + 1] && !args[i].startsWith('--') && !args[i + 1].startsWith('--')) {
        const id = args[i++], path = args[i++];
        if (paths.has(id) || paths.size >= 64) throw 0;
        paths.set(id, path);
      } else throw 0;
    }
    if (!schemaPath || !planPath) throw 0;
  } catch {
    return result([{ level: 'schema', code: 'ARGUMENTS', path: '/', detail: 'use --schema FILE --plan FILE [--source ID FILE ...]' }]);
  }
  let schema, plan;
  try {
    for (const [kind, path] of [['schema', schemaPath], ['plan', planPath]]) {
      const bytes = readFile(path);
      files.push({ id: kind, sha256: sha256(bytes) });
      const parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (kind === 'schema') schema = parsed; else plan = parsed;
    }
  } catch {
    return result([{ level: 'schema', code: 'JSON_INPUT', path: '/', detail: 'schema or plan unreadable, oversized or invalid JSON' }], null, files);
  }
  for (const [id, path] of paths) {
    try {
      const bytes = readFile(path);
      supplied.set(id, bytes);
      files.push({ id, sha256: sha256(bytes) });
    } catch {
      reasons.push({ level: 'missing', code: 'SOURCE_READ_FAILED', path: `/sources/${id}`, detail: 'explicit source unreadable, oversized or not a regular file' });
    }
  }
  try {
    const checked = checkDocuments(plan, schema, supplied);
    return result([...checked.reasons, ...reasons], checked.normalized, files.sort((a, b) => a.id.localeCompare(b.id, 'en')));
  } catch {
    return result([{ level: 'schema', code: 'INPUT_LIMIT', path: '/', detail: 'schema or JSON exceeds supported structure limits' }], null, files);
  }
}
if (require.main === module) {
  const output = main(process.argv.slice(2));
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exitCode = output.exitCode;
}
module.exports = { validateSchema, checkDocuments, main };
