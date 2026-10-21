import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { siteNeedsBuild } from '../scripts/ignore-site-build.mjs';

test('extension changes and version bumps do not redeploy the installation pages', () => {
  const read = (ref, path) => JSON.stringify(path === 'package.json'
    ? { version: ref === 'before' ? '1.9.0' : '1.9.1', scripts: { 'build:site': 'node scripts/build-site.mjs' } }
    : { version: ref === 'before' ? '1.9.0' : '1.9.1', packages: { '': { version: ref === 'before' ? '1.9.0' : '1.9.1' } } });
  assert.equal(siteNeedsBuild(['src/background/notifications.ts', 'manifest.json', 'package.json', 'package-lock.json'], read), false);
  assert.equal(siteNeedsBuild(['site/installation-admin.html'], read), true);
  assert.equal(siteNeedsBuild(['netlify/functions/collaboration.mjs'], read), true);
  assert.equal(siteNeedsBuild(['package.json'], ref => JSON.stringify({ devDependencies: { sharp: ref } })), true);
});

test('permanent edition downloads follow the latest release without static ZIP shadowing', async () => {
  const rules = (await readFile('site/_redirects', 'utf8')).trim().split('\n').map(line => line.trim().split(/\s+/));
  for (const edition of ['admin', 'user', 'extension']) {
    const rule = rules.find(([from]) => from === `/downloads/commyweb-${edition}.zip`);
    assert.deepEqual(rule?.slice(1), [`https://github.com/kiou98/Commyweb/releases/latest/download/commyweb-${edition === 'extension' ? 'user' : edition}.zip`, '302!']);
  }
  const source = await readFile('scripts/build-site.mjs', 'utf8');
  assert.ok(!source.includes('prepareEditions'));
  const netlify = await readFile('netlify.toml', 'utf8');
  assert.match(netlify, /for = "\/downloads\/\*"\s+\[headers.values\]\s+Cache-Control = "no-store"/);
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.scripts['build:site'], 'node scripts/build-site.mjs');
});
