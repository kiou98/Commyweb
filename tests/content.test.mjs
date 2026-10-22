import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const source = await readFile('src/content/index.ts', 'utf8');
const compiled = await build({ stdin: {
  contents: source.slice(0, source.indexOf('const appWindow =')) + '\nexport { CommywebContentApp };',
  resolveDir: `${process.cwd()}/src/content`, loader: 'ts'
}, bundle: true, write: false, format: 'esm', platform: 'node' });
const { CommywebContentApp } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

test('an in-flight page response cannot restore a marker after resolution', async () => {
  const open = { id: 'thread', urlHash: 'page', status: 'open', replies: [] };
  let cached = [open];
  globalThis.chrome = { storage: { local: { async get(key) {
    return { [key]: key === 'commyweb_settings' ? {} : cached };
  } }, sync: { async get() { return {}; } } } };
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  const app = Object.assign(Object.create(CommywebContentApp.prototype), {
    currentUrl: 'https://example.test/page', cacheReadVersion: 0,
    loading: false, refreshRequested: false, activeCommentId: null,
    modal: { updateRepliesIfActive() {} }, renderPins() {},
    async message() { started(); return pending; }
  });
  const loading = app.loadComments();
  await requested;
  cached = [{ ...open, status: 'resolved' }];
  await app.loadComments(true);
  assert.equal(app.comments[0].status, 'resolved');
  release({ success: true, comments: [open] });
  await loading;
  assert.equal(app.comments[0].status, 'resolved');
});

test('author name falls back to email but never to the anonymous guest label', () => {
  const app = Object.create(CommywebContentApp.prototype);
  app.currentUser = { id: 'anonymous', username: 'Invite' };
  assert.equal(app.authorName(), '');
  app.currentUser.email = 'vincent@example.test';
  assert.equal(app.authorName(), 'vincent');
  app.currentUser.name = ' Vincent Lavergne ';
  assert.equal(app.authorName(), 'Vincent Lavergne');
});

test('comments and replies reject missing names before saving', async () => {
  const app = Object.assign(Object.create(CommywebContentApp.prototype), {
    currentUser: { id: 'anonymous', username: 'Invite' }, joining: false
  });
  await assert.rejects(app.createComment('Bonjour'), /nom dans l’onglet Paramétrage du plugin/);
  await assert.rejects(app.reply('thread', 'Bonjour'), /nom dans l’onglet Paramétrage du plugin/);
});
