'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const Ajv = require('ajv/dist/2020').default, ajv = new Ajv({ strict: true, allErrors: true });
const target = path.resolve(process.env.NUMERIC_TARGET || path.join(__dirname, '../collect.cjs'));
const fixtures = path.resolve(process.env.NUMERIC_FIXTURES), output = path.resolve(process.env.NUMERIC_OUTPUT);
if (fs.existsSync(output)) throw new Error('never overwrite numeric evidence'); fs.mkdirSync(output, { recursive: true });
const { validate, inputSchema, resultSchema } = require(target), inputValid = ajv.compile(inputSchema), resultValid = ajv.compile(resultSchema);
const hash = b => crypto.createHash('sha256').update(b).digest('hex'), save = (n, o) => fs.writeFileSync(path.join(output, n), JSON.stringify(o, null, 2) + '\n', { flag: 'wx' });
save('environment.json', { target, collectorSha256: hash(fs.readFileSync(target)), inputSchemaSha256: hash(fs.readFileSync(path.join(path.dirname(target), 'input.schema.json'))), resultSchemaSha256: hash(fs.readFileSync(path.join(path.dirname(target), 'result.schema.json'))), node: process.version, platform: process.platform,
  validator: { name: 'ajv', version: require('ajv/package.json').version, dialect: 'Draft 2020-12', strictNumbers: true }, expectationsSha256: hash(fs.readFileSync(path.join(fixtures, 'expectations.json'))) });
const projection = r => Object.fromEntries(['evidenceStatus', 'exitCode', 'transactions', 'relations', 'orderRelations', 'missingEvidence', 'contradictions', 'unknownReasons', 'reasons'].map(k => [k, r[k]]));
let normalProjection;
for (const c of JSON.parse(fs.readFileSync(path.join(fixtures, 'expectations.json')))) test(c.id, () => {
  const filename = path.join(fixtures, c.file), bytes = fs.readFileSync(filename); assert.equal(hash(bytes), c.sha256);
  let parsed = null, parseError = null, av = false, embedded = false, errors = null;
  try { parsed = JSON.parse(bytes); av = inputValid(parsed); errors = inputValid.errors; embedded = validate(parsed, inputSchema).length === 0; } catch (e) { parseError = e.message; }
  const command = [process.execPath, target, filename, c.materialId, c.sha256];
  const child = spawnSync(command[0], command.slice(1), { encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  fs.writeFileSync(path.join(output, c.id + '.stdout.json'), child.stdout || ''); fs.writeFileSync(path.join(output, c.id + '.stderr.txt'), child.stderr || '');
  let r = null; try { r = JSON.parse(child.stdout); } catch (_) { /* Saved before assertions. */ }
  const schemaOK = r !== null && resultValid(r);
  save(c.id + '.inspection.json', { command, inputSha256: c.sha256, expected: c.expected, processStatus: child.status, signal: child.signal, processError: child.error?.message || null,
    inputParseError: parseError, ajvInputValid: av, embeddedInputValid: embedded, ajvInputErrors: errors, resultSchemaValid: schemaOK, resultSchemaErrors: resultValid.errors,
    actualStatus: r?.evidenceStatus, jsonExitCode: r?.exitCode, diagnosticReasons: r?.reasons, stdoutSha256: hash(Buffer.from(child.stdout || '')), stderrSha256: hash(Buffer.from(child.stderr || '')) });
  assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.stderr, ''); assert(r, 'single JSON result'); assert.equal(schemaOK, true);
  assert.equal(av, c.expected.schemaValid, 'independent Ajv input contract'); assert.equal(embedded, c.expected.schemaValid, 'embedded input contract');
  assert.equal(child.status, c.expected.exitCode, 'real process status'); assert.equal(r.exitCode, child.status); assert.equal(r.evidenceStatus, c.expected.status);
  assert.equal(r.input.actualSha256, c.sha256); assert.equal(r.input.expectedSha256, c.sha256);
  if (c.expected.code) assert(r.reasons.includes(c.expected.code));
  if (c.expected.status === 'CONSISTENT') {
    assert.equal(r.transactions.length, 1); assert.equal(r.transactions[0].assessment.conditionR, 'PASS'); assert.equal(r.transactions[0].assessment.conditionU, 'FAIL');
    assert.equal(typeof r.input.semanticSha256, 'string');
  } else if (c.expected.status === 'INVALID_SCHEMA') { assert.deepEqual(r.transactions, []); assert.equal(r.input.semanticSha256, null); assert.deepEqual(r.relations, []); }
  else { assert.equal(r.transactions[0].assessment.conditionR, 'UNKNOWN'); assert.equal(r.transactions[0].assessment.conditionU, 'UNKNOWN'); }
  if (c.id === 'normal') normalProjection = projection(r);
  if (c.expected.sameCausality) assert.deepEqual(projection(r), normalProjection, 'clocks never change identities, causal links, order or R/U');
  for (const [k, v] of Object.entries({ conditionU: 'NOT_RUN', realExperiment: 'NOT_RUN', executionAuthorization: 'NOT_GRANTED', startCondition: 'BLOCKED', productionWorker: 'HOLD' })) assert.equal(r[k], v);
  assert.deepEqual(r.hypotheses, { H1: 'UNKNOWN', H2: 'UNKNOWN', H3: 'UNKNOWN', H4: 'PARTIAL' });
  assert(r.validationErrors.length <= 256); for (const e of r.validationErrors) for (const k of ['code', 'subject', 'detail']) assert([...e[k]].length <= 8192);
  assert.equal(hash(fs.readFileSync(filename)), c.sha256);
});
// API-only values cannot be represented by JSON bytes. Exercise finite checks separately.
for (const [name, value] of [['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity]]) for (const type of ['number', 'integer']) test(`API-${type}-${name}`, () => {
  const schema = { type }, independent = ajv.compile(schema)(value), embedded = validate(value, schema).length === 0;
  save(`API-${type}-${name}.json`, { expected: false, independent, embedded }); assert.equal(independent, false); assert.equal(embedded, false);
});
for (const [id, schema, value, expected] of [
  ['integer-min', { type: 'integer', minimum: 1, maximum: 8192 }, 1, true], ['integer-max', { type: 'integer', minimum: 1, maximum: 8192 }, 8192, true],
  ['integer-fraction', { type: 'integer' }, 1.5, false], ['integer-unbounded-large', { type: 'integer' }, 1e20, true],
  ['number-bounded-above', { type: 'number', minimum: -1, maximum: 1 }, 1.5, false], ['number-bounded-min', { type: 'number', minimum: -1, maximum: 1 }, -1, true],
  ['nullable-integer-large', { type: ['integer', 'null'] }, 1e20, true], ['nullable-integer-null', { type: ['integer', 'null'] }, null, true]
]) test('numeric-keywords-' + id, () => {
  const independent = ajv.compile(schema)(value), embedded = validate(value, schema).length === 0;
  save('numeric-keywords-' + id + '.json', { schema, value, expected, independent, embedded }); assert.equal(independent, expected); assert.equal(embedded, expected);
});
