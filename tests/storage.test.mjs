import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ stdin: { contents: `
  export { CacheManager } from './src/storage/cache';
  export { GitHubBackend } from './src/storage/github';
  export * from './src/utils/security';
  export * from './src/utils/email-template';
  export * from './src/utils/github-parser';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { CacheManager: cache, GitHubBackend: github, encodeProjectConfig, decodeProjectConfig, projectLink, normalizeUrl, parseGitHubRepo } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

let local, sync;
const clone = value => structuredClone(value);
const area = state => ({
  async get(key) { return key == null ? clone(state) : { [key]: clone(state[key]) }; },
  async set(values) { Object.assign(state, clone(values)); }
});
const settings = { storageRepo: 'team/project', githubToken: 'test-token' };
const comment = (id = crypto.randomUUID(), changes = {}) => ({
  id, url: 'https://example.test/page', urlHash: 'cw_page', anchor: { selector: '#target', xPercent: .5, yPercent: .5 },
  author: { id: 'user', username: 'Camille', avatarUrl: '' }, content: 'Ajuster ce texte', status: 'open',
  createdAt: '2026-10-19T00:00:00Z', replies: [], ...changes
});
const issue = (value, state = value.status === 'resolved' ? 'closed' : 'open') => ({
  number: value.issueNumber || 1, html_url: `https://github.com/${value.storageRepo || settings.storageRepo}/issues/${value.issueNumber || 1}`,
  state, body: `<!-- COMMYWEB_DATA\n${JSON.stringify(value).replace(/-->/g, '\\u002d\\u002d>')}\n-->`
});
const response = (data, status = 200, headers) => new Response(JSON.stringify(data), { status, headers });
beforeEach(() => {
  local = {}; sync = {};
  globalThis.chrome = { storage: { local: area(local), sync: area(sync) } };
  globalThis.fetch = async () => { throw new Error('Unexpected network call'); };
});

test('scoped settings never replace global defaults during a read', async () => {
  local.commyweb_settings = { storageRepo: 'global/default', githubToken: 'global-token', projectsByDomain: {
    'example.test': { domain: 'example.test', repo: 'team/project', token: 'site-token' }
  } };
  const scoped = await cache.getSettings('https://example.test/page');
  assert.equal(scoped.storageRepo, 'team/project');
  assert.equal(scoped.githubToken, 'site-token');
  assert.equal(local.commyweb_settings.storageRepo, 'global/default');
});

test('credentials can be cleared without being restored from sync', async () => {
  local.commyweb_settings = { githubToken: 'local-secret', storageRepo: 'team/project' };
  sync.commyweb_settings = { githubToken: 'old-secret', storageRepo: 'old/repo' };
  await cache.saveSettings({ githubToken: '', storageRepo: '' });
  assert.equal((await cache.getSettings()).githubToken, '');
  assert.equal((await cache.getSettings()).storageRepo, '');
});

test('sync preferences never contain global or site tokens', async () => {
  await cache.saveSettings({ githubToken: 'secret-global', projectsByDomain: { 'example.test': { domain: 'example.test', repo: 'team/project', token: 'secret-site' } } });
  assert.ok(!JSON.stringify(sync).includes('secret-'));
  assert.equal(local.commyweb_settings.githubToken, 'secret-global');
});

test('site local mode overrides legacy global credentials', async () => {
  await cache.saveSettings(settings);
  await cache.saveSiteProject({ domain: 'example.test', repo: '', token: '' });
  const scoped = await cache.getSettings('example.test');
  assert.equal(scoped.storageRepo, ''); assert.equal(scoped.githubToken, '');
});

test('linking a site does not create a global default for unrelated sites', async () => {
  await cache.saveSiteProject({ domain: 'example.test', repo: 'team/project', token: 'site-token' });
  assert.equal((await cache.getSettings('other.test')).storageRepo, '');
});

test('concurrent site associations preserve both projects', async () => {
  await Promise.all([
    cache.saveSiteProject({ domain: 'first.test', repo: 'team/first', token: 'first-token' }),
    cache.saveSiteProject({ domain: 'second.test', repo: 'team/second', token: 'second-token' })
  ]);
  assert.equal((await cache.getAllSiteProjects()).length, 2);
});

test('concurrent comment additions do not overwrite each other', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => cache.addComment(comment(`id-${i}`))));
  assert.equal((await cache.getCommentsForUrl('cw_page')).length, 20);
});

test('comments are isolated by repository, including legacy issue URLs', async () => {
  const first = comment('first', { issueNumber: 1, issueUrl: 'https://github.com/team/project/issues/1' });
  const second = comment('second', { storageRepo: 'other/project', issueNumber: 2 });
  await cache.addComment(first); await cache.addComment(second); await cache.addComment(comment('local'));
  globalThis.fetch = async () => response([issue(first)]);
  assert.deepEqual((await github.fetchComments(settings, 'cw_page')).map(c => c.id), ['first']);
  assert.equal((await cache.getCommentsForUrl('cw_page')).length, 3);
});

test('local-only creation succeeds without claiming remote synchronization', async () => {
  const result = await github.saveComment({}, comment('local'));
  assert.equal(result.success, true); assert.equal(result.synced, false);
  assert.equal((await cache.getCommentsForUrl('cw_page')).length, 1);
});

test('duplicate submissions create only one GitHub issue', async () => {
  let posts = 0;
  globalThis.fetch = async (_url, options) => { posts++; assert.equal(options.method, 'POST'); return response({ number: 1, html_url: 'https://github.com/team/project/issues/1' }); };
  const value = comment('duplicate');
  await Promise.all([github.saveComment(settings, value), github.saveComment(settings, value)]);
  assert.equal(posts, 1);
});

test('slow GitHub writes do not block local replies or resolution, and late acknowledgements preserve them', async () => {
  const value = comment('slow-write', { storageRepo: settings.storageRepo });
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let remote;
  let posts = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') { posts++; await blocked; remote = JSON.parse(options.body); return response({ number: 17, html_url: 'https://github.com/team/project/issues/17' }); }
    if (options.method === 'GET') return response({ ...remote, number: 17, state: remote.state || 'open', html_url: 'https://github.com/team/project/issues/17' });
    remote = JSON.parse(options.body); return response({ number: 17, html_url: 'https://github.com/team/project/issues/17' });
  };
  const saved = await github.saveComment(settings, value, false);
  assert.equal(saved.success, true);
  const reply = { id: 'fast-reply', content: 'Sans attendre GitHub', author: value.author, createdAt: value.createdAt };
  await github.addReply(settings, value.id, value.urlHash, reply, false);
  await github.toggleResolve(settings, value.id, value.urlHash, false);
  const local = (await cache.getCommentsForUrl(value.urlHash))[0];
  assert.equal(local.replies.length, 1);
  assert.equal(local.status, 'resolved');
  assert.equal(posts, 1);
  release();
  await github.saveComment(settings, value);
  const confirmed = (await cache.getCommentsForUrl(value.urlHash))[0];
  assert.equal(confirmed.replies.length, 1);
  assert.equal(confirmed.status, 'resolved');
  assert.deepEqual(confirmed.pendingChanges, []);
  assert.equal(posts, 1);
});

test('magic-link and admin credentials are local and excluded from Chrome sync', async () => {
  const collaboration = { projectId: '50b02861-3b91-46e7-aaab-123456789012', secret: 'a'.repeat(64), role: 'collaborator' };
  await cache.saveSiteProject({ domain: 'example.test', repo: 'team/project', token: '', collaboration });
  assert.equal((await cache.getSettings('https://example.test/')).collaboration.secret, collaboration.secret);
  assert.ok(!JSON.stringify(sync).includes(collaboration.secret));
  const link = projectLink('https://example.test/page', 'team/project', undefined, collaboration);
  const decoded = decodeProjectConfig(new URLSearchParams(new URL(link).hash.slice(1)).get('commyweb_config'));
  assert.deepEqual(decoded.invitation, { projectId: collaboration.projectId, secret: collaboration.secret });
  assert.equal(decoded.token, undefined);
});

test('an unacknowledged create is reconciled before another POST, including rapid repeated submissions', async () => {
  const value = comment('ambiguous-post', { storageRepo: settings.storageRepo });
  let posts = 0;
  let accepted = false;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'POST') { posts++; accepted = true; throw new Error('Timed out after acceptance'); }
    if (options.method === 'PATCH') return response({ number: 9, html_url: 'https://github.com/team/project/issues/9' });
    if (url.endsWith('/issues/9')) return response(issue({ ...value, issueNumber: 9 }));
    return response(accepted ? [issue({ ...value, issueNumber: 9 })] : []);
  };
  const result = await github.saveComment(settings, value);
  assert.equal(result.synced, false);
  assert.equal((await github.saveComment(settings, value)).synced, true);
  assert.equal(posts, 1);
  const confirmed = (await cache.getCommentsForUrl(value.urlHash))[0];
  assert.equal(confirmed.issueNumber, 9);
});

test('a local status choice during a write wins over a remote status even when it returns to the original value', async () => {
  const sent = comment('status-choice', { storageRepo: settings.storageRepo, issueNumber: 1, pendingChanges: ['replies'] });
  await cache.addComment({ ...sent, updatedAt: '2026-10-19T01:00:00Z', pendingChanges: ['replies', 'status'] });
  await cache.acknowledgeSync(sent, { ...sent, status: 'resolved', pendingChanges: [] });
  const stored = (await cache.getCommentsForUrl(sent.urlHash))[0];
  assert.equal(stored.status, 'open');
  assert.ok(stored.pendingChanges.includes('status'));
});

test('offline replies survive stale remote reads and merge with team replies on retry', async () => {
  const value = comment('thread', { storageRepo: settings.storageRepo, issueNumber: 1 });
  await cache.addComment(value);
  const reply = { id: 'reply-local', author: value.author, content: 'À revoir --> encore', createdAt: value.createdAt };
  globalThis.fetch = async () => { throw new Error('Offline'); };
  const result = await github.addReply(settings, value.id, value.urlHash, reply);
  assert.equal(result.synced, false);
  assert.ok((await cache.getCommentsForUrl(value.urlHash))[0].pendingChanges.includes('replies'));
  await cache.mergeRemoteComments(value.urlHash, settings.storageRepo, [value]);
  assert.equal((await cache.getCommentsForUrl(value.urlHash))[0].replies.length, 1);
  const teamReply = { ...reply, id: 'reply-team', content: 'Retour de l’équipe' };
  let payload;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'GET') return response(issue({ ...value, replies: [teamReply] }));
    payload = JSON.parse(options.body);
    return response({ number: 1, html_url: 'https://github.com/team/project/issues/1' });
  };
  await github.addReply(settings, value.id, value.urlHash, reply);
  const updated = (await cache.getCommentsForUrl(value.urlHash))[0];
  assert.equal(updated.replies.length, 2); assert.deepEqual(updated.pendingChanges, []);
  assert.ok(payload.body.includes('\\u002d\\u002d>'));
});

test('remote reopening replaces an acknowledged local resolution', async () => {
  const value = comment('reopen', { storageRepo: settings.storageRepo, issueNumber: 1, status: 'resolved', pendingChanges: [] });
  await cache.addComment(value);
  globalThis.fetch = async () => response([issue(value, 'open')]);
  assert.equal((await github.fetchComments(settings, value.urlHash))[0].status, 'open');
});

test('a stale fetch cannot overwrite a resolution acknowledged during the request', async () => {
  const value = comment('race', { storageRepo: settings.storageRepo, issueNumber: 1, pendingChanges: [] });
  await cache.addComment(value);
  const baseline = await cache.getCommentsForUrl(value.urlHash);
  await cache.addComment({ ...value, status: 'resolved', updatedAt: '2026-10-19T01:00:00Z' });
  await cache.mergeRemoteComments(value.urlHash, settings.storageRepo, [value], baseline);
  assert.equal((await cache.getCommentsForUrl(value.urlHash))[0].status, 'resolved');
});

test('a create acknowledged remotely after a timeout is linked without losing pending edits', async () => {
  const pending = comment('timeout', { storageRepo: settings.storageRepo, pendingChanges: ['content', 'replies'], replies: [{ id: 'reply', content: 'Encore une idée', author: comment().author, createdAt: comment().createdAt }] });
  await cache.addComment(pending);
  const remote = { ...pending, issueNumber: 42, issueUrl: 'https://github.com/team/project/issues/42', replies: [], pendingChanges: [] };
  await cache.mergeRemoteComments('cw_page', settings.storageRepo, [remote]);
  const stored = (await cache.getCommentsForUrl('cw_page'))[0];
  assert.equal(stored.issueNumber, 42);
  assert.equal(stored.replies.length, 1);
  assert.deepEqual(stored.pendingChanges, ['content', 'replies']);
});

test('HTTP errors retain pending state and report failed sync honestly', async () => {
  const value = comment('failure', { storageRepo: settings.storageRepo, issueNumber: 1 });
  await cache.addComment(value);
  globalThis.fetch = async (_url, options) => options.method === 'GET' ? response(issue(value)) : response({}, 403);
  const result = await github.toggleResolve(settings, value.id, value.urlHash);
  assert.equal(result.success, true); assert.equal(result.synced, false); assert.match(result.error, /403/);
  assert.deepEqual((await cache.getCommentsForUrl(value.urlHash))[0].pendingChanges, ['status']);
});

test('pagination loads discussions beyond the first 100', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response([issue(comment(`page-${calls}`, { storageRepo: settings.storageRepo, issueNumber: calls }))], 200,
      calls === 1 ? { Link: '<https://api.github.com/repos/team/project/issues?page=2>; rel="next"' } : {});
  };
  const comments = await github.fetchComments(settings, 'cw_page');
  assert.equal(calls, 2); assert.equal(comments.length, 2);
});

test('simultaneous page refreshes share one network request', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return response([]); };
  await Promise.all([github.fetchComments(settings, 'cw_page'), github.fetchComments(settings, 'cw_page')]);
  assert.equal(calls, 1);
});

test('share links never contain tokens, email addresses or fake authorization codes', () => {
  const encoded = encodeProjectConfig({ repo: 'team/project', token: 'secret', email: 'private@example.test', authCode: 'fake', url: 'https://example.test/équipe' });
  const json = Buffer.from(encoded, 'base64').toString();
  assert.ok(!json.includes('secret')); assert.ok(!json.includes('private')); assert.ok(!json.includes('fake'));
  assert.equal(decodeProjectConfig(encoded).repo, 'team/project');
  assert.equal(decodeProjectConfig(Buffer.from(JSON.stringify({ url: 'javascript:alert(1)' })).toString('base64')), null);
  assert.equal((projectLink('https://example.test/page#old').match(/#/g) || []).length, 1);
});

test('legacy shared credentials are ignored when decoding old links', () => {
  const old = Buffer.from(JSON.stringify({ repo: 'team/project', url: 'https://example.test/', token: 'old-secret' })).toString('base64');
  assert.equal(decodeProjectConfig(old).token, undefined);
});

test('repo parser rejects non-GitHub hosts and API path injection', () => {
  for (const invalid of ['https://evil.test/github.com/team/repo', 'https://github.com.evil.test/team/repo', 'https://github.com/owner/..', 'owner/..', 'owner/repo?access=bad']) assert.equal(parseGitHubRepo(invalid), null, invalid);
  assert.equal(parseGitHubRepo('https://github.com/kiou98/Commyweb.git').fullName, 'kiou98/Commyweb');
});

test('tracking URLs refer to the same canonical page', () => {
  assert.equal(normalizeUrl('https://example.test/page/?b=2&utm_source=email&a=1#section'), 'https://example.test/page?a=1&b=2');
});

test('legacy invite validation requires the exact code and email pair', async () => {
  const member = await cache.addOrInviteMember('cw_page', 'https://example.test/page', 'member@example.test');
  assert.equal(await cache.validateJoinCode('cw_page', 'cw_auth_fake', member.email), false);
  assert.equal(await cache.validateJoinCode('cw_page', member.authCode, 'other@example.test'), false);
  assert.equal(await cache.validateJoinCode('cw_page', member.authCode, member.email), true);
});

test('repository picker reads all pages and omits archived projects and disabled Issues', async () => {
  let calls = 0;
  globalThis.fetch = async url => {
    assert.ok(url.includes('/user/repos?'));
    calls++;
    return response(calls === 1 ? [
      { full_name: 'team/active', has_issues: true, private: true },
      { full_name: 'team/archived', has_issues: true, archived: true },
      { full_name: 'team/no-issues', has_issues: false }
    ] : [{ full_name: 'team/second', has_issues: true, private: false }], 200,
    calls === 1 ? { Link: '<https://api.github.com/user/repos?page=2>; rel="next"' } : {});
  };
  assert.deepEqual(await github.listRepositories('fake-token'), [{ fullName: 'team/active', private: true }, { fullName: 'team/second', private: false }]);
});

test('connection checks repository and Issues access without creating any GitHub data', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options.method]);
    return response(url.includes('/issues?') ? [] : { has_issues: true });
  };
  await github.verifyProject(settings);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([, method]) => method === 'GET'));
  globalThis.fetch = async () => response({}, 404);
  await assert.rejects(github.verifyProject(settings), /404/);
});
