'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(process.argv[2]), output = path.join(root, 'regression');
if (fs.existsSync(output)) throw new Error('never overwrite regression evidence'); fs.mkdirSync(output);
const scripts = { regression96: 'verify.cjs', regression69: 'independent/run.cjs', regression18: 'diagnostic-fix/run.cjs', cli16: 'diagnostic-fix/cli-error/run.cjs' }, results = [];
for (const phase of ['old', 'new']) {
  const source = path.join(root, phase), parent = path.join(output, phase); fs.mkdirSync(parent);
  for (const [group, script] of Object.entries(scripts)) {
    const command = [process.execPath, path.join(source, 'design/idb-incomplete-stop/collector', script), path.join(parent, group)];
    const p = spawnSync(command[0], command.slice(1), { cwd: source, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(path.join(parent, group + '.controller.stdout.txt'), p.stdout || ''); fs.writeFileSync(path.join(parent, group + '.controller.stderr.txt'), p.stderr || '');
    const tapFile = path.join(parent, group, 'tests.tap'), tap = fs.existsSync(tapFile) ? fs.readFileSync(tapFile, 'utf8') : '';
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(k => [k, Number(new RegExp(`# ${k} (\\d+)`).exec(tap)?.[1])]));
    results.push({ phase, group, command, ...counts, actualExitCode: p.status, signal: p.signal, processError: p.error?.message || null });
    fs.writeFileSync(path.join(parent, group + '.process.json'), JSON.stringify(results.at(-1), null, 2) + '\n');
    console.log(JSON.stringify(results.at(-1)));
  }
}
fs.writeFileSync(path.join(output, 'processes.json'), JSON.stringify(results, null, 2) + '\n');
// The historical R1 sentinel expressly fixes the old R2 bug; retain its failure rather than changing its expectation.
process.exitCode = results.every(r => r.processError === null && r.signal === null && r.tests === ({ regression96: 96, regression69: 69, regression18: 18, cli16: 16 })[r.group] && r.skipped === 0 &&
  r.fail === (r.phase === 'new' && r.group === 'regression18' ? 1 : 0) && r.actualExitCode === (r.phase === 'new' && r.group === 'regression18' ? 1 : 0)) ? 0 : 1;
