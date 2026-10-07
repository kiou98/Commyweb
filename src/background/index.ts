import { CacheManager } from '../storage/cache';
import { GitHubBackend } from '../storage/github';
import { ExtensionMessage } from '../types';

/**
 * Commyweb Background Service Worker (Manifest V3)
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Commyweb] Extension installed and ready.');
});

// Handle keyboard shortcut command defined in manifest
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-comment-mode') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_COMMENT_MODE' });
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

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (e: any) {
      console.error('[Commyweb Background Error]', e);
      sendResponse({ error: e.message });
    }
  })();

  return true; // Keep message channel open for async response
});
