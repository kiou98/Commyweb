import { CacheManager } from '../storage/cache';
import { GitHubBackend } from '../storage/github';
import { ExtensionMessage } from '../types';
import { normalizeUrl, extractDomain } from '../utils/security';
import { parseGitHubRepo } from '../utils/github-parser';
import { RealtimeManager } from './realtime';
import { normalizeRealtime } from '../utils/realtime';
import { collaborationRequest, hasProjectAccess, isUserEdition, newAccessSecret } from '../storage/collaboration';

const MENU_ID = 'commyweb-add-comment';
let notificationTimer: ReturnType<typeof setTimeout> | undefined;
const realtime = new RealtimeManager(() => {
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => { void broadcast(); }, 150);
}, () => { void chrome.runtime.sendMessage({ type: 'REALTIME_STATUS_UPDATED' }).catch(() => {}); });
GitHubBackend.onSynced = settings => { realtime.publish(settings.realtime); void broadcast(); };
GitHubBackend.onSyncError = () => { void broadcast(undefined, true); };

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Ajouter un commentaire Commyweb', contexts: ['all'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
}
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
  void CacheManager.saveSettings({});
});
chrome.runtime.onStartup.addListener(setupContextMenu);

async function sendToPage(tabId: number, message: unknown) {
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id) {
    void sendToPage(tab.id, { type: 'CONTEXT_MENU_ADD_COMMENT' }).catch(console.warn);
  }
});
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-comment-mode') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && /^https?:\/\//.test(tab.url || '')) {
    void sendToPage(tab.id, { type: 'TOGGLE_COMMENT_MODE' }).catch(console.warn);
  }
});

async function broadcast(urlHash?: string, cacheOnly = false) {
  void chrome.runtime.sendMessage({ type: 'COMMENTS_UPDATED', payload: { urlHash, cacheOnly } }).catch(() => {});
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id) {
      void chrome.tabs.sendMessage(tab.id, { type: 'COMMENTS_UPDATED', payload: { urlHash, cacheOnly } }).catch(() => {});
    }
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === 'COMMENTS_UPDATED' || message.type === 'REALTIME_STATUS_UPDATED') return;
  void (async () => {
    const payload = message.payload || {};
    const settings = await CacheManager.getSettings(payload.url || payload.comment?.url || payload.targetUrl || sender.tab?.url);
    if (isUserEdition() && ['INVITE_MEMBER', 'REVOKE_MEMBER', 'GET_MEMBERS', 'SAVE_SITE_PROJECT', 'VERIFY_GITHUB_PROJECT', 'LIST_GITHUB_REPOSITORIES', 'DELETE_SITE_PROJECT'].includes(message.type)) throw new Error('Cette action est réservée à l’extension Admin.');
    switch (message.type) {
      case 'GET_PAGE_COMMENTS': {
        const realtimeStatus = hasProjectAccess(settings) ? realtime.watch(settings.realtime) : 'off';
        const comments = payload.cacheOnly
          ? (await CacheManager.getCommentsForUrl(payload.urlHash)).filter(c => CacheManager.belongsToProject(c, settings.storageRepo))
          : await GitHubBackend.fetchComments(settings, payload.urlHash);
        return { success: true, comments, syncError: GitHubBackend.getSyncError(settings), realtimeStatus };
      }
      case 'LIST_GITHUB_REPOSITORIES': return { success: true, repositories: await GitHubBackend.listRepositories(payload.token || '') };
      case 'VERIFY_GITHUB_PROJECT': {
        await GitHubBackend.verifyProject({ githubToken: payload.token, storageRepo: payload.repo });
        return { success: true };
      }
      case 'ADD_COMMENT': {
        if (!payload.comment?.content?.trim()) throw new Error('Le commentaire est vide.');
        const result = await GitHubBackend.saveComment(settings, payload.comment, false);
        void broadcast(payload.comment.urlHash, true);
        return result;
      }
      case 'ADD_REPLY': {
        if (!payload.reply?.content?.trim()) throw new Error('La réponse est vide.');
        const result = await GitHubBackend.addReply(settings, payload.commentId, payload.urlHash, payload.reply, false);
        void broadcast(payload.urlHash, true);
        return result;
      }
      case 'RESOLVE_COMMENT': {
        const result = await GitHubBackend.toggleResolve(settings, payload.commentId, payload.urlHash, false);
        void broadcast(payload.urlHash, true);
        return result;
      }
      case 'UPDATE_COMMENT_ANCHOR': {
        const comments = await CacheManager.getCommentsForUrl(payload.urlHash);
        const comment = comments.find(c => c.id === payload.commentId && CacheManager.belongsToProject(c, settings.storageRepo));
        if (!comment) throw new Error('Discussion introuvable.');
        const result = await GitHubBackend.updateCommentAnchor(settings, { ...comment, anchor: payload.anchor }, false);
        void broadcast(payload.urlHash, true);
        return result;
      }
      case 'NAVIGATE_OR_FOCUS_COMMENT': {
        const { commentId, targetUrl, tabId } = payload;
        if (!commentId || !/^https?:\/\//.test(targetUrl || '')) throw new Error('Page indisponible.');
        const targetId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
        if (!targetId) throw new Error('Onglet introuvable.');
        const tab = await chrome.tabs.get(targetId);
        if (normalizeUrl(tab.url || '') === normalizeUrl(targetUrl)) {
          await sendToPage(targetId, { type: 'FOCUS_COMMENT', payload: { commentId } });
        } else {
          const url = new URL(targetUrl);
          url.hash = `commyweb_focus=${encodeURIComponent(commentId)}`;
          await chrome.tabs.update(targetId, { url: url.href });
        }
        return { success: true };
      }
      case 'SAVE_SITE_PROJECT': {
        const project = payload.project;
        if (!project?.domain || (project.repo && !parseGitHubRepo(project.repo))) throw new Error('Dépôt GitHub invalide.');
        await CacheManager.saveSiteProject(project);
        await broadcast();
        return { success: true };
      }
      case 'AUTO_CONFIGURE_PROJECT': {
        // Sharing a link selects a repository; it never imports credentials or grants rights.
        const repo = parseGitHubRepo(payload.repo)?.fullName;
        if (!repo || !/^https?:\/\//.test(payload.url || '')) throw new Error('Lien de projet invalide.');
        const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
        if (sender.tab?.url && !fromExtensionPage && normalizeUrl(sender.tab.url) !== normalizeUrl(payload.url)) throw new Error('Le lien ne correspond pas à cette page.');
        const domain = extractDomain(payload.url);
        const previous = await CacheManager.getSiteProject(domain);
        if (payload.invitation) {
          const access = { ...payload.invitation, role: 'collaborator' as const };
          const joined = await (await collaborationRequest('join', access)).json();
          if (joined.origin !== new URL(payload.url).origin || joined.repo.toLowerCase() !== repo.toLowerCase()) throw new Error('Cette invitation ne correspond pas à ce site.');
          await CacheManager.saveSiteProject({ domain, repo, token: '', collaboration: access, realtime: normalizeRealtime(payload.realtime) });
          const user = (await chrome.storage.local.get('commyweb_user')).commyweb_user;
          await chrome.storage.local.set({ commyweb_user: { id: joined.member.id, username: joined.member.email.split('@')[0],
            name: user?.name || joined.member.email.split('@')[0], email: joined.member.email, avatarUrl: '' } });
          await broadcast();
          return { success: true, connected: true };
        }
        await CacheManager.saveSiteProject({ domain, repo, token: previous?.repo.toLowerCase() === repo.toLowerCase() ? previous.token : '',
          realtime: normalizeRealtime(payload.realtime) || (previous?.repo.toLowerCase() === repo.toLowerCase() ? previous.realtime : null) });
        await broadcast();
        return { success: true };
      }
      case 'INVITE_MEMBER': {
        if (!settings.githubToken || !settings.storageRepo || !/^https?:\/\//.test(payload.url || '')) throw new Error('Connectez votre projet GitHub avant d’inviter.');
        const domain = extractDomain(payload.url);
        const access = settings.collaboration?.role === 'admin' ? settings.collaboration
          : { projectId: crypto.randomUUID(), secret: newAccessSecret(), role: 'admin' as const };
        await CacheManager.saveSiteProject({ domain, repo: settings.storageRepo, token: settings.githubToken, realtime: settings.realtime, collaboration: access });
        const result = await (await collaborationRequest('invite', access, { repo: settings.storageRepo, token: settings.githubToken, url: payload.url, email: payload.email })).json();
        return result;
      }
      case 'GET_MEMBERS': {
        if (settings.collaboration?.role !== 'admin') return { success: true, members: [] };
        return (await collaborationRequest('members', settings.collaboration)).json();
      }
      case 'REVOKE_MEMBER': {
        if (settings.collaboration?.role !== 'admin') throw new Error('Accès administrateur nécessaire.');
        return (await collaborationRequest('revoke', settings.collaboration, { memberId: payload.memberId })).json();
      }
      case 'GET_SITE_PROJECTS': return { success: true, projects: await CacheManager.getAllSiteProjects() };
      case 'DELETE_SITE_PROJECT': {
        await CacheManager.removeSiteProject(payload.domain);
        await broadcast();
        return { success: true };
      }
      default: throw new Error('Action inconnue.');
    }
  })().then(sendResponse).catch(error => sendResponse({ success: false, error: error instanceof Error ? error.message : 'Action impossible.' }));
  return true;
});
