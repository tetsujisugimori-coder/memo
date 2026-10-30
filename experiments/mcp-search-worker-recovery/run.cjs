const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { chromium, webkit } = require('playwright');
const engine = process.env.WORKER_RECOVERY_BROWSER || 'chromium';
if (!['chromium', 'webkit'].includes(engine)) throw new Error('unsupported engine');
const files = ['supervisor.js', 'worker.js', 'browser-suite.js', 'run.cjs'];
const output = { engine, checkedAt: new Date().toISOString(), head: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHashes: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, file))).digest('hex')])) };
const server = http.createServer((req, res) => {
  const name = (req.url || '/').slice(1);
  if (!name) { res.setHeader('Content-Type', 'text/html'); res.end('<script src="supervisor.js"></script><script src="browser-suite.js"></script>'); }
  else if (files.includes(name)) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, name))); }
  else { res.statusCode = 404; res.end(); }
});
function save() { const dir = path.resolve(__dirname, '../../e2e-artifacts/worker-recovery'); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, `${engine}-${crypto.randomUUID()}.json`); fs.writeFileSync(file, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' }); console.log(file, JSON.stringify(output)); }
(async () => {
  let browser;
  const watchdog = setTimeout(() => { output.fatal = 'runner_timeout_30s'; save(); process.exit(1); }, 30000);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await ({ chromium, webkit })[engine].launch({ headless: true }); output.browserVersion = browser.version();
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`); output.result = await page.evaluate(() => window.runRecoveryStudy()); output.pageErrors = errors;
    if (output.result.error || output.result.cleanup.status !== 'PASS' || errors.length) process.exitCode = 1;
  } catch (e) { output.fatal = String(e); process.exitCode = 1; }
  finally { if (browser) await browser.close(); server.close(); clearTimeout(watchdog); save(); }
})();
