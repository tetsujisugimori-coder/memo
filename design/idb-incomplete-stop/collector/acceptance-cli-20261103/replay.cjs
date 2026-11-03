'use strict';
// Launch pinned regression scripts and retain controller-level process exits/commands.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(process.argv[2]), sourceRoot = path.join(root, 'new');
const output = path.join(root, 'regression');
if (fs.existsSync(output)) throw new Error('never overwrite a regression execution'); fs.mkdirSync(output);
const scripts = {
  regression96: 'design/idb-incomplete-stop/collector/verify.cjs',
  regression69: 'design/idb-incomplete-stop/collector/independent/run.cjs',
  regression18: 'design/idb-incomplete-stop/collector/diagnostic-fix/run.cjs'
};
const outcomes = [];
for (const [name, script] of Object.entries(scripts)) {
  const command = [process.execPath, path.join(sourceRoot, script), path.join(output, name)];
  const p = spawnSync(command[0], command.slice(1), { cwd: sourceRoot, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, U1_REVISION: 'e4a5d414689f23e1b33660bce3e006c46fb4e37f', DIAG_REVISION: 'e4a5d414689f23e1b33660bce3e006c46fb4e37f' } });
  fs.writeFileSync(path.join(output, name + '.controller.stdout.txt'), p.stdout || ''); fs.writeFileSync(path.join(output, name + '.controller.stderr.txt'), p.stderr || '');
  const result = { name, command, cwd: sourceRoot, actualExitCode: p.status, signal: p.signal, processError: p.error?.message || null };
  fs.writeFileSync(path.join(output, name + '.process.json'), JSON.stringify(result, null, 2) + '\n'); outcomes.push(result);
  if (p.error || p.status !== 0) { console.log(JSON.stringify(outcomes)); process.exitCode = 1; break; }
}
fs.writeFileSync(path.join(output, 'processes.json'), JSON.stringify(outcomes, null, 2) + '\n');
console.log(JSON.stringify(outcomes.map(r => ({ name: r.name, exitCode: r.actualExitCode, signal: r.signal }))));
