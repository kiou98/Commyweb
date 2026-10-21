import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['netlify/lib/collaboration.mjs'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createCollaborationHandler } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const projectId = '50b02861-3b91-46e7-aaab-123456789012';
const ownerSecret = 'a'.repeat(64);
const page = 'https://client.example/review';
const token = 'fake-admin-token-never-shared';

export function memoryStore() {
  const records = new Map();
  return { records,
    async get(key) { return structuredClone(records.get(key) || null); },
    async setJSON(key, value, options = {}) { if (options.onlyIfNew && records.has(key)) return { modified: false }; records.set(key, structuredClone(value)); return { modified: true }; },
    async list({ prefix }) { return { blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
    async delete(key) { records.delete(key); }
  };
}

const request = async (handler, action, secret = ownerSecret, payload = {}) => {
  const response = await handler(new Request('https://service.example/collaboration', { method: 'POST',
    headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ action, projectId, ...payload }) }));
  return { response, body: await response.json() };
};

test('magic invitations connect without disclosing the admin token, are scoped, expire and can be revoked', async () => {
  const store = memoryStore();
  const calls = [];
  let clock = Date.parse('2026-10-19T00:00:00Z');
  const handler = createCollaborationHandler({ store, now: () => clock, githubFetch: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return Response.json(url.endsWith('/repos/team/project') ? { has_issues: true } : []);
  } });
  const created = await request(handler, 'invite', ownerSecret, { repo: 'team/project', token, url: page, email: 'alex@example.test' });
  assert.equal(created.response.status, 200);
  assert.equal(JSON.stringify(created.body).includes(token), false);
  const secret = created.body.invitation.secret;
  const impostor = await request(handler, 'invite', 'b'.repeat(64), { repo: 'team/project', token: 'other-token', url: page, email: 'other@example.test' });
  assert.equal(impostor.response.status, 403);
  assert.equal(store.records.get(`projects/${projectId}`).githubToken, token);
  assert.equal(secret.length, 64);
  assert.equal(JSON.stringify([...store.records.values()]).includes(secret), false);
  const joined = await request(handler, 'join', secret);
  assert.equal(joined.body.origin, 'https://client.example');
  assert.equal(joined.body.member.email, 'alex@example.test');
  assert.equal(JSON.stringify(joined.body).includes(token), false);
  assert.equal((await request(handler, 'members', secret)).response.status, 403);
  assert.equal((await request(handler, 'github', secret, { path: '/user', method: 'GET' })).response.status, 403);
  assert.equal((await request(handler, 'github', secret, { path: '/repos/other/private/issues', method: 'GET' })).response.status, 403);
  const authorized = await request(handler, 'github', secret, { path: '/repos/team/project/issues?labels=commyweb,cw_123&page=1', method: 'GET' });
  assert.equal(authorized.response.status, 200);
  assert.equal((await request(handler, 'github', secret, { path: '/repos/TEAM/PROJECT/issues', method: 'GET' })).response.status, 200);
  const members = await request(handler, 'members');
  assert.equal(members.body.members.length, 1);
  clock += 31 * 86400000;
  assert.equal((await request(handler, 'join', secret)).response.status, 403);
  clock -= 31 * 86400000;
  assert.equal((await request(handler, 'revoke', ownerSecret, { memberId: created.body.member.id })).response.status, 200);
  assert.equal((await request(handler, 'join', secret)).response.status, 403);
  assert.equal((await request(handler, 'members')).body.members.length, 0);
  assert.ok(calls.every(call => call.url.startsWith('https://api.github.com/repos/team/project')));
});

test('a GitHub failure cannot create an invitation or replace another admin project', async () => {
  const store = memoryStore();
  const handler = createCollaborationHandler({ store, githubFetch: async () => Response.json({}, { status: 401 }) });
  assert.equal((await request(handler, 'invite', ownerSecret, { repo: 'team/project', token, url: page, email: 'alex@example.test' })).response.status, 403);
  assert.equal(store.records.size, 0);
  const invalid = await handler(new Request('https://service.example/', { method: 'POST', body: '{bad' }));
  assert.equal(invalid.status, 400);
});

test('the invitation proxy filters other sites and rejects writes to unrelated threads', async () => {
  const store = memoryStore();
  const good = { id: 'good', url: page, urlHash: 'cw_1351818453', content: 'Un retour', replies: [], author: { id: 'admin', username: 'Admin' } };
  // Use the same URL hash implementation as the extension.
  let hash = 5381; for (const char of page) { hash = ((hash << 5) + hash) + char.charCodeAt(0); hash |= 0; }
  good.urlHash = `cw_${Math.abs(hash).toString(36)}`;
  const issue = (comment, number) => ({ number, state: 'open', body: `<!-- COMMYWEB_DATA\n${JSON.stringify(comment)}\n-->` });
  const unrelated = { ...good, id: 'other', url: 'https://private.example/review' };
  const handler = createCollaborationHandler({ store, githubFetch: async url => Response.json(url.endsWith('/repos/team/project') ? { has_issues: true }
    : url.endsWith('/issues/2') ? issue(unrelated, 2) : [issue(good, 1), issue(unrelated, 2)]) });
  const created = await request(handler, 'invite', ownerSecret, { repo: 'team/project', token, url: page, email: 'alex@example.test' });
  const secret = created.body.invitation.secret;
  assert.equal((await request(handler, 'github', secret, { path: '/repos/team/project/issues' })).body.length, 1);
  assert.equal((await request(handler, 'github', secret, { path: '/repos/team/project/issues/2' })).response.status, 403);
  assert.equal((await request(handler, 'github', secret, { path: '/repos/team/project/issues/2', method: 'PATCH', body: issue(good, 2) })).response.status, 403);
});
