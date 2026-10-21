import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createRelay } from '../relay/server.mjs';
import { build } from 'esbuild';

const compiledService = await build({ entryPoints: ['netlify/lib/collaboration.mjs'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createCollaborationHandler } = await import(`data:text/javascript;base64,${Buffer.from(compiledService.outputFiles[0].text).toString('base64')}`);
const records = new Map();
const store = {
  async get(key) { return structuredClone(records.get(key) || null); },
  async setJSON(key, value, options = {}) { if (options.onlyIfNew && records.has(key)) return { modified: false }; records.set(key, structuredClone(value)); return { modified: true }; },
  async list({ prefix }) { return { blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
  async delete(key) { records.delete(key); }
};

const output = resolve('test-results');
await mkdir(output, { recursive: true });
const issues = [];
const apiCalls = [];
let holdWrites;
let releaseWrites;
const fixture = '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Collaboration temps réel</title><script>window.fragmentAtPageStart=location.hash</script><body style="font-family:system-ui;margin:80px"><h1 id="target">Une page pour toute l’équipe</h1><p>Deux navigateurs, deux comptes, un projet.</p></body></html>';
const api = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.url === '/page') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixture); return; }
  response.setHeader('Content-Type', 'application/json');
  apiCalls.push(`${request.method} ${request.url}`);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
  if (request.url === '/collaboration') {
    const result = await collaboration(new Request(`${origin}/collaboration`, { method: 'POST', headers: request.headers, body: JSON.stringify(payload) }));
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text()); return;
  }
  if (holdWrites && ['POST', 'PATCH'].includes(request.method)) await holdWrites;
  const url = new URL(request.url, 'http://localhost');
  const json = data => response.end(JSON.stringify(data));
  if (url.pathname === '/user/repos') { json([{ full_name: 'team/project', private: true, has_issues: true }]); return; }
  if (url.pathname === '/repos/team/project') { json({ has_issues: true }); return; }
  if (url.pathname === '/repos/team/project/issues' && request.method === 'GET') { json(issues); return; }
  if (url.pathname === '/repos/team/project/issues' && request.method === 'POST') {
    const number = issues.length + 1;
    const issue = { ...payload, number, state: 'open', html_url: `https://github.com/team/project/issues/${number}` };
    issues.push(issue); json(issue); return;
  }
  const match = url.pathname.match(/^\/repos\/team\/project\/issues\/(\d+)$/);
  if (match) {
    const issue = issues.find(item => item.number === Number(match[1]));
    if (issue) { if (request.method === 'PATCH') Object.assign(issue, payload); json(issue); return; }
  }
  response.writeHead(404); json({ message: 'Not found' });
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${api.address().port}`;
const targetUrl = `${origin}/page`;
const collaboration = createCollaborationHandler({ store, githubFetch: (url, options) => {
  const target = new URL(url); return fetch(`${origin}${target.pathname}${target.search}`, options);
} });
let relay = createRelay({ port: 0 });
const address = await relay.start();
const config = { endpoint: `ws://127.0.0.1:${address.port}/sync`, channel: 'realBrowserTestChannel'.padEnd(64, 'x') };
const contexts = [];
const errors = [];
try {
  const launch = async (name, edition = 'dist', invitation) => {
    const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'commyweb-live-')), {
      channel: 'chromium', headless: true, locale: 'fr-FR', deviceScaleFactor: process.env.COMMYWEB_CAPTURE_SITE === '1' ? 3 : 1, viewport: { width: 1100, height: 800 },
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${resolve(edition)}`, `--load-extension=${resolve(edition)}`]
    });
    contexts.push(context);
    context.setDefaultTimeout(8000);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await expect.poll(() => worker.evaluate(async () => !!(await chrome.storage.local.get('commyweb_settings')).commyweb_settings)).toBe(true);
    await worker.evaluate(async ({ origin, name, config, invitation }) => {
      const realFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (resource, options) => {
        const url = new URL(resource);
        if (url.href === 'https://commyweb.neonea.nc/.netlify/functions/collaboration') return realFetch(`${origin}/collaboration`, options);
        if (url.origin !== 'https://api.github.com') throw new Error('Unexpected external request');
        return realFetch(`${origin}${url.pathname}${url.search}`, options);
      };
      await chrome.storage.local.set({
        commyweb_settings: { projectsByDomain: invitation ? {} : { [new URL(origin).host]: { domain: new URL(origin).host, repo: 'team/project', token: `test-only-${name}`, realtime: config } } },
        commyweb_user: { id: name, name, username: name, avatarUrl: '' }
      });
    }, { origin, name, config, invitation });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const encoded = invitation ? Buffer.from(JSON.stringify({ url: targetUrl, repo: 'team/project', realtime: config, invitation })).toString('base64') : '';
    await page.goto(invitation ? `${targetUrl}#commyweb_config=${encoded}` : targetUrl);
    await page.locator('#commyweb-extension-host').waitFor({ state: 'attached' });
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).at(-1).id);
    const probe = await context.newPage();
    await probe.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await expect.poll(() => probe.evaluate(url => chrome.runtime.sendMessage({ type: 'GET_PAGE_COMMENTS', payload: { url } }), targetUrl)
      .then(result => result.realtimeStatus)).toBe('live');
    return { context, worker, page, tabId, probe };
  };
  const first = await launch('Camille');
  const invited = await first.probe.evaluate(url => chrome.runtime.sendMessage({ type: 'INVITE_MEMBER', payload: { url, email: 'alex@example.test' } }), targetUrl);
  assert.equal(invited.success, true);
  const second = await launch('Alex', 'dist-user', invited.invitation);
  const collaboratorSettings = await second.worker.evaluate(() => chrome.storage.local.get('commyweb_settings'));
  assert.ok(!JSON.stringify(collaboratorSettings).includes('test-only-'));
  assert.equal(collaboratorSettings.commyweb_settings.projectsByDomain[new URL(origin).host].collaboration.role, 'collaborator');
  const userManifest = await second.worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(userManifest.host_permissions.includes('https://api.github.com/*'), false);
  assert.equal(new URL(second.page.url()).hash, '');
  assert.equal(await second.page.evaluate(() => window.fragmentAtPageStart), '');
  console.log('PASS: the real Utilisateur edition joins from a magic link without a GitHub token or setup');
  const command = (client, type, payload = {}) => client.worker.evaluate(({ tabId, type, payload }) => chrome.tabs.sendMessage(tabId, { type, payload }), { tabId: client.tabId, type, payload });
  await command(first, 'SET_COMMENT_MODE', { active: true });
  await first.page.locator('#target').click();
  await first.page.locator('#new-comment-input').fill('Peux-tu rendre ce titre plus clair et garder un ton accueillant ?');
  const sentAt = Date.now();
  await first.page.locator('#btn-submit-new').click();
  await expect(second.page.locator('.commyweb-pin')).toHaveCount(1, { timeout: 4000 });
  const elapsed = Date.now() - sentAt;
  assert.ok(elapsed < 4000);
  console.log(`PASS: a remote comment arrives in ${elapsed} ms across two independent browser profiles`);

  await second.page.locator('.commyweb-pin').click();
  await first.page.locator('.commyweb-pin').click();
  await second.page.locator('#reply-input').fill('Je propose : « Parlons de votre projet ». Qu’en penses-tu ?');
  await second.page.locator('#btn-send-reply').click();
  await expect(first.page.locator('.commyweb-reply-item')).toHaveCount(1, { timeout: 4000 });
  await expect(first.page.locator('.commyweb-reply-author')).toHaveText('Alex');
  if (process.env.COMMYWEB_CAPTURE_SITE === '1') {
    await mkdir('site/screenshots', { recursive: true });
    await first.page.locator('.commyweb-modal').screenshot({ path: 'site/screenshots/discussion.png' });
    await first.page.locator('.commyweb-modal').screenshot({ path: 'site/screenshots/echanger.png' });
  }
  console.log('PASS: an open discussion receives replies through the relay');

  await first.page.locator('#btn-toggle-resolve').click();
  // Alex keeps the resolved discussion open; its resolve action must become Reopen.
  await expect(second.page.locator('#btn-toggle-resolve span')).toHaveText(/Rouvrir|Reopen/, { timeout: 4000 });
  console.log('PASS: remote resolution updates an open discussion immediately');

  await relay.close();
  relay = createRelay({ port: address.port });
  await relay.start();
  await expect.poll(() => second.probe.evaluate(url => chrome.runtime.sendMessage({ type: 'GET_PAGE_COMMENTS', payload: { url } }), targetUrl)
    .then(result => result.realtimeStatus)).toBe('live');
  await second.page.locator('#btn-toggle-resolve').click();
  await expect(first.page.locator('.commyweb-pin')).toHaveCount(1, { timeout: 4000 });
  console.log('PASS: reconnection after relay restart restores live updates');

  const popup = await first.context.newPage();
  await popup.setViewportSize({ width: 540, height: 900 });
  popup.on('pageerror', error => errors.push(error.message));
  await popup.addInitScript(({ tabId, targetUrl }) => {
    const get = chrome.tabs.get.bind(chrome.tabs);
    chrome.tabs.get = async id => ({ ...await get(id), ...(id === tabId ? { url: targetUrl } : {}) });
  }, { tabId: first.tabId, targetUrl });
  await popup.goto(`chrome-extension://${new URL(first.worker.url()).host}/popup.html?tabId=${first.tabId}&drawer=settings`);
  await expect(popup.locator('#comments-list')).toHaveAttribute('aria-busy', 'false');
  await expect(popup.locator('#btn-open-setup')).toHaveCount(0);
  await expect(popup.getByRole('button', { name: 'Inviter un collaborateur par email', exact: true }).locator('svg')).toBeVisible();
  await popup.locator('#input-storage-repo').fill('team/draft-project');
  await popup.locator('#input-github-token').fill('draft-token-not-verified');
  await popup.locator('#quick-author-name').fill('Camille en cours');
  await popup.locator('#realtime-settings summary').click();
  await popup.locator('#input-realtime-endpoint').fill('');
  await expect.poll(() => first.worker.evaluate(async domain => (await chrome.storage.local.get(`commyweb_setup_draft:${domain}`))[`commyweb_setup_draft:${domain}`]?.token, new URL(origin).host)).toBe('draft-token-not-verified');
  await first.worker.evaluate(() => chrome.storage.session.clear());
  // Reopen without a drawer override: the admin view and unverified inputs must survive.
  const reopenUrl = `chrome-extension://${new URL(first.worker.url()).host}/popup.html?tabId=${first.tabId}`;
  await popup.goto(reopenUrl);
  await expect(popup.locator('#settings-drawer')).toBeVisible();
  await expect(popup.locator('#input-storage-repo')).toHaveValue('team/draft-project');
  await expect(popup.locator('#input-github-token')).toHaveValue('draft-token-not-verified');
  await expect(popup.locator('#input-github-token')).toHaveAttribute('type', 'password');
  await expect(popup.locator('#quick-author-name')).toHaveValue('Camille en cours');
  await expect(popup.locator('#input-realtime-endpoint')).toHaveValue('');
  await expect(popup.locator('#realtime-settings')).toHaveAttribute('open', '');
  const unchanged = await first.worker.evaluate(async domain => ({ local: (await chrome.storage.local.get('commyweb_settings')).commyweb_settings.projectsByDomain[domain], sync: await chrome.storage.sync.get(null) }), new URL(origin).host);
  assert.equal(unchanged.local.repo, 'team/project');
  assert.equal(unchanged.local.token, 'test-only-Camille');
  assert.ok(!JSON.stringify(unchanged.sync).includes('draft-token-not-verified'));
  await popup.locator('#btn-toggle-invite').click();
  await popup.locator('#input-invite-email').fill('draft@example.test');
  await popup.locator('#join-details summary').click();
  await popup.locator('#input-join-link').fill('https://example.test/invitation');
  await popup.reload();
  await expect(popup.locator('#invite-drawer')).toBeVisible();
  await expect(popup.locator('#input-invite-email')).toHaveValue('draft@example.test');
  await expect(popup.locator('#input-join-link')).toHaveValue('https://example.test/invitation');
  await popup.locator('#invite-drawer [data-close]').click();
  await popup.reload();
  await expect(popup.locator('#settings-drawer')).toBeHidden();
  await expect(popup.locator('#invite-drawer')).toBeHidden();
  await popup.locator('#btn-toggle-settings').click();
  console.log('PASS: admin view, token, empty fields and invitation drafts survive reopening without connecting unverified values or syncing tokens');
  await popup.evaluate(() => { chrome.tabs.create = async options => { window.openedTokenUrl = options.url; return { id: 999, ...options }; }; });
  await popup.locator('#link-create-token').click();
  await expect.poll(() => popup.evaluate(() => window.openedTokenUrl)).toMatch(/^https:\/\/github.com\/settings\/personal-access-tokens\/new/);
  await popup.reload();
  await expect(popup.locator('#input-storage-repo')).toHaveValue('team/draft-project');
  await popup.locator('#input-storage-repo').fill('team/project');
  await popup.locator('#input-github-token').fill('test-only-Camille');
  await popup.locator('#input-realtime-endpoint').fill(config.endpoint);
  await expect(popup.locator('#link-create-token')).toHaveAttribute('href', /target_name=team/);
  await expect(popup.locator('#token-project-hint')).toContainText('project');
  await popup.locator('#btn-load-repositories').click();
  await expect(popup.locator('#select-github-repo')).toBeVisible();
  await popup.locator('#select-github-repo').selectOption('team/project');
  await popup.locator('#btn-save-settings').click();
  await expect(popup.locator('#toast')).toContainText('lecture GitHub vérifiée');
  await expect(popup.locator('#realtime-status')).toContainText('Temps réel actif');
  assert.equal(await first.worker.evaluate(async domain => (await chrome.storage.local.get(`commyweb_setup_draft:${domain}`))[`commyweb_setup_draft:${domain}`], new URL(origin).host), undefined);
  await popup.screenshot({ path: join(output, 'setup-realtime.png'), fullPage: true });
  if (process.env.COMMYWEB_CAPTURE_SITE === '1') {
    await mkdir('site/screenshots', { recursive: true });
    await popup.locator('#settings-drawer').screenshot({
      path: 'site/screenshots/configurer.png',
      style: '#settings-drawer > p, #btn-keep-open, #settings-form .setup-links, #settings-form .helper, #btn-load-repositories, #label-github-repo, #select-github-repo, #realtime-settings, #btn-local-mode { display:none!important }'
    });
  }
  console.log('PASS: prefilled token link, authenticated project selection and connection check work');

  await popup.locator('#btn-toggle-invite').click();
  await expect(popup.locator('#invite-title')).toContainText('email');
  await popup.locator('#input-invite-email').fill('alex@example.test');
  await popup.evaluate(() => document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="mailto:"]');
    if (link) { event.preventDefault(); window.testMailto = link.href; }
  }, true));
  await popup.locator('#btn-prepare-email').click();
  await expect.poll(() => popup.evaluate(() => window.testMailto)).toMatch(/^mailto:alex%40example.test\?/);
  const draft = await popup.evaluate(() => decodeURIComponent(window.testMailto));
  assert.ok(draft.includes('aucun compte GitHub ni jeton'));
  assert.ok(draft.includes('commyweb-user.zip'));
  assert.ok(!draft.includes('test-only-'));
  await expect(popup.locator('#toast')).toContainText('Envoyer');
  await popup.screenshot({ path: join(output, 'invite-email.png'), fullPage: true });
  if (process.env.COMMYWEB_CAPTURE_SITE === '1') {
    await popup.locator('#invite-drawer').screenshot({
      path: 'site/screenshots/inviter.png',
      style: '#invite-drawer details, #invite-drawer .invite-alternatives, #invite-drawer .members-section, #invite-drawer .helper:not(#invite-project-summary) { display:none!important }'
    });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: invitation opens an explicit email draft without sending or sharing tokens');

  await popup.locator('#btn-toggle-settings').click();
  await expect(popup.locator('#btn-keep-open')).toBeEnabled();
  // Keep the test tab available for assertions; the native panel API is not mocked.
  await popup.evaluate(() => { window.close = () => { window.popupClosed = true; }; });
  await popup.locator('#btn-keep-open').click();
  await expect.poll(() => popup.evaluate(() => window.popupClosed)).toBe(true);
  const panelContexts = () => first.worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
  await expect.poll(async () => (await panelContexts()).filter(context => context.documentUrl && new URL(context.documentUrl).searchParams.get('page') === targetUrl).length).toBe(1);
  const panel = (await panelContexts())[0];
  const panelUrl = new URL(panel.documentUrl);
  assert.equal(panelUrl.searchParams.get('page'), targetUrl);
  assert.equal(panelUrl.searchParams.get('tabId'), String(first.tabId));
  const otherTab = await first.context.newPage();
  await otherTab.goto('about:blank');
  await otherTab.bringToFront();
  assert.equal((await panelContexts())[0].documentId, panel.documentId);
  // Also open the exact panel resource as a test tab to inspect its DOM.
  const panelView = await first.context.newPage();
  await panelView.setViewportSize({ width: 360, height: 900 });
  await panelView.goto(panel.documentUrl);
  await expect(panelView.locator('#settings-drawer')).toBeVisible();
  await expect(panelView.locator('#active-site-domain')).toHaveText(new URL(origin).host);
  await expect(panelView.locator('#btn-keep-open')).toBeHidden();
  await expect(panelView.locator('body')).toHaveClass('side-panel settings-open');
  await expect(panelView.locator('#btn-add-comment')).toBeHidden();
  await expect(panelView.locator('#input-storage-repo')).toHaveValue('team/project');
  assert.equal(await panelView.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await panelView.screenshot({ path: join(output, 'persistent-configuration.png'), fullPage: true });
  await panelView.locator('#settings-drawer [data-close]').click();
  await expect(panelView.locator('#btn-add-comment')).toBeVisible();
  console.log('PASS: native side panel opens on a user click and survives tab switching while keeping the original website');

  const userPopup = await second.context.newPage();
  await userPopup.setViewportSize({ width: 390, height: 700 });
  await userPopup.addInitScript(({ tabId, targetUrl }) => {
    const get = chrome.tabs.get.bind(chrome.tabs);
    chrome.tabs.get = async id => ({ ...await get(id), ...(id === tabId ? { url: targetUrl } : {}) });
  }, { tabId: second.tabId, targetUrl });
  await userPopup.goto(`chrome-extension://${new URL(second.worker.url()).host}/popup.html?tabId=${second.tabId}`);
  await expect(userPopup.locator('#toggle-comments')).toBeEnabled();
  await expect(userPopup.locator('#btn-toggle-settings')).toBeHidden();
  await expect(userPopup.locator('#btn-toggle-invite')).toBeHidden();
  await expect(userPopup.locator('#input-github-token')).toBeHidden();
  await expect(userPopup.locator('#project-status-tag')).toHaveText('Équipe');
  await userPopup.locator('#toggle-comments').uncheck();
  await expect(second.page.locator('.commyweb-pin')).toHaveCount(0);
  await second.page.reload();
  await expect(second.page.locator('.commyweb-pin')).toHaveCount(0);
  await userPopup.locator('#toggle-comments').check();
  await expect(second.page.locator('.commyweb-pin')).toHaveCount(1);
  await userPopup.screenshot({ path: join(output, 'user-extension.png'), fullPage: true });
  console.log('PASS: Utilisateur has no admin configuration and the comment toggle hides, restores and remembers annotations');

  holdWrites = new Promise(resolve => { releaseWrites = resolve; });
  await second.page.bringToFront();
  await command(second, 'SET_COMMENT_MODE', { active: true });
  await second.page.locator('p').click();
  await second.page.locator('#new-comment-input').fill('Enregistrer sans attendre un GitHub bloqué.');
  await second.page.evaluate(() => {
    const shadow = document.getElementById('commyweb-extension-host').shadowRoot;
    const modal = shadow.querySelector('.commyweb-modal');
    window.localSaveLatency = new Promise(resolve => shadow.querySelector('#btn-submit-new').addEventListener('click', () => {
      const started = performance.now();
      const observer = new MutationObserver(() => { if (!modal.isConnected) { observer.disconnect(); resolve(performance.now() - started); } });
      observer.observe(shadow, { childList: true, subtree: true });
    }, { once: true }));
  });
  await second.page.locator('#btn-submit-new').click();
  await expect(second.page.locator('.commyweb-modal')).toHaveCount(0, { timeout: 1000 });
  await expect(second.page.locator('.commyweb-pin')).toHaveCount(2, { timeout: 1000 });
  const localElapsed = Math.round(await second.page.evaluate(() => window.localSaveLatency));
  assert.ok(localElapsed < 500, `Local save took ${localElapsed} ms`);
  await second.page.locator('.commyweb-pin').last().click();
  await second.page.locator('#reply-input').fill('La réponse reste immédiate elle aussi.');
  await second.page.locator('#btn-send-reply').click();
  await expect(second.page.locator('#reply-input')).toHaveValue('', { timeout: 1000 });
  await expect(second.page.locator('.commyweb-reply-item')).toHaveCount(1, { timeout: 1000 });
  await second.page.locator('#btn-toggle-resolve').click();
  await expect(second.page.locator('.commyweb-modal')).toHaveCount(0, { timeout: 1000 });
  await expect(second.page.locator('.commyweb-pin')).toHaveCount(1, { timeout: 1000 });
  releaseWrites(); holdWrites = undefined;
  await expect.poll(() => issues.length).toBe(2);
  await expect.poll(() => issues[1]?.state).toBe('closed');
  const confirmed = JSON.parse(issues[1].body.match(/<!-- COMMYWEB_DATA\s*([\s\S]*?)\s*-->/)[1]);
  assert.equal(confirmed.replies.length, 1);
  assert.equal(apiCalls.filter(call => call === 'POST /repos/team/project/issues').length, 2);
  console.log(`PASS: comment confirmed locally in ${localElapsed} ms while GitHub is blocked; reply and resolution also complete without waiting or losing edits`);

  await popup.locator('#btn-toggle-invite').click();
  await expect(popup.locator('.member-row')).toHaveCount(2);
  await popup.locator('.member-row').first().getByRole('button', { name: 'Retirer l’accès' }).click();
  await expect(popup.locator('#toast')).toContainText('Accès retiré');
  const revoked = await second.probe.evaluate(url => chrome.runtime.sendMessage({ type: 'GET_PAGE_COMMENTS', payload: { url } }), targetUrl);
  assert.match(revoked.syncError, /révoquée/);
  assert.equal(revoked.comments.length, 2);
  console.log('PASS: Admin revocation invalidates the collaborator link without deleting cached discussions');
  const replacement = draft.split('\n').find(line => line.startsWith(`${targetUrl}#commyweb_config=`));
  assert.ok(replacement);
  await userPopup.locator('#join-details summary').click();
  await userPopup.locator('#input-join-link').fill(replacement);
  const userPopupClosed = userPopup.waitForEvent('close');
  await userPopup.locator('#join-form button').click();
  await userPopupClosed;
  const rejoined = await second.probe.evaluate(url => chrome.runtime.sendMessage({ type: 'GET_PAGE_COMMENTS', payload: { url } }), targetUrl);
  assert.equal(rejoined.syncError, undefined);
  assert.equal(new URL(second.page.url()).hash, '');
  console.log('PASS: pasting a new magic link reconnects Utilisateur without exposing its secret to the website URL');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  for (let i = 0; i < contexts.length; i++) for (const [index, page] of contexts[i].pages().entries()) {
    await page.screenshot({ path: join(output, `live-failure-${i}-${index}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  releaseWrites?.();
  api.closeAllConnections();
  for (const context of contexts) await context.close();
  await relay.close();
  await new Promise(resolve => api.close(resolve));
}
