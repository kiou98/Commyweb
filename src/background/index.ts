import { CacheManager } from '../storage/cache';
import { GitHubBackend } from '../storage/github';
import { ResendService } from '../services/resend';
import { ExtensionMessage } from '../types';

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

// Central message broker
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    try {
      const settings = await CacheManager.getSettings();

      switch (message.type) {
        case 'GET_PAGE_COMMENTS': {
          const urlHash = message.payload?.urlHash;
          const comments = await GitHubBackend.fetchComments(settings, urlHash);
          sendResponse({ comments });
          break;
        }

        case 'ADD_COMMENT': {
          const comment = message.payload?.comment;
          if (comment) {
            await GitHubBackend.saveComment(settings, comment);
            sendResponse({ success: true });
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
            sendResponse({ success: true });
          }
          break;
        }

        case 'RESOLVE_COMMENT': {
          const { commentId, urlHash } = message.payload || {};
          if (commentId && urlHash) {
            const isResolved = await GitHubBackend.toggleResolve(settings, commentId, urlHash);
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
            
            // Attempt automatic email dispatch via Resend
            let emailSent = false;
            let emailError: string | undefined = undefined;

            if (settings.resendApiKey) {
              const resendResult = await ResendService.sendInviteEmail(settings, {
                recipientEmail: email,
                invitedByName: addedBy || 'Vincent',
                pageUrl: url || '',
                authCode: member.authCode
              });
              emailSent = resendResult.success;
              emailError = resendResult.error;
            } else {
              emailError = 'NO_API_KEY';
            }

            sendResponse({ success: true, member, emailSent, emailError });
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
