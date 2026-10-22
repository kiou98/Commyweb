import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { build } from 'esbuild';
import { createRelay } from '../relay/server.mjs';

const compiled = await build({ stdin: { contents: `export * from './src/utils/github-setup'; export * from './src/utils/realtime'; export * from './src/utils/email-template'; export * from './src/background/realtime';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { githubTokenUrl, invitationEmail, validateInvitationRecipient, realtimeEndpoint, normalizeRealtime, projectLink, decodeProjectConfig, RealtimeManager } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const channel = 'a'.repeat(64);

test('token creation link prefills only documented owner and least-needed permissions', () => {
  const url = new URL(githubTokenUrl('team/project'));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.searchParams.get('target_name'), 'team');
  assert.equal(url.searchParams.get('issues'), 'write');
  assert.equal(url.searchParams.get('metadata'), 'read');
  assert.equal(url.searchParams.get('contents'), null);
  assert.equal(url.searchParams.get('repositories'), null);
  assert.ok(url.searchParams.get('name').length <= 40);
});

test('email invitation includes HTML formatting, installation and project steps', () => {
  const email = invitationEmail('https://example.test/page', 'team/project', 'Camille');
  assert.doesNotThrow(() => validateInvitationRecipient('member@example.test'));
  assert.match(email.html, /<h2[^>]*>Objet : Camille/);
  assert.match(email.html, /<strong>1\.<\/strong>/);
  assert.match(email.html, /href="https:\/\/commyweb.neonea.nc\/downloads\/commyweb-user.zip"/);
  assert.ok(email.html.includes('chrome://extensions'));
  assert.ok(email.body.includes('chrome://extensions'));
  assert.ok(email.body.includes('Créer mon jeton GitHub'));
  assert.ok(email.body.includes('team/project'));
  assert.equal(new URL(email.link).origin, 'https://example.test');
  assert.ok(email.body.includes('modale de l’extension'));
  assert.throws(() => validateInvitationRecipient('user@example.test?bcc=evil@example.test'));
});

test('HTML invitation escapes names and URLs while preserving the personal link', () => {
  const link = 'https://example.test/page?first=1&second=2#commyweb_config=abc';
  const email = invitationEmail('https://example.test/page', 'team/project', '<img src=x onerror="alert(1)"> & Camille', undefined, link);
  assert.ok(email.html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Camille'));
  assert.ok(!email.html.includes('<img'));
  assert.ok(email.html.includes(`href="${link.replace('&', '&amp;')}"`));
  assert.ok(email.html.includes('aucun compte GitHub ni jeton'));
  assert.ok(email.html.includes('30 jours'));
  assert.ok(email.body.includes(link));
});

test('realtime configuration rejects unsafe endpoints and invalid channels', () => {
  assert.equal(realtimeEndpoint('http://example.test'), null);
  assert.equal(realtimeEndpoint('ws://example.test/sync'), null);
  assert.equal(realtimeEndpoint('wss://user:secret@example.test/sync'), null);
  assert.equal(realtimeEndpoint('wss://example.test/sync?token=secret'), null);
  assert.equal(realtimeEndpoint('wss://example.test'), 'wss://example.test/sync');
  assert.equal(realtimeEndpoint('ws://127.0.0.1:3000'), 'ws://127.0.0.1:3000/sync');
  assert.equal(normalizeRealtime({ endpoint: 'wss://example.test', channel: 'guessable' }), null);
});

test('shared links carry realtime configuration without importing a GitHub token', () => {
  const config = { endpoint: 'wss://example.test/sync', channel };
  const link = new URL(projectLink('https://website.test/page', 'team/project', config));
  const decoded = decodeProjectConfig(new URLSearchParams(link.hash.slice(1)).get('commyweb_config'));
  assert.deepEqual(decoded.realtime, config);
  assert.equal(decoded.token, undefined);
});

test('relay sends only invalidations to subscribers in the same channel', async () => {
  const relay = createRelay({ port: 0 });
  const address = await relay.start();
  const clients = [];
  const connect = async selected => {
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/sync`, 'commyweb.v1');
    clients.push(client);
    await once(client, 'open');
    const ready = once(client, 'message');
    client.send(JSON.stringify({ type: 'subscribe', channel: selected }));
    assert.equal(JSON.parse((await ready)[0]).type, 'ready');
    return client;
  };
  try {
    const author = await connect(channel);
    const colleague = await connect(channel);
    const other = await connect('b'.repeat(64));
    const outsiders = [];
    other.on('message', bytes => outsiders.push(bytes.toString()));
    const changed = once(colleague, 'message');
    author.send(JSON.stringify({ type: 'changed', token: 'must-never-be-forwarded', body: 'private text' }));
    assert.equal((await changed)[0].toString(), '{"type":"changed"}');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(outsiders, []);
  } finally { clients.forEach(client => client.terminate()); await relay.close(); }
});

test('manager reconnects and receives changes after a relay restart', async () => {
  globalThis.WebSocket = WebSocket;
  let relay = createRelay({ port: 0 });
  const address = await relay.start();
  const config = { endpoint: `ws://127.0.0.1:${address.port}/sync`, channel };
  let updates = 0;
  const manager = new RealtimeManager(() => updates++);
  const waitFor = async predicate => {
    const started = Date.now();
    while (!predicate()) { if (Date.now() - started > 4000) throw new Error('Realtime reconnect timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  try {
    manager.watch(config);
    await waitFor(() => updates === 1);
    assert.equal(manager.watch(config), 'live');
    await relay.close();
    await waitFor(() => manager.watch(config) === 'reconnecting');
    relay = createRelay({ port: address.port });
    await relay.start();
    await waitFor(() => updates === 2);
    assert.equal(manager.watch(config), 'live');
  } finally { manager.closeAll(); await relay.close(); }
});
