import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = process.cwd();
const output = resolve(root, 'test-results');
await mkdir(output, { recursive: true });
const fixture = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Page de démonstration Commyweb</title><style>
body{font-family:system-ui;background:#f6f6f8;color:#18181b;margin:0}main{max-width:920px;margin:80px auto;padding:24px}h1{font-size:48px;letter-spacing:-2px}p{line-height:1.7}section{padding:32px;background:#fff;border:1px solid #e8e8ec;border-radius:20px}button{padding:12px 20px;border:0;background:#18181b;color:#fff;border-radius:10px;cursor:pointer}#scroll-box{height:130px;overflow:auto;margin-top:28px;background:#fff}#scroll-content{height:500px;padding:24px}footer{height:900px}</style></head><body><main><p>ATELIER / ESPACE ÉQUIPE</p><h1>Les détails font la différence.</h1><section id="panel:main"><h2 id="target">Une idée à partager ?</h2><p>Retrouvez votre équipe autour de retours précis, directement sur cette page.</p><button id="host-action" onclick="window.hostClicks=(window.hostClicks||0)+1">Continuer la navigation</button></section><div id="scroll-box"><div id="scroll-content"><button id="nested-target">Élément dans une zone défilante</button></div></div><a id="spa" href="/next" onclick="event.preventDefault();history.pushState({},'',this.href)">Changer de page</a><footer></footer></main></body></html>`;
const server = createServer(async (req, res) => {
  if (req.url === '/fixture' || req.url === '/next') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fixture); return; }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const path = resolve(root, 'dist', `.${pathname}`);
  if (!path.startsWith(resolve(root, 'dist'))) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'commyweb-test-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, locale: 'fr-FR', viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`]
  });
  context.setDefaultTimeout(10000);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/fixture`);
  await page.locator('#commyweb-extension-host').waitFor({ state: 'attached' });
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).at(-1).id);
  const popupUrl = `chrome-extension://${extensionId}/popup.html?tabId=${tabId}`;
  const openPopup = async () => {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 390, height: 600 });
    popup.on('pageerror', error => errors.push(error.message));
    // Opening via an extension URL does not grant activeTab like clicking the toolbar does.
    // Supply only that tab metadata; storage, messages and content scripts remain real.
    await popup.addInitScript(({ tabId, url }) => {
      const original = chrome.tabs.get.bind(chrome.tabs);
      chrome.tabs.get = async id => { const tab = await original(id); return id === tabId ? { ...tab, url } : tab; };
    }, { tabId, url: page.url() });
    await popup.goto(popupUrl);
    await expect(popup.locator('#comments-list')).toHaveAttribute('aria-busy', 'false');
    return popup;
  };
  const command = (type, payload = {}) => worker.evaluate(({ tabId, type, payload }) => chrome.tabs.sendMessage(tabId, { type, payload }), { tabId, type, payload });

  await page.locator('#host-action').click();
  assert.equal(await page.evaluate(() => window.hostClicks), 1);
  await expect(page.locator('.commyweb-modal')).toHaveCount(0);
  console.log('PASS: normal browsing works immediately after loading the extension');

  let popup = await openPopup();
  await popup.screenshot({ path: join(output, 'popup-empty.png'), fullPage: true });
  await popup.locator('#quick-author-name').fill('Camille');
  await popup.locator('#quick-author-name').press('Tab');
  await popup.getByRole('button', { name: 'Ajouter un commentaire' }).click();
  await page.bringToFront();
  await page.locator('#target').click();
  const draft = page.locator('#new-comment-input');
  await expect(draft).toBeVisible();
  await draft.fill('Rendre ce titre plus clair.');
  await draft.press('Shift+Enter');
  await draft.type('Et garder un ton accueillant.');
  await expect(draft).toHaveValue('Rendre ce titre plus clair.\nEt garder un ton accueillant.');
  if (process.env.COMMYWEB_CAPTURE_SITE === '1') {
    await mkdir('site/screenshots', { recursive: true });
    await page.locator('.commyweb-modal').screenshot({ path: 'site/screenshots/commenter.png' });
  }
  await page.locator('#btn-submit-new').click();
  await expect(page.locator('.commyweb-pin')).toHaveCount(1);
  await expect(page.locator('.commyweb-modal')).toHaveCount(0);
  await page.locator('#host-action').click();
  assert.equal(await page.evaluate(() => window.hostClicks), 2);
  assert.equal((await command('GET_COMMENT_MODE')).isCommentModeActive, false);
  console.log('PASS: multiline comment persists locally and normal browsing resumes');

  await page.locator('.commyweb-pin').click();
  await expect(page.locator('.commyweb-comment-text').first()).toContainText('Rendre ce titre');
  await page.locator('#reply-input').fill('Brouillon à conserver');
  await page.locator('#reply-input').press('Escape');
  await expect(page.locator('.commyweb-modal')).toHaveCount(0);
  await page.locator('.commyweb-pin').press('Enter');
  await expect(page.locator('#reply-input')).toHaveValue('Brouillon à conserver');
  await page.locator('#btn-send-reply').click();
  await expect(page.locator('.commyweb-reply-item')).toHaveCount(1);
  await expect(page.locator('#reply-input')).toHaveValue('');
  await page.screenshot({ path: join(output, 'thread.png'), fullPage: false });
  if (process.env.COMMYWEB_CAPTURE_SITE === '1') {
    await page.screenshot({ path: 'site/screenshots/discussion.png' });
    await page.locator('.commyweb-modal').screenshot({ path: 'site/screenshots/echanger.png' });
  }
  console.log('PASS: keyboard opening, draft preservation and replying work');

  await page.locator('#btn-toggle-resolve').click();
  await expect(page.locator('.commyweb-pin')).toHaveCount(0);
  popup = await openPopup();
  await expect(popup.locator('#count-resolved')).toHaveText('1');
  await popup.locator('.card-open').click();
  await expect(page.locator('.commyweb-modal')).toBeVisible();
  await page.locator('#btn-toggle-resolve').click();
  await expect(page.locator('.commyweb-pin')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.commyweb-pin')).toHaveCount(1);
  await page.locator('.commyweb-pin').click();
  await expect(page.locator('.commyweb-reply-item')).toHaveCount(1);
  console.log('PASS: resolve, open a resolved thread, reopen and reload preserve discussions');

  await page.locator('#reply-input').press('Escape');
  const before = await page.locator('.commyweb-pin').boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down(); await page.mouse.move(700, 450, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await page.locator('.commyweb-pin').boundingBox()).x).toBeGreaterThan(before.x + 20);
  console.log('PASS: dragging a pin updates its saved position');

  await command('SET_COMMENT_MODE', { active: true });
  await page.locator('#target').click();
  await page.locator('#new-comment-input').fill('Écrire près du bord');
  await page.setViewportSize({ width: 360, height: 480 });
  await page.locator('#new-comment-input').press('Escape');
  await command('SET_COMMENT_MODE', { active: true });
  await page.mouse.click(330, 410);
  await expect(page.locator('.commyweb-modal')).toBeVisible();
  const bounds = await page.locator('.commyweb-modal').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360 && bounds.y >= 0 && bounds.y + bounds.height <= 480, JSON.stringify(bounds));
  await expect(page.locator('#new-comment-input')).toHaveValue('Écrire près du bord');
  await page.locator('#new-comment-input').press('Escape');
  console.log('PASS: narrow viewport keeps the composer visible and preserves the draft');

  await page.setViewportSize({ width: 1280, height: 900 });
  popup = await openPopup();
  await popup.locator('#btn-toggle-invite').click();
  await popup.locator('#join-details summary').click();
  await popup.locator('#input-join-link').fill(`${origin}/fixture#commyweb_config=${Buffer.from(JSON.stringify({ repo: 'team/project', token: 'never-import-this', url: `${origin}/fixture` })).toString('base64')}`);
  await popup.locator('#join-form button').click();
  await expect.poll(() => page.url()).toBe(`${origin}/fixture`);
  await expect.poll(async () => (await worker.evaluate(() => chrome.storage.local.get('commyweb_settings'))).commyweb_settings?.projectsByDomain?.[new URL(origin).host]?.repo).toBe('team/project');
  const all = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.ok(!JSON.stringify(all).includes('never-import-this'));
  console.log('PASS: legacy invitations select the right project without importing credentials');

  popup = await openPopup();
  if (await popup.locator('#settings-drawer').isHidden()) await popup.locator('#btn-toggle-settings').click();
  await popup.locator('#input-storage-repo').fill('invalid');
  await popup.locator('#input-github-token').fill('fake-token');
  await popup.locator('#btn-save-settings').click();
  await expect(popup.locator('#toast')).toContainText('dépôt valide');
  await popup.locator('#btn-local-mode').click();
  await expect(popup.locator('#count-all')).toHaveText('1');
  await popup.screenshot({ path: join(output, 'popup-comments.png'), fullPage: true });
  if (process.env.COMMYWEB_CAPTURE_SITE === '1') await popup.screenshot({ path: 'site/screenshots/suivi.png', fullPage: true });
  await popup.close();
  await page.locator('#spa').click();
  await expect(page.locator('.commyweb-pin')).toHaveCount(0, { timeout: 4000 });
  await page.goBack();
  await expect(page.locator('.commyweb-pin')).toHaveCount(1, { timeout: 4000 });
  console.log('PASS: settings validate input, local mode restores local comments, SPA pages stay separate');

  await command('SET_COMMENT_MODE', { active: true });
  await page.locator('#nested-target').click();
  await page.locator('#new-comment-input').fill('Commentaire dans le défilement interne');
  await page.locator('#btn-submit-new').click();
  await expect(page.locator('.commyweb-pin')).toHaveCount(2);
  const nested = page.locator('.commyweb-pin').last();
  const nestedBefore = await nested.boundingBox();
  await page.locator('#scroll-box').evaluate(el => { el.scrollTop = 50; });
  await expect.poll(async () => Math.round((await nested.boundingBox()).y)).toBe(Math.round(nestedBefore.y - 50));
  console.log('PASS: pins track scrolling inside nested containers');

  assert.deepEqual(errors, []);
  console.log('PASS: no uncaught browser errors');
} catch (error) {
  console.error(error);
  if (context) for (const [index, page] of context.pages().entries()) await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
  throw error;
} finally {
  server.closeAllConnections();
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
