import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('site-dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.zip': 'application/zip' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const path = resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
  if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const file = await readFile(path);
    response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    response.end(file);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: /Les bons retours/ })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: /Télécharger Commyweb/ }).click();
  const file = await download;
  const bytes = await readFile(await file.path());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  assert.ok(bytes.length > 100000);
  console.log('PASS: Netlify home and installation archive are usable without extension APIs');
  const config = { repo: 'team/project', url: 'https://client.example/review', realtime: { endpoint: 'wss://relay.example/sync', channel: 's'.repeat(64) }, token: 'legacy-secret' };
  const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
  await page.goto(`${origin}/join.html#commyweb_config=${encoded}`);
  await expect(page.locator('#project-summary')).toHaveText('Projet : team/project');
  await expect(page.locator('#create-token')).toHaveAttribute('href', /target_name=team/);
  const target = await page.locator('#open-page').getAttribute('href');
  assert.ok(target.startsWith(config.url));
  const shared = JSON.parse(Buffer.from(new URLSearchParams(new URL(target).hash.slice(1)).get('commyweb_config'), 'base64').toString());
  assert.deepEqual(shared.realtime, config.realtime);
  assert.equal(shared.token, undefined);
  await expect(page.locator('input')).toHaveCount(0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/netlify-invitation.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.goto(`${origin}/join.html#commyweb_config=invalid`);
  await expect(page.locator('#project-summary')).toContainText('incomplète');
  await expect(page.locator('#join-steps')).toBeHidden();
  assert.deepEqual(errors, []);
  console.log('PASS: invitation guide preserves project/relay, strips old credentials, handles invalid links and fits mobile');
} finally {
  server.closeAllConnections();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
