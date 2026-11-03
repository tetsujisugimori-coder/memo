'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
if (!process.argv[2]) throw new Error('supply a new result directory'); const output = path.resolve(process.argv[2]);
if (fs.existsSync(output)) throw new Error('refusing to overwrite results');
const p = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(__dirname, 'cli-error.test.cjs')], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  env: { ...process.env, CLI_TEST_OUTPUT: output, ...(process.argv[3] ? { CLI_TEST_COLLECTOR: path.resolve(process.argv[3]) } : {}) } });
if (p.error) throw p.error; fs.writeFileSync(path.join(output, 'tests.tap'), p.stdout); fs.writeFileSync(path.join(output, 'tests.stderr.txt'), p.stderr);
const summary = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'].map(k => [k, Number(new RegExp(`# ${k} (\\d+)`).exec(p.stdout)?.[1])])); summary.actualExitCode = p.status; summary.signal = p.signal;
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n'); console.log(JSON.stringify(summary)); process.exitCode = p.status ?? 2;
