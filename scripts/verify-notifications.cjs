// Run with: node scripts/verify-notifications.cjs (no network or browser profile needed).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

class Element {
  dataset = {};
  style = {};
  children = [];
  listeners = {};
  isConnected = true;
  classList = { add() {}, remove() {} };
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ''; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute() {}
  appendChild(child) { this.children.push(child); }
  prepend(child) { this.children.unshift(child); }
  querySelector(selector) { return this.nodes?.[selector] || null; }
  querySelectorAll() { return this.replies || []; }
}
const own = { id: 'me', username: 'Me', avatarUrl: '', email: 'me@example.com' };
const other = { id: 'other', username: 'Other', avatarUrl: '' };
const reply = (id, author = other, createdAt = '2026-10-20T12:00:00Z') => ({ id, author, createdAt, content: id });
const thread = (id, author = other, replies = []) => ({
  id, author, replies, urlHash: 'page', url: 'https://one.example/', content: id,
  createdAt: '2026-10-19T12:00:00Z', status: 'open', issueNumber: 1, anchor: {}
});
const data = { commyweb_user: own, commyweb_settings: {
  githubToken: 'test-token', storageRepo: 'owner/one',
  userEmail: own.email, projectsByDomain: { 'two.example': { domain: 'two.example', repo: 'owner/two' } }
} };
const storageListeners = [];
let broker;
let alarmListener;
let badge = '';
const alarms = [];
const sent = [];
const requests = [];
const chrome = {
  storage: {
    local: {
      async get(keys) {
        return structuredClone(keys === null ? data : Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, data[key]])));
      },
      async set(values) {
        Object.assign(data, structuredClone(values));
        storageListeners.forEach(listener => listener(Object.fromEntries(
          Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local'));
      }
    },
    onChanged: { addListener(listener) { storageListeners.push(listener); } }
  },
  action: {
    async setBadgeText({ text }) { badge = text; },
    async setBadgeBackgroundColor() {}, async setTitle() {}
  },
  alarms: {
    create(name, options) { alarms.push({ name, ...options }); },
    onAlarm: { addListener(listener) { alarmListener = listener; } }
  },
  runtime: {
    onInstalled: { addListener() {} }, onStartup: { addListener() {} },
    onMessage: { addListener(listener) { broker = listener; } },
    sendMessage(message) {
      sent.push(message);
      return new Promise(resolve => broker(message, {}, resolve));
    }
  },
  contextMenus: { removeAll(callback) { callback(); }, create() {}, onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  tabs: { query(_options, callback) { callback?.([]); return Promise.resolve([]); } },
  i18n: { getMessage(key) { return key; }, getUILanguage() { return 'en'; } }
};
const elements = { 'comments-list': new Element(), 'empty-state': new Element() };
const document = {
  visibilityState: 'visible',
  createElement() { return new Element(); }, getElementById(id) { return elements[id] || null; }
};
const window = { scrollX: 0, scrollY: 0, innerWidth: 1200, innerHeight: 900, close() {} };
const modules = new Map();
function load(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  let source = fs.readFileSync(filename, 'utf8');
  if (relative.endsWith('popup.ts')) source = source.replace('new PopupController();', 'export { PopupController };');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  modules.set(filename, module);
  const requireLocal = specifier => load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), specifier)) + '.ts');
  new Function('require', 'module', 'exports', 'chrome', 'document', 'window', 'setTimeout', 'fetch', code)(
    requireLocal, module, module.exports, chrome, document, window, () => {}, async (url, options = {}) => {
      requests.push({ url, ...options });
      return { ok: true, status: 200, headers: { get: () => url.includes('/one/') ? 'etag-one' : 'etag-two' }, json: async () => [] };
    });
  return module.exports;
}
async function settle() {
  for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const { READ_MESSAGES_KEY, messageKeys, unreadKeys, compareConversations } = load('src/utils/unread.ts');
  const comment = thread('thread', other, [reply('own', own), reply('new')]);
  assert.deepEqual(unreadKeys(comment, new Set(), own), ['page:thread', 'page:thread:new']);
  assert.deepEqual(messageKeys(thread('self', own, [reply('external')] ), own), ['page:self:external']);
  assert.deepEqual(messageKeys(thread('email', { ...other, email: 'ME@EXAMPLE.COM' }), undefined, own.email), []);
  assert.deepEqual(messageKeys(thread('anonymous', { ...other, id: 'anonymous' }), { ...own, id: 'anonymous' }), ['page:anonymous']);
  const read = new Set(messageKeys(comment, own));
  comment.replies.push(reply('later'));
  assert.deepEqual(unreadKeys(comment, read, own), ['page:thread:later']);
  assert.equal(unreadKeys({ ...comment, urlHash: 'another' }, read, own).length, 3);
  const newestRead = { ...thread('read'), createdAt: '2026-10-21T12:00:00Z' };
  const oldestUnread = thread('unread');
  const readNewest = new Set(['page:read']);
  assert.deepEqual([newestRead, oldestUnread].sort((a, b) => compareConversations(a, b, readNewest, own)).map(c => c.id), ['unread', 'read']);
  const recentReply = thread('activity', other, [reply('latest', other, '2026-10-22T12:00:00Z'), reply('out-of-order')]);
  assert.ok(compareConversations(recentReply, newestRead, new Set(), own) < 0);

  data.commyweb_comments_page = [comment, thread('pending', own)];
  delete data.commyweb_comments_page[1].issueNumber;
  load('src/background/index.ts');
  await settle();
  assert.equal(badge, '3');
  assert.equal(alarms[0].periodInMinutes, 2);
  assert.equal(new Set(requests.map(r => new URL(r.url).pathname)).size, 2);
  assert.ok(requests.every(r => !r.method || r.method === 'GET'), 'notification sync must not publish pending comments');
  requests.length = 0;
  alarmListener({ name: 'commyweb-notifications' });
  await settle();
  assert.equal(requests[0].headers['If-None-Match'], 'etag-one');
  assert.equal(requests[1].headers['If-None-Match'], 'etag-two');
  await Promise.all(['page:thread', 'page:thread:new'].map(key => chrome.runtime.sendMessage({ type: 'MARK_MESSAGES_READ', payload: { keys: [key] } })));
  await settle();
  assert.equal(badge, '1');
  assert.deepEqual(new Set(data[READ_MESSAGES_KEY]), new Set(['page:thread', 'page:thread:new']));
  assert.deepEqual(await chrome.runtime.sendMessage({ type: 'MARK_MESSAGES_READ', payload: { keys: [42] } }), { success: false });

  const { ThreadModal } = load('src/content/ui/thread-modal.ts');
  const modal = new ThreadModal({});
  const root = new Element();
  const ownReply = new Element(); ownReply.dataset.messageId = 'own';
  const newReply = new Element(); newReply.dataset.messageId = 'later';
  modal.currentCommentId = comment.id;
  modal.element.nodes = { '.commyweb-modal-body > .commyweb-comment-text': root };
  modal.element.replies = [ownReply, newReply];
  document.visibilityState = 'hidden';
  await modal.highlightAndRead(comment);
  assert.equal(unreadKeys(comment, new Set(data[READ_MESSAGES_KEY]), own).length, 1);
  document.visibilityState = 'visible';
  await modal.highlightAndRead(comment);
  await settle();
  assert.equal(newReply.dataset.unreadHighlighted, 'true');
  assert.equal(ownReply.dataset.unreadHighlighted, undefined);
  assert.equal(root.dataset.unreadHighlighted, undefined);
  assert.equal(badge, '');
  const refreshed = new Element(); refreshed.dataset.messageId = 'later';
  modal.element.replies = [refreshed];
  await modal.highlightAndRead(comment);
  assert.equal(refreshed.dataset.unreadHighlighted, 'true', 'highlight survives live refresh while thread stays open');

  const racing = thread('race');
  modal.currentCommentId = racing.id;
  const pendingRead = modal.highlightAndRead(racing);
  racing.replies.push(reply('arrived-during-read'));
  await pendingRead;
  assert.deepEqual(unreadKeys(racing, new Set(data[READ_MESSAGES_KEY]), own), ['page:race:arrived-during-read']);
  modal.currentCommentId = 'closed';
  modal.element.isConnected = false;
  await modal.highlightAndRead(thread('closed'));
  assert.ok(!data[READ_MESSAGES_KEY].includes('page:closed'));

  const { PopupController } = load('src/popup/popup.ts');
  const popup = Object.create(PopupController.prototype);
  Object.assign(popup, { comments: [newestRead, oldestUnread], readMessages: readNewest, notificationUser: own, activeFilter: 'all' });
  popup.renderCommentsList();
  assert.ok(elements['comments-list'].children[0].innerHTML.includes('unread'));
  const before = sent.length;
  elements['comments-list'].children[0].listeners.click();
  assert.deepEqual(sent.slice(before).map(message => message.type), ['NAVIGATE_OR_FOCUS_COMMENT']);

  await chrome.storage.local.set({ commyweb_comments_page: Array.from({ length: 101 }, (_, i) => thread(`many-${i}`)) });
  await settle();
  assert.equal(badge, '99+');
  assert.ok(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../manifest.json'))).permissions.includes('alarms'));
  console.log('PASS: own-message exclusion, unread ordering, page isolation, badge counts/99+, concurrent read receipts, two-project polling/ETags, no background uploads, visible-thread highlighting/read snapshots, live refresh, popup navigation without premature reads.');
})().catch(error => { console.error(error); process.exitCode = 1; });
