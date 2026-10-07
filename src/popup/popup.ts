import { WebComment, UserSettings, Author } from '../types';
import { normalizeUrl, hashUrl, escapeHtml } from '../utils/security';
import { formatRelativeTime, t } from '../utils/i18n';
import { CacheManager } from '../storage/cache';

class PopupController {
  private currentTabId?: number;
  private currentUrlHash?: string;
  private comments: WebComment[] = [];
  private activeFilter: 'all' | 'open' | 'resolved' = 'all';

  constructor() {
    this.init();
  }

  private async init() {
    this.localizeUI();
    await this.setupCurrentTab();
    await this.loadSettings();
    this.setupEventListeners();
    await this.fetchComments();
  }

  private localizeUI() {
    const lblCommentMode = document.getElementById('lbl-comment-mode');
    if (lblCommentMode) lblCommentMode.textContent = t('commentMode');

    const tabAll = document.getElementById('tab-all');
    if (tabAll) tabAll.childNodes[0].textContent = `${t('filterAll')} (`;

    const tabOpen = document.getElementById('tab-open');
    if (tabOpen) tabOpen.childNodes[0].textContent = `${t('filterActive')} (`;

    const tabResolved = document.getElementById('tab-resolved');
    if (tabResolved) tabResolved.childNodes[0].textContent = `${t('filterResolved')} (`;

    const lblNoComments = document.getElementById('lbl-no-comments');
    if (lblNoComments) lblNoComments.textContent = t('noComments');

    const btnSave = document.getElementById('btn-save-settings');
    if (btnSave) btnSave.textContent = t('saveSettings');
  }

  private async setupCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id && tab.url) {
      this.currentTabId = tab.id;
      const normalized = normalizeUrl(tab.url);
      this.currentUrlHash = hashUrl(normalized);

      // Query comment mode status from tab
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'GET_COMMENT_MODE' }, (res) => {
          if (res && typeof res.isCommentModeActive === 'boolean') {
            const chk = document.getElementById('chk-comment-mode') as HTMLInputElement;
            if (chk) chk.checked = res.isCommentModeActive;
          }
        });
      } catch {
        // Tab might not have content script loaded (e.g. chrome://)
      }
    }
  }

  private async loadSettings() {
    const settings = await CacheManager.getSettings();

    const tokenInput = document.getElementById('input-github-token') as HTMLInputElement;
    const repoInput = document.getElementById('input-storage-repo') as HTMLInputElement;

    if (tokenInput && settings.githubToken) tokenInput.value = settings.githubToken;
    if (repoInput && settings.storageRepo) repoInput.value = settings.storageRepo;

    // Check cached user
    chrome.storage.local.get(['commyweb_user'], (res) => {
      const user: Author = res.commyweb_user;
      if (user && user.username) {
        const badge = document.getElementById('user-badge');
        const avatar = document.getElementById('user-avatar') as HTMLImageElement;
        const name = document.getElementById('user-name');
        if (badge && avatar && name) {
          badge.style.display = 'flex';
          avatar.src = user.avatarUrl || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
          name.textContent = `@${user.username}`;
        }
      }
    });
  }

  private setupEventListeners() {
    // Comment Mode Toggle Switch
    const chk = document.getElementById('chk-comment-mode') as HTMLInputElement;
    chk?.addEventListener('change', () => {
      if (this.currentTabId) {
        chrome.tabs.sendMessage(this.currentTabId, { type: 'TOGGLE_COMMENT_MODE' });
      }
    });

    // Settings Drawer Toggle
    const btnSettings = document.getElementById('btn-toggle-settings');
    const drawer = document.getElementById('settings-drawer');
    btnSettings?.addEventListener('click', () => {
      drawer?.classList.toggle('open');
    });

    // Save Settings
    const btnSave = document.getElementById('btn-save-settings');
    btnSave?.addEventListener('click', async () => {
      const tokenInput = document.getElementById('input-github-token') as HTMLInputElement;
      const repoInput = document.getElementById('input-storage-repo') as HTMLInputElement;

      const newSettings: Partial<UserSettings> = {
        githubToken: tokenInput?.value.trim() || undefined,
        storageRepo: repoInput?.value.trim() || undefined
      };

      await CacheManager.saveSettings(newSettings);

      // Trigger background verification
      chrome.runtime.sendMessage({ type: 'USER_SETTINGS_UPDATED' }, () => {
        this.loadSettings();
        drawer?.classList.remove('open');
      });
    });

    // Filter Tabs
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeFilter = (tab.getAttribute('data-tab') as any) || 'all';
        this.renderCommentsList();
      });
    });
  }

  private async fetchComments() {
    if (!this.currentUrlHash) return;

    chrome.runtime.sendMessage(
      { type: 'GET_PAGE_COMMENTS', payload: { urlHash: this.currentUrlHash } },
      (res) => {
        if (res && res.comments) {
          this.comments = res.comments;
          this.updateCounts();
          this.renderCommentsList();
        }
      }
    );
  }

  private updateCounts() {
    const total = this.comments.length;
    const open = this.comments.filter(c => c.status === 'open').length;
    const resolved = this.comments.filter(c => c.status === 'resolved').length;

    const countAll = document.getElementById('count-all');
    const countOpen = document.getElementById('count-open');
    const countResolved = document.getElementById('count-resolved');

    if (countAll) countAll.textContent = String(total);
    if (countOpen) countOpen.textContent = String(open);
    if (countResolved) countResolved.textContent = String(resolved);
  }

  private renderCommentsList() {
    const container = document.getElementById('comments-list');
    const emptyState = document.getElementById('empty-state');
    if (!container || !emptyState) return;

    // Filter list
    const filtered = this.comments.filter(c => {
      if (this.activeFilter === 'all') return true;
      return c.status === this.activeFilter;
    });

    // Clean container while keeping empty-state element
    container.innerHTML = '';

    if (filtered.length === 0) {
      container.appendChild(emptyState);
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    filtered.forEach((comment, index) => {
      const card = document.createElement('div');
      card.className = `comment-card ${comment.status === 'resolved' ? 'resolved' : ''}`;
      
      const repliesCount = comment.replies?.length || 0;
      const repliesText = repliesCount > 0 ? `${repliesCount} ${t('reply')}` : '';

      card.innerHTML = `
        <div class="card-header">
          <div class="card-author">
            <img class="card-avatar" src="${escapeHtml(comment.author.avatarUrl || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')}" alt="">
            <span class="card-name">${escapeHtml(comment.author.name || comment.author.username)}</span>
          </div>
          <span class="card-time">${formatRelativeTime(comment.createdAt)}</span>
        </div>
        <div class="card-text">${escapeHtml(comment.content)}</div>
        <div class="card-footer">
          <span class="badge-tag ${comment.status === 'resolved' ? 'badge-resolved' : 'badge-open'}">
            ${comment.status === 'resolved' ? t('resolved') : t('active')} #${index + 1}
          </span>
          <span>${repliesText}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        // Send focus message to tab and close popup
        if (this.currentTabId) {
          chrome.tabs.sendMessage(this.currentTabId, {
            type: 'FOCUS_COMMENT',
            payload: { commentId: comment.id }
          });
          window.close();
        }
      });

      container.appendChild(card);
    });
  }
}

new PopupController();
