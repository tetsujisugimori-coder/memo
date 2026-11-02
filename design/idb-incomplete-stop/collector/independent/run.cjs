'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const output = path.resolve(process.argv[2] || '');
if (!process.argv[2] || fs.existsSync(output)) throw new Error('supply a new output directory; never overwrite evidence');
const p = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(__dirname, 'negative.test.cjs')], { encoding: 'utf8', timeout: 60000, windowsHide: true,
  env: { ...process.env, U1_OUTPUT: output, ...(process.argv[3] ? { U1_COLLECTOR: path.resolve(process.argv[3]) } : {}) } });
if (p.error) throw p.error;
fs.writeFileSync(path.join(output, 'tests.tap'), p.stdout);
fs.writeFileSync(path.join(output, 'tests.stderr.txt'), p.stderr);
const summary = { tests: Number(/# tests (\d+)/.exec(p.stdout)?.[1]), pass: Number(/# pass (\d+)/.exec(p.stdout)?.[1]), fail: Number(/# fail (\d+)/.exec(p.stdout)?.[1]), skipped: Number(/# skipped (\d+)/.exec(p.stdout)?.[1]), status: p.status, signal: p.signal };
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
process.stdout.write(JSON.stringify(summary) + '\n'); process.exitCode = p.status ?? 2;
