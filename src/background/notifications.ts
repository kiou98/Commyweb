import { CacheManager } from '../storage/cache';
import { GitHubBackend } from '../storage/github';
import { hasProjectAccess } from '../storage/collaboration';
import { READ_MESSAGES_KEY, unreadKeys } from '../utils/unread';

let unreadQueue = Promise.resolve();
function queueUnread(task: () => Promise<void>) {
  const result = unreadQueue.then(task);
  unreadQueue = result.catch(error => console.warn('[Commyweb] Unread update failed', error));
  return result;
}

async function refreshUnreadBadge() {
  const [comments, data] = await Promise.all([
    CacheManager.getAllComments(),
    chrome.storage.local.get([READ_MESSAGES_KEY, 'commyweb_user', 'commyweb_settings'])
  ]);
  const read = new Set<string>(data[READ_MESSAGES_KEY] || []);
  const count = comments.reduce((total, comment) => total + unreadKeys(comment, read,
    data.commyweb_user, data.commyweb_settings?.userEmail).length, 0);
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await chrome.action.setBadgeText({ text: count ? (count > 99 ? '99+' : String(count)) : '' });
  await chrome.action.setTitle({ title: count ? `Commyweb · ${count} message(s) non lu(s)` : 'Commyweb' });
}

export async function markMessagesRead(keys: unknown) {
  if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) throw new Error('Messages invalides.');
  await queueUnread(async () => {
    const data = await chrome.storage.local.get(READ_MESSAGES_KEY);
    const read = new Set<string>(data[READ_MESSAGES_KEY] || []);
    keys.forEach(key => read.add(key));
    await chrome.storage.local.set({ [READ_MESSAGES_KEY]: [...read] });
    await refreshUnreadBadge();
  });
  return { success: true };
}

let syncing = false;
export async function syncNotifications() {
  if (syncing) return;
  syncing = true;
  try {
    const projects = [await CacheManager.getSettings(), ...await Promise.all(
      (await CacheManager.getAllSiteProjects()).map(project => CacheManager.getSettings(project.domain)))];
    const repos = new Set<string>();
    for (const project of projects) {
      if (!hasProjectAccess(project) || repos.has(project.storageRepo!)) continue;
      repos.add(project.storageRepo!);
      // Polling reads every project without publishing pending edits from background.
      await GitHubBackend.fetchComments(project, 'all', false);
    }
    await queueUnread(refreshUnreadBadge);
  } finally { syncing = false; }
}

export function startNotifications() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some(key => key.startsWith('commyweb_comments_') ||
      key === READ_MESSAGES_KEY || key === 'commyweb_user' || key === 'commyweb_settings')) {
      void queueUnread(refreshUnreadBadge).catch(() => {});
    }
  });
  void queueUnread(refreshUnreadBadge).catch(() => {});
  chrome.alarms.create('commyweb-notifications', { periodInMinutes: 2 });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'commyweb-notifications') void syncNotifications().catch(console.warn);
  });
  void syncNotifications().catch(console.warn);
}
