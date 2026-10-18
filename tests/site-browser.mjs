import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';

const root = resolve('site-dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.zip': 'application/zip', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };
const csp = (await readFile('netlify.toml', 'utf8')).match(/Content-Security-Policy = "([^"]+)"/)[1];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const path = resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
  if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const file = await readFile(path);
    response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', csp);
    response.end(file);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: /Le bon retour/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /commentaires/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://commyweb.netlify.app/');
  await expect(page.locator('a[href="https://neonea.nc/#contact"]')).toHaveCount(3);
  const social = await page.request.get(`${origin}/social-card.png`);
  assert.ok(social.ok());
  assert.ok((await page.request.get(`${origin}/robots.txt`)).ok());
  assert.ok((await page.request.get(`${origin}/sitemap.xml`)).ok());
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.getByText('Afficher les étapes d’installation', { exact: true }).click();
  await expect(page.getByText('edge://extensions', { exact: true })).toBeVisible();
  const audit = async label => {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), [], `${label}: accessibility violations`);
  };
  await audit('desktop home');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/site-neonea-desktop.png', fullPage: true });
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Home overflows at ${width}px`);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await audit('mobile home');
  await page.screenshot({ path: 'test-results/site-neonea-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: /Télécharger Commyweb/ }).click();
  const file = await download;
  const bytes = await readFile(await file.path());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  assert.ok(bytes.length > 100000);
  console.log('PASS: Netlify home and installation archive are usable without extension APIs');
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noScript.newPage();
  await staticPage.goto(origin);
  await expect(staticPage.getByRole('heading', { name: /Le bon retour/ })).toBeVisible();
  await expect(staticPage.getByRole('link', { name: /Télécharger Commyweb/ })).toBeVisible();
  await staticPage.getByText('Faut-il un compte GitHub pour utiliser Commyweb ?', { exact: true }).click();
  await expect(staticPage.getByText(/Vous pouvez prendre des notes en mode local/)).toBeVisible();
  await noScript.close();
  console.log('PASS: responsive layout, keyboard navigation, SEO metadata, contact links, no-script use and accessibility audits');
  const config = { repo: 'team/project', url: 'https://client.example/review', realtime: { endpoint: 'wss://relay.example/sync', channel: 's'.repeat(64) }, token: 'legacy-secret' };
  const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
  await page.goto(`${origin}/join.html#commyweb_config=${encoded}`);
  await expect(page.locator('#project-summary')).toHaveText('Projet : team/project');
  await expect(page.locator('#create-token')).toHaveCount(0);
  const target = await page.locator('#open-page').getAttribute('href');
  assert.ok(target.startsWith(config.url));
  const shared = JSON.parse(Buffer.from(new URLSearchParams(new URL(target).hash.slice(1)).get('commyweb_config'), 'base64').toString());
  assert.deepEqual(shared.realtime, config.realtime);
  assert.equal(shared.token, undefined);
  await expect(page.locator('input')).toHaveCount(0);
  await audit('legacy invitation');
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
