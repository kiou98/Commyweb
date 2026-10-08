import { WebComment, UserSettings, Author, ProjectMember } from '../types';
import { normalizeUrl, hashUrl, escapeHtml, getUserColor } from '../utils/security';
import { formatRelativeTime, t } from '../utils/i18n';
import { CacheManager } from '../storage/cache';
import { generateInviteEmailHtml } from '../utils/email-template';

class PopupController {
  private currentTabId?: number;
  private currentTabUrl?: string;
  private currentUrlHash?: string;
  private comments: WebComment[] = [];
  private activeFilter: 'all' | 'open' | 'resolved' = 'all';
  private currentAuthorName: string = 'Vincent';

  constructor() {
    this.init();
  }

  private async init() {
    this.localizeUI();
    await this.setupCurrentTab();
    await this.loadSettings();
    await this.loadInvitedMembers();
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

    const lblInviteTitle = document.getElementById('lbl-invite-title');
    if (lblInviteTitle) lblInviteTitle.textContent = t('inviteCollaborators');

    const btnSendInvite = document.getElementById('btn-send-invite');
    if (btnSendInvite) btnSendInvite.textContent = t('inviteByEmail');

    const inputEmail = document.getElementById('input-invite-email') as HTMLInputElement;
    if (inputEmail) inputEmail.placeholder = t('emailPlaceholder');

    const lblMembersTitle = document.getElementById('lbl-members-title');
    if (lblMembersTitle) lblMembersTitle.textContent = t('members');

    const lblNoMembers = document.getElementById('lbl-no-members');
    if (lblNoMembers) lblNoMembers.textContent = t('noMembers');
  }

  private async setupCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id && tab.url) {
      this.currentTabId = tab.id;
      this.currentTabUrl = tab.url;
      const normalized = normalizeUrl(tab.url);
      this.currentUrlHash = hashUrl(normalized);

      try {
        chrome.tabs.sendMessage(tab.id, { type: 'GET_COMMENT_MODE' }, (res) => {
          if (res && typeof res.isCommentModeActive === 'boolean') {
            const chk = document.getElementById('chk-comment-mode') as HTMLInputElement;
            if (chk) chk.checked = res.isCommentModeActive;
          }
        });
      } catch {
        // Tab might not have content script loaded
      }
    }
  }

  private async loadSettings() {
    const settings = await CacheManager.getSettings();

    const tokenInput = document.getElementById('input-github-token') as HTMLInputElement;
    const repoInput = document.getElementById('input-storage-repo') as HTMLInputElement;

    if (tokenInput && settings.githubToken) tokenInput.value = settings.githubToken;
    if (repoInput && settings.storageRepo) repoInput.value = settings.storageRepo;

    chrome.storage.local.get(['commyweb_user'], (res) => {
      const user: Author = res.commyweb_user;
      const userNameInput = document.getElementById('input-user-name') as HTMLInputElement;
      const quickAuthorInput = document.getElementById('quick-author-name') as HTMLInputElement;
      const quickDot = document.getElementById('quick-user-color-dot');

      if (user && (user.name || user.username)) {
        this.currentAuthorName = user.name || user.username;
      }

      if (userNameInput) userNameInput.value = this.currentAuthorName;
      if (quickAuthorInput) quickAuthorInput.value = this.currentAuthorName;
      if (quickDot) quickDot.style.backgroundColor = getUserColor(this.currentAuthorName);

      const badge = document.getElementById('user-badge');
      const avatar = document.getElementById('user-avatar') as HTMLImageElement;
      const name = document.getElementById('user-name');
      if (badge && avatar && name) {
        badge.style.display = 'flex';
        avatar.src = (user && user.avatarUrl) ? user.avatarUrl : '/icons/logo.png';
        name.textContent = `@${this.currentAuthorName}`;
      }
    });
  }

  private setupEventListeners() {
    // Quick author name change
    const quickAuthorInput = document.getElementById('quick-author-name') as HTMLInputElement;
    const quickDot = document.getElementById('quick-user-color-dot');
    const updateAuthorName = (newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      this.currentAuthorName = trimmed;
      if (quickDot) quickDot.style.backgroundColor = getUserColor(trimmed);
      const settingsInput = document.getElementById('input-user-name') as HTMLInputElement;
      if (settingsInput) settingsInput.value = trimmed;
      chrome.storage.local.get(['commyweb_user'], (res) => {
        const user: Author = res.commyweb_user || { id: 'anonymous', username: trimmed, avatarUrl: '' };
        user.name = trimmed;
        user.username = trimmed;
        chrome.storage.local.set({ commyweb_user: user });
      });
    };

    quickAuthorInput?.addEventListener('input', () => {
      if (quickDot) quickDot.style.backgroundColor = getUserColor(quickAuthorInput.value.trim() || 'User');
    });
    quickAuthorInput?.addEventListener('change', () => updateAuthorName(quickAuthorInput.value));
    quickAuthorInput?.addEventListener('blur', () => updateAuthorName(quickAuthorInput.value));
    quickAuthorInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        quickAuthorInput.blur();
      }
    });

    const chk = document.getElementById('chk-comment-mode') as HTMLInputElement;
    chk?.addEventListener('change', () => {
      if (this.currentTabId) {
        chrome.tabs.sendMessage(this.currentTabId, { type: 'TOGGLE_COMMENT_MODE' });
      }
    });

    const btnSettings = document.getElementById('btn-toggle-settings');
    const settingsDrawer = document.getElementById('settings-drawer');
    const inviteDrawer = document.getElementById('invite-drawer');

    btnSettings?.addEventListener('click', () => {
      inviteDrawer?.classList.remove('open');
      settingsDrawer?.classList.toggle('open');
    });

    const btnInvite = document.getElementById('btn-toggle-invite');
    btnInvite?.addEventListener('click', () => {
      settingsDrawer?.classList.remove('open');
      inviteDrawer?.classList.toggle('open');
    });

    // Send Email Invite
    const btnSendInvite = document.getElementById('btn-send-invite');
    btnSendInvite?.addEventListener('click', () => this.handleSendInvite());

    const inputEmail = document.getElementById('input-invite-email') as HTMLInputElement;
    inputEmail?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleSendInvite();
      }
    });

    // Copy Formatted HTML Email
    const btnCopyHtml = document.getElementById('btn-copy-html-email');
    btnCopyHtml?.addEventListener('click', () => this.handleCopyHtmlEmail());

    // Copy Simple Link
    const btnCopyLink = document.getElementById('btn-copy-invite-link');
    btnCopyLink?.addEventListener('click', () => this.handleCopyInviteLink());

    // Save Settings
    const btnSave = document.getElementById('btn-save-settings');
    btnSave?.addEventListener('click', async () => {
      const tokenInput = document.getElementById('input-github-token') as HTMLInputElement;
      const repoInput = document.getElementById('input-storage-repo') as HTMLInputElement;
      const userNameInput = document.getElementById('input-user-name') as HTMLInputElement;

      const newSettings: Partial<UserSettings> = {
        githubToken: tokenInput?.value.trim() || undefined,
        storageRepo: repoInput?.value.trim() || undefined
      };

      const newName = userNameInput?.value.trim();
      if (newName) {
        this.currentAuthorName = newName;
        chrome.storage.local.get(['commyweb_user'], (res) => {
          const user: Author = res.commyweb_user || { id: 'anonymous', username: newName, avatarUrl: '' };
          user.name = newName;
          user.username = newName;
          chrome.storage.local.set({ commyweb_user: user });
        });
      }

      await CacheManager.saveSettings(newSettings);

      chrome.runtime.sendMessage({ type: 'USER_SETTINGS_UPDATED' }, () => {
        this.loadSettings();
        settingsDrawer?.classList.remove('open');
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

  private async handleSendInvite() {
    const inputEmail = document.getElementById('input-invite-email') as HTMLInputElement;
    const email = inputEmail?.value.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('Veuillez entrer une adresse email valide.');
      return;
    }

    if (!this.currentUrlHash || !this.currentTabUrl) return;

    // Register member via background
    chrome.runtime.sendMessage({
      type: 'INVITE_MEMBER',
      payload: {
        urlHash: this.currentUrlHash,
        url: this.currentTabUrl,
        email,
        addedBy: this.currentAuthorName
      }
    }, async (res) => {
      if (res && res.member) {
        inputEmail.value = '';
        await this.loadInvitedMembers();

        const member: ProjectMember = res.member;
        const magicLink = `${this.currentTabUrl}#commyweb_join=${member.authCode}&email=${encodeURIComponent(email)}`;

        const subject = encodeURIComponent(`[Commyweb] Invitation à collaborer sur : ${this.currentTabUrl}`);
        const body = encodeURIComponent(
          `Bonjour,\n\n` +
          `${this.currentAuthorName} vous a invité à réviser et commenter la page web suivante avec l'extension Commyweb :\n` +
          `👉 ${this.currentTabUrl}\n\n` +
          `Lien d'accès autorisé :\n` +
          `🔗 ${magicLink}\n\n` +
          `Guide express d'installation (30 sec) :\n` +
          `1. Téléchargez : https://github.com/kiou98/Commyweb/releases/latest/download/commyweb-extension.zip\n` +
          `2. Dans Chrome, allez sur chrome://extensions, activez "Mode développeur" et cliquez sur "Charger l'extension non empaquetée".\n` +
          `3. Cliquez sur le lien d'accès ci-dessus. Appuyez sur Alt + C (ou clic droit) pour commenter sur le site comme dans Figma !\n\n` +
          `Bonne collaboration !`
        );

        window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
      }
    });
  }

  private async handleCopyHtmlEmail() {
    if (!this.currentTabUrl || !this.currentUrlHash) return;

    const emailHtml = generateInviteEmailHtml({
      recipientEmail: 'collaborateur@entreprise.com',
      invitedByName: this.currentAuthorName,
      pageUrl: this.currentTabUrl,
      authCode: 'cw_auth_join'
    });

    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blobHtml = new Blob([emailHtml], { type: 'text/html' });
        const blobText = new Blob([this.currentTabUrl], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': blobHtml,
            'text/plain': blobText
          })
        ]);
      } else {
        await navigator.clipboard.writeText(emailHtml);
      }
      this.showToast('Email HTML copié ! Prêt à coller dans Gmail / Outlook.');
    } catch {
      await navigator.clipboard.writeText(emailHtml);
      this.showToast('Code HTML copié !');
    }
  }

  private async handleCopyInviteLink() {
    if (!this.currentTabUrl) return;

    const inviteText = 
      `Collaborer sur cette page via Commyweb :\n` +
      `👉 ${this.currentTabUrl}\n\n` +
      `Extension gratuite (Alt + C ou clic droit pour commenter) : https://github.com/kiou98/Commyweb/releases`;

    await navigator.clipboard.writeText(inviteText);
    this.showToast('Lien copié dans le presse-papier !');
  }

  private showToast(msg: string) {
    const toast = document.getElementById('toast-invite');
    if (toast) {
      toast.textContent = msg;
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 3000);
    }
  }

  private async loadInvitedMembers() {
    if (!this.currentUrlHash) return;

    chrome.runtime.sendMessage({
      type: 'GET_MEMBERS',
      payload: { urlHash: this.currentUrlHash, url: this.currentTabUrl }
    }, (res) => {
      const members: ProjectMember[] = res?.members || [];
      const container = document.getElementById('invited-members-list');
      const emptyState = document.getElementById('lbl-no-members');
      if (!container) return;

      container.innerHTML = '';

      if (members.length === 0) {
        if (emptyState) {
          container.appendChild(emptyState);
          emptyState.style.display = 'block';
        }
        return;
      }

      members.forEach(member => {
        const chip = document.createElement('div');
        chip.className = 'member-chip';

        const isRevoked = member.status === 'revoked';

        chip.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span class="member-email" style="${isRevoked ? 'text-decoration: line-through; opacity: 0.5;' : ''}">${escapeHtml(member.email)}</span>
            <span class="member-status">${isRevoked ? '⚠️ Révoqué' : '✓ Autorisé'} • ${formatRelativeTime(member.addedAt)}</span>
          </div>
          <div>
            ${!isRevoked ? `
              <button class="btn-revoke" data-id="${member.id}" style="background: none; border: 1px solid #e4e4e7; border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; color: #000000; transition: all 0.15s;">
                Révoquer
              </button>
            ` : `
              <span style="font-size: 10px; color: #a1a1aa; font-weight: 600;">Accès coupé</span>
            `}
          </div>
        `;

        const btnRevoke = chip.querySelector('.btn-revoke');
        btnRevoke?.addEventListener('click', () => {
          if (confirm(`Voulez-vous vraiment révoquer l'accès de ${member.email} ?`)) {
            chrome.runtime.sendMessage({
              type: 'REVOKE_MEMBER',
              payload: { urlHash: this.currentUrlHash, memberId: member.id }
            }, () => {
              this.loadInvitedMembers();
            });
          }
        });

        container.appendChild(chip);
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

    const filtered = this.comments.filter(c => {
      if (this.activeFilter === 'all') return true;
      return c.status === this.activeFilter;
    });

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
      
      const authorId = comment.author.name || comment.author.username || comment.author.id || 'User';
      const userColor = getUserColor(authorId);
      const repliesCount = comment.replies?.length || 0;
      const repliesText = repliesCount > 0 ? `${repliesCount} ${t('reply')}` : '';

      card.innerHTML = `
        <div class="card-header">
          <div class="card-author" style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 14px; height: 14px; border-radius: 50%; background-color: ${userColor}; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></div>
            <span class="card-name" style="font-weight: 700;">${escapeHtml(comment.author.name || comment.author.username)}</span>
          </div>
          <span class="card-time">${formatRelativeTime(comment.createdAt)}</span>
        </div>
        <div class="card-text">${escapeHtml(comment.content)}</div>
        <div class="card-footer">
          <span class="badge-tag ${comment.status === 'resolved' ? 'badge-resolved' : 'badge-open'}" style="${comment.status !== 'resolved' ? `border-color: ${userColor}; color: ${userColor};` : ''}">
            ${comment.status === 'resolved' ? t('resolved') : t('active')} #${index + 1}
          </span>
          <span>${repliesText}</span>
        </div>
      `;

      card.addEventListener('click', () => {
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
