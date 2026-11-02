'use strict';
// Fixture copied from check.test.cjs at 636e279; synthetic documents only.
const crypto = require('node:crypto');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function fixture() {
  const upstream = 'a'.repeat(40), dependency = 'b'.repeat(40);
  const provided = new Map(Object.entries({
    lock: JSON.stringify({ packages: { 'node_modules/playwright': { version: '1.62.1' }, 'node_modules/playwright-core': { version: '1.62.1' } } }),
    browsers: JSON.stringify({ browsers: [{ name: 'webkit', browserVersion: '26.5', revision: '2336', revisionOverrides: { 'ubuntu20.04-x64': '2092' } }] }),
    config: `BASE_REVISION="${upstream}"\n`,
    log: 'Downloading WebKit 26.5 (playwright webkit v2336) from https://cdn.playwright.dev/dbazure/download/playwright/builds/webkit/2336/webkit-ubuntu-24.04.zip\n',
    reference: 'A hypothetical hook description; this text does not prove the claim.\n'
  }).map(([id, text]) => [id, Buffer.from(text)]));
  const refs = [{ sourceId: 'reference', startLine: 1, endLine: 1 }];
  const boundary = () => ({ status: 'DOCUMENTED', description: 'Hypothetical documented candidate, not an observation.', refs: structuredClone(refs) });
  const plan = {
    schemaVersion: 1, plan: { id: 'synthetic-document-only', condition: 'U' },
    target: { id: 'target', playwrightVersion: '1.62.1', browserVersion: '26.5', browserRevision: '2336', platform: 'ubuntu24.04-x64', upstreamRevision: upstream },
    sources: [...provided].map(([id, bytes], i) => ({ id, role: ['LOCK', 'BROWSERS', 'UPSTREAM_CONFIG', 'SAVED_LOG', 'REFERENCE'][i], revision: id === 'reference' ? upstream : dependency, sha256: hash(bytes), url: `https://example.invalid/${id}` })),
    versionMapping: { status: 'VERIFIED_METADATA', refs, facts: ['Synthetic metadata matches.'], inferences: [], unknowns: [] },
    transactionId: 'app-tx',
    candidates: [{ id: 'hypothetical', targetId: 'target', sourceRevision: upstream, transactionId: 'app-tx', engineTransactionId: 'hypothetical-engine-id',
      access: 'CUSTOM_BUILD', status: 'CANDIDATE', identityMapping: boundary(),
      boundaries: Object.fromEntries(['normalUnterminated', 'actualWorkerStop', 'commit', 'abort', 'abnormal'].map(k => [k, boundary()])),
      statesDistinguished: ['NORMAL_UNTERMINATED', 'COMMIT', 'ABORT', 'ABNORMAL'], statesAtBoundary: ['NORMAL_UNTERMINATED'],
      requiredChanges: ['Hypothetical native recorder.'], limitations: ['Assertions are not verified.'] }], unknowns: []
  };
  return { plan, provided };
}

module.exports = { fixture, hash };
