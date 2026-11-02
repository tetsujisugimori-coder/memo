'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
if (!process.argv[2]) throw new Error('supply a new output directory'); const output = path.resolve(process.argv[2]);
if (fs.existsSync(output)) throw new Error('refusing to overwrite results');
const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(__dirname, 'diagnostics.test.cjs')], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  env: { ...process.env, DIAG_OUTPUT: output, ...(process.argv[3] ? { DIAG_COLLECTOR: path.resolve(process.argv[3]) } : {}) } });
if (child.error) throw child.error;
fs.writeFileSync(path.join(output, 'tests.tap'), child.stdout); fs.writeFileSync(path.join(output, 'tests.stderr.txt'), child.stderr);
const summary = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'].map(k => [k, Number(new RegExp(`# ${k} (\\d+)`).exec(child.stdout)?.[1])]));
summary.actualExitCode = child.status; summary.signal = child.signal;
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n'); console.log(JSON.stringify(summary)); process.exitCode = child.status ?? 2;
