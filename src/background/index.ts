import { READ_MESSAGES_KEY, unreadKeys } from '../utils/unread';
import { CacheManager } from '../storage/cache';
import { GitHubBackend } from '../storage/github';
import { ExtensionMessage, Author, UserSettings } from '../types';
import { normalizeUrl, hashUrl, extractDomain } from '../utils/security';
import { parseGitHubRepo } from '../utils/github-parser';

/**
 * Commyweb Background Service Worker (Manifest V3)
 */

const CONTEXT_MENU_ID = 'commyweb-add-comment';

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Ajouter un commentaire', // SANS EMOJI comme demandé
      contexts: ['all']
    }, () => {
      if (chrome.runtime.lastError) {
        // Ignorer si déjà existant
      }
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenu();
});

// Exécuter également au démarrage du worker
setupContextMenu();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    let targetTabId = tab?.id;
    if (!targetTabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      targetTabId = activeTab?.id;
    }
    if (!targetTabId) return;

    try {
      await chrome.tabs.sendMessage(targetTabId, {
        type: 'CONTEXT_MENU_ADD_COMMENT',
        payload: {
          selectionText: info.selectionText,
          linkUrl: info.linkUrl,
          srcUrl: info.srcUrl
        }
      });
    } catch {
      // Si l'onglet était déjà ouvert avant le chargement/reload de l'extension,
      // on injecte dynamiquement content.js et on réessaie immédiatement
      try {
        await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          files: ['content.js']
        });
        setTimeout(() => {
          chrome.tabs.sendMessage(targetTabId, {
            type: 'CONTEXT_MENU_ADD_COMMENT',
            payload: {
              selectionText: info.selectionText,
              linkUrl: info.linkUrl,
              srcUrl: info.srcUrl
            }
          }).catch(() => {});
        }, 120);
      } catch (injectErr) {
        console.warn('[Commyweb] Impossible d injecter content script sur cet onglet:', injectErr);
      }
    }
  }
});

// Handle keyboard shortcut command defined in manifest (Alt + C)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-comment-mode') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_COMMENT_MODE' }).catch(() => {});
    }
  }
});

function broadcastCommentsUpdated(urlHash?: string) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'COMMENTS_UPDATED',
          payload: { urlHash }
        }, () => {
          void chrome.runtime.lastError;
        });
      }
    }
  });
}

// Badge follows the persisted cache, including replies synchronized by open pages.
async function refreshUnreadBadge() {
  const [comments, data] = await Promise.all([
    CacheManager.getAllComments(),
    chrome.storage.local.get([READ_MESSAGES_KEY, 'commyweb_user', 'commyweb_settings'])
  ]);
  const read = new Set<string>(data[READ_MESSAGES_KEY] || []);
  const count = comments.reduce((total, comment) => total + unreadKeys(comment, read, data.commyweb_user, data.commyweb_settings?.userEmail).length, 0);
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await chrome.action.setBadgeText({ text: count ? (count > 99 ? '99+' : String(count)) : '' });
  await chrome.action.setTitle({ title: count ? 'Commyweb · ' + count + ' message(s) non lu(s)' : 'Commyweb' });
}
let unreadQueue = Promise.resolve();
function queueUnread(task: () => Promise<void>) {
  unreadQueue = unreadQueue.then(task).catch(error => console.warn('[Commyweb] Unread update failed', error));
  return unreadQueue;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(key => key.startsWith('commyweb_comments_') || key === READ_MESSAGES_KEY || key === 'commyweb_user' || key === 'commyweb_settings')) {
    queueUnread(refreshUnreadBadge);
  }
});
queueUnread(refreshUnreadBadge);

let syncingNotifications = false;
async function syncNotifications() {
  if (syncingNotifications) return;
  syncingNotifications = true;
  try {
    const settings = await CacheManager.getSettings();
    const projects = [settings, ...await Promise.all(
      (await CacheManager.getAllSiteProjects()).map(project => CacheManager.getSettings(project.domain))
    )];
    const repos = new Set<string>();
    for (const project of projects) {
      if (!project.storageRepo || !project.githubToken || repos.has(project.storageRepo)) continue;
      repos.add(project.storageRepo);
      // Notification polling must not upload another project's pending local comments.
      await GitHubBackend.fetchComments(project, 'all', false);
    }
    await queueUnread(refreshUnreadBadge);
    broadcastCommentsUpdated();
  } finally {
    syncingNotifications = false;
  }
}
chrome.alarms.create('commyweb-notifications', { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'commyweb-notifications') void syncNotifications().catch(console.warn);
});
void syncNotifications().catch(console.warn);

// Central message broker
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    try {
      const urlOrDomain =
        message.payload?.url ||
        message.payload?.comment?.url ||
        message.payload?.targetUrl ||
        _sender.tab?.url;
      const settings = await CacheManager.getSettings(urlOrDomain);

      switch (message.type) {
        case 'MARK_MESSAGES_READ': {
          const keys = message.payload?.keys;
          if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) {
            sendResponse({ success: false });
            break;
          }
          await queueUnread(async () => {
            const data = await chrome.storage.local.get(READ_MESSAGES_KEY);
            const read = new Set<string>(data[READ_MESSAGES_KEY] || []);
            keys.forEach(key => read.add(key));
            await chrome.storage.local.set({ [READ_MESSAGES_KEY]: [...read] });
          });
          sendResponse({ success: true });
          break;
        }
        case 'GET_PAGE_COMMENTS': {
          const urlHash = message.payload?.urlHash;
          const comments = await GitHubBackend.fetchComments(settings, urlHash);
          sendResponse({ comments });
          break;
        }

        case 'ADD_COMMENT': {
          const comment = message.payload?.comment;
          if (comment) {
            const res = await GitHubBackend.saveComment(settings, comment);
            broadcastCommentsUpdated(comment.urlHash);
            sendResponse(res);
          }
          break;
        }

        case 'UPDATE_COMMENT_ANCHOR': {
          const { commentId, urlHash, anchor } = message.payload || {};
          if (commentId && urlHash && anchor) {
            const comments = await CacheManager.getCommentsForUrl(urlHash);
            const comment = comments.find(c => c.id === commentId);
            if (comment) {
              comment.anchor = anchor;
              comment.updatedAt = new Date().toISOString();
              await CacheManager.saveCommentsForUrl(urlHash, comments);
              await GitHubBackend.updateCommentAnchor(settings, comment);
              broadcastCommentsUpdated(urlHash);
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false });
          }
          break;
        }

        case 'NAVIGATE_OR_FOCUS_COMMENT': {
          const { commentId, targetUrl, tabId } = message.payload || {};
          let destTabId = tabId;
          if (!destTabId) {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            destTabId = activeTab?.id;
          }
          if (destTabId && targetUrl && commentId) {
            const currentTab = await chrome.tabs.get(destTabId);
            const currentNorm = normalizeUrl(currentTab.url || '');
            const targetNorm = normalizeUrl(targetUrl);

            if (currentNorm === targetNorm) {
              chrome.tabs.sendMessage(destTabId, {
                type: 'FOCUS_COMMENT',
                payload: { commentId }
              }).catch(() => {});
            } else {
              const targetWithHash = targetUrl.includes('#')
                ? targetUrl.replace(/#.*$/, `#commyweb_focus=${commentId}`)
                : `${targetUrl}#commyweb_focus=${commentId}`;
              await chrome.tabs.update(destTabId, { url: targetWithHash });
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false });
          }
          break;
        }

        case 'ADD_REPLY': {
          const { commentId, urlHash, reply } = message.payload || {};
          if (commentId && urlHash && reply) {
            await GitHubBackend.addReply(settings, commentId, urlHash, reply);
            broadcastCommentsUpdated(urlHash);
            sendResponse({ success: true });
          }
          break;
        }

        case 'RESOLVE_COMMENT': {
          const { commentId, urlHash } = message.payload || {};
          if (commentId && urlHash) {
            const isResolved = await GitHubBackend.toggleResolve(settings, commentId, urlHash);
            broadcastCommentsUpdated(urlHash);
            sendResponse({ success: true, isResolved });
          }
          break;
        }

        case 'USER_SETTINGS_UPDATED': {
          if (settings.githubToken) {
            const user = await GitHubBackend.getCurrentUser(settings.githubToken);
            if (user) {
              await chrome.storage.local.set({ commyweb_user: user });
            }
          }
          sendResponse({ success: true });
          break;
        }

        case 'INVITE_MEMBER': {
          const { urlHash, url, email, addedBy } = message.payload || {};
          if (urlHash && email) {
            const member = await CacheManager.addOrInviteMember(urlHash, url || '', email, addedBy);
            sendResponse({ success: true, member });
          } else {
            sendResponse({ error: 'Missing email or urlHash' });
          }
          break;
        }

        case 'REVOKE_MEMBER': {
          const { urlHash, memberId } = message.payload || {};
          if (urlHash && memberId) {
            const success = await CacheManager.revokeMember(urlHash, memberId);
            sendResponse({ success });
          } else {
            sendResponse({ error: 'Missing parameters' });
          }
          break;
        }

        case 'GET_MEMBERS': {
          const { urlHash, url } = message.payload || {};
          if (urlHash) {
            const policy = await CacheManager.getPolicy(urlHash, url);
            sendResponse({ members: policy.members });
          } else {
            sendResponse({ members: [] });
          }
          break;
        }

        case 'VALIDATE_JOIN_CODE': {
          const { urlHash, code, email } = message.payload || {};
          if (urlHash && code) {
            const valid = await CacheManager.validateJoinCode(urlHash, code, email || '');
            sendResponse({ valid });
          } else {
            sendResponse({ valid: false });
          }
          break;
        }

        case 'AUTO_CONFIGURE_PROJECT': {
          const { repo, token, email, url, authCode } = message.payload || {};
          if (repo || token || email) {
            const updates: Partial<UserSettings> = {
              userRole: 'collaborator'
            };
            if (repo) {
              const parsed = parseGitHubRepo(repo);
              updates.storageRepo = parsed ? parsed.fullName : repo.trim();
            }
            if (token) updates.githubToken = token;
            if (email) updates.userEmail = email;
            await CacheManager.saveSettings(updates);

            if (email) {
              const displayName = email.split('@')[0];
              const user: Author = {
                id: email,
                username: displayName,
                name: displayName,
                email: email,
                avatarUrl: ''
              };
              await chrome.storage.local.set({ commyweb_user: user });
            }

            if (url && email) {
              const urlHash = hashUrl(normalizeUrl(url));
              await CacheManager.addOrInviteMember(urlHash, url, email, 'Admin Invite Link');
              if (authCode) {
                await CacheManager.validateJoinCode(urlHash, authCode, email);
              }
            }

            if (url && repo) {
              const domain = extractDomain(url);
              if (domain) {
                const parsed = parseGitHubRepo(repo);
                await CacheManager.saveSiteProject({
                  domain,
                  repo: parsed ? parsed.fullName : repo.trim(),
                  token,
                  name: domain
                });
              }
            }

            broadcastCommentsUpdated();
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false });
          }
          break;
        }

        case 'GET_SITE_PROJECTS': {
          const projects = await CacheManager.getAllSiteProjects();
          sendResponse({ projects });
          break;
        }

        case 'SAVE_SITE_PROJECT': {
          const { project } = message.payload || {};
          if (project && project.domain && project.repo) {
            await CacheManager.saveSiteProject(project);
            broadcastCommentsUpdated();
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Missing domain or repo' });
          }
          break;
        }

        case 'DELETE_SITE_PROJECT': {
          const { domain } = message.payload || {};
          if (domain) {
            await CacheManager.removeSiteProject(domain);
            broadcastCommentsUpdated();
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Missing domain' });
          }
          break;
        }

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (e: any) {
      console.error('[Commyweb Background Error]', e);
      sendResponse({ error: e.message });
    }
  })();

  return true;
});
