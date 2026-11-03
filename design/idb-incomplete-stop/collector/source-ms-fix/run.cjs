'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const [target, fixtures, output] = process.argv.slice(2).map(v => path.resolve(v));
if (fs.existsSync(output)) throw new Error('never overwrite evidence');
const command = [process.execPath, '--test', '--test-reporter=tap', path.join(__dirname, 'numeric.test.cjs')];
const p = spawnSync(command[0], command.slice(1), { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, NUMERIC_TARGET: target, NUMERIC_FIXTURES: fixtures, NUMERIC_OUTPUT: output } });
if (!fs.existsSync(output)) fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'tests.tap'), p.stdout || ''); fs.writeFileSync(path.join(output, 'tests.stderr.txt'), p.stderr || '');
const summary = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(k => [k, Number(new RegExp(`# ${k} (\\d+)`).exec(p.stdout)?.[1])]));
Object.assign(summary, { command, target, fixtures, output, actualExitCode: p.status, signal: p.signal, processError: p.error?.message || null });
fs.writeFileSync(path.join(output, 'process.json'), JSON.stringify(summary, null, 2) + '\n'); console.log(JSON.stringify(summary)); process.exitCode = p.status ?? 2;
