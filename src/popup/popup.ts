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
  private autoSaveTimer?: number;

  constructor() {
    this.init();
  }

  private async init() {
    this.localizeUI();
    await this.setupCurrentTab();
    await this.loadSettings();
    await this.restoreDrawerState();
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

      // Display scoped URL
      const scopeUrlEl = document.getElementById('scope-page-url');
      if (scopeUrlEl) {
        try {
          const parsed = new URL(tab.url);
          scopeUrlEl.textContent = `${parsed.hostname}${parsed.pathname}`;
          scopeUrlEl.title = tab.url;
        } catch {
          scopeUrlEl.textContent = tab.url;
        }
      }

      // Check if page is scriptable (avoid chrome://, edge://, about:, etc.)
      const isRestrictedUrl =
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('devtools://');

      if (!isRestrictedUrl) {
        try {
          chrome.tabs.sendMessage(tab.id, { type: 'GET_COMMENT_MODE' }, (res) => {
            // ALWAYS consume chrome.runtime.lastError to prevent Unchecked runtime.lastError
            const err = chrome.runtime.lastError;
            if (err) return;

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
  }

  private async restoreDrawerState() {
    // Check URL parameter first (e.g., opened via dedicated tab)
    const urlParams = new URLSearchParams(window.location.search);
    const requestedDrawer = urlParams.get('drawer');

    const settingsDrawer = document.getElementById('settings-drawer');
    const inviteDrawer = document.getElementById('invite-drawer');

    if (requestedDrawer === 'settings') {
      settingsDrawer?.classList.add('open');
      inviteDrawer?.classList.remove('open');
      return;
    }

    // Otherwise check persisted state in chrome.storage.local
    try {
      const res = await chrome.storage.local.get(['commyweb_active_drawer']);
      if (res.commyweb_active_drawer === 'settings') {
        settingsDrawer?.classList.add('open');
        inviteDrawer?.classList.remove('open');
      } else if (res.commyweb_active_drawer === 'invite') {
        inviteDrawer?.classList.add('open');
        settingsDrawer?.classList.remove('open');
      }
    } catch {
      // ignore
    }
  }

  private setPersistedDrawer(drawer: 'settings' | 'invite' | null) {
    try {
      chrome.storage.local.set({ commyweb_active_drawer: drawer });
    } catch {
      // ignore
    }
  }

  private async loadSettings() {
    const settings = await CacheManager.getSettings();

    const tokenInput = document.getElementById('input-github-token') as HTMLInputElement;
    const repoInput = document.getElementById('input-storage-repo') as HTMLInputElement;
    const resendKeyInput = document.getElementById('input-resend-key') as HTMLInputElement;
    const resendFromInput = document.getElementById('input-resend-from') as HTMLInputElement;

    const badgeGithub = document.getElementById('badge-github-status');
    const badgeResend = document.getElementById('badge-resend-status');
    const scopeRepoEl = document.getElementById('scope-repo-name');
    const resendWarningBox = document.getElementById('resend-warning-box');

    if (tokenInput && settings.githubToken) {
      tokenInput.value = settings.githubToken;
      if (badgeGithub) {
        badgeGithub.textContent = '● Configuré';
        badgeGithub.className = 'key-status-badge configured';
      }
    } else if (badgeGithub) {
      badgeGithub.textContent = 'Non configuré';
      badgeGithub.className = 'key-status-badge empty';
    }

    // Do NOT pre-populate repo with any default repo
    const userRepo = (settings.storageRepo && settings.storageRepo !== 'kiou98/Commyweb') ? settings.storageRepo : '';
    if (repoInput) {
      repoInput.value = userRepo;
    }
    if (scopeRepoEl) {
      scopeRepoEl.textContent = userRepo ? userRepo : 'Non configuré';
    }

    if (resendKeyInput && settings.resendApiKey) {
      resendKeyInput.value = settings.resendApiKey;
      if (badgeResend) {
        badgeResend.textContent = '● Configurée';
        badgeResend.className = 'key-status-badge configured';
      }
      if (resendWarningBox) resendWarningBox.style.display = 'none';
    } else {
      if (badgeResend) {
        badgeResend.textContent = 'Non configurée';
        badgeResend.className = 'key-status-badge empty';
      }
      if (resendWarningBox) resendWarningBox.style.display = 'block';
    }

    if (resendFromInput && settings.resendFromEmail) {
      resendFromInput.value = settings.resendFromEmail;
    }

    chrome.storage.local.get(['commyweb_user'], (res) => {
      const user: Author = res?.commyweb_user;
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

  /**
   * Auto-save settings as the user types or modifies any input field
   */
  private triggerAutoSave(delayMs: number = 300) {
    if (this.autoSaveTimer) {
      window.clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = window.setTimeout(() => {
      this.saveSettingsData(true);
    }, delayMs);
  }

  private async saveSettingsData(isSilent: boolean = false) {
    const tokenInput = document.getElementById('input-github-token') as HTMLInputElement;
    const repoInput = document.getElementById('input-storage-repo') as HTMLInputElement;
    const userNameInput = document.getElementById('input-user-name') as HTMLInputElement;
    const resendKeyInput = document.getElementById('input-resend-key') as HTMLInputElement;
    const resendFromInput = document.getElementById('input-resend-from') as HTMLInputElement;

    const newSettings: Partial<UserSettings> = {
      githubToken: tokenInput?.value.trim() || undefined,
      storageRepo: repoInput?.value.trim() || undefined,
      resendApiKey: resendKeyInput?.value.trim() || undefined,
      resendFromEmail: resendFromInput?.value.trim() || undefined
    };

    const newName = userNameInput?.value.trim();
    if (newName) {
      this.currentAuthorName = newName;
      chrome.storage.local.get(['commyweb_user'], (res) => {
        const user: Author = res?.commyweb_user || { id: 'anonymous', username: newName, avatarUrl: '' };
        user.name = newName;
        user.username = newName;
        chrome.storage.local.set({ commyweb_user: user });
      });
    }

    await CacheManager.saveSettings(newSettings);

    // Update UI status badges immediately
    const badgeGithub = document.getElementById('badge-github-status');
    const badgeResend = document.getElementById('badge-resend-status');
    const scopeRepoEl = document.getElementById('scope-repo-name');
    const resendWarningBox = document.getElementById('resend-warning-box');

    if (badgeGithub) {
      if (newSettings.githubToken) {
        badgeGithub.textContent = '● Configuré';
        badgeGithub.className = 'key-status-badge configured';
      } else {
        badgeGithub.textContent = 'Non configuré';
        badgeGithub.className = 'key-status-badge empty';
      }
    }

    if (scopeRepoEl) {
      scopeRepoEl.textContent = newSettings.storageRepo ? newSettings.storageRepo : 'Non configuré';
    }

    if (badgeResend) {
      if (newSettings.resendApiKey) {
        badgeResend.textContent = '● Configurée';
        badgeResend.className = 'key-status-badge configured';
        if (resendWarningBox) resendWarningBox.style.display = 'none';
      } else {
        badgeResend.textContent = 'Non configurée';
        badgeResend.className = 'key-status-badge empty';
        if (resendWarningBox) resendWarningBox.style.display = 'block';
      }
    }

    // Flash auto-save indicator
    const autoSaveIndicator = document.getElementById('auto-save-indicator');
    if (autoSaveIndicator) {
      autoSaveIndicator.style.opacity = '1';
      setTimeout(() => {
        autoSaveIndicator.style.opacity = '0';
      }, 1500);
    }

    chrome.runtime.sendMessage({ type: 'USER_SETTINGS_UPDATED' }, () => {
      void chrome.runtime.lastError;
      if (!isSilent) {
        this.showToast('✓ Paramètres enregistrés avec succès !');
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
        const user: Author = res?.commyweb_user || { id: 'anonymous', username: trimmed, avatarUrl: '' };
        user.name = trimmed;
        user.username = trimmed;
        chrome.storage.local.set({ commyweb_user: user });
      });
      this.triggerAutoSave(100);
    };

    quickAuthorInput?.addEventListener('input', () => {
      if (quickDot) quickDot.style.backgroundColor = getUserColor(quickAuthorInput.value.trim() || 'User');
      updateAuthorName(quickAuthorInput.value);
    });
    quickAuthorInput?.addEventListener('change', () => updateAuthorName(quickAuthorInput.value));
    quickAuthorInput?.addEventListener('blur', () => updateAuthorName(quickAuthorInput.value));
    quickAuthorInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        quickAuthorInput.blur();
      }
    });

    // Eye toggle for password visibility
    const setupEyeToggle = (btnId: string, inputId: string) => {
      const btn = document.getElementById(btnId);
      const input = document.getElementById(inputId) as HTMLInputElement;
      if (!btn || !input) return;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';

        btn.innerHTML = isPassword
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
               <line x1="1" y1="1" x2="23" y2="23"></line>
             </svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
               <circle cx="12" cy="12" r="3"></circle>
             </svg>`;
      });
    };

    setupEyeToggle('btn-toggle-github-eye', 'input-github-token');
    setupEyeToggle('btn-toggle-resend-eye', 'input-resend-key');

    // Auto-save listeners on all settings inputs
    const settingsInputs = [
      'input-github-token',
      'input-storage-repo',
      'input-resend-key',
      'input-resend-from',
      'input-user-name'
    ];

    settingsInputs.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.triggerAutoSave(300));
        el.addEventListener('change', () => this.saveSettingsData(true));
        el.addEventListener('blur', () => this.saveSettingsData(true));
      }
    });

    // Toggle Comment Mode checkbox
    const chk = document.getElementById('chk-comment-mode') as HTMLInputElement;
    chk?.addEventListener('change', () => {
      if (this.currentTabId) {
        chrome.tabs.sendMessage(this.currentTabId, { type: 'TOGGLE_COMMENT_MODE' }, () => {
          const err = chrome.runtime.lastError;
          if (err && this.currentTabId) {
            // Attempt injection if tab was open before extension reload
            chrome.scripting.executeScript(
              {
                target: { tabId: this.currentTabId },
                files: ['content.js']
              },
              () => {
                void chrome.runtime.lastError;
                chrome.tabs.sendMessage(this.currentTabId!, { type: 'TOGGLE_COMMENT_MODE' }, () => {
                  void chrome.runtime.lastError;
                });
              }
            );
          }
        });
      }
    });

    const btnSettings = document.getElementById('btn-toggle-settings');
    const settingsDrawer = document.getElementById('settings-drawer');
    const inviteDrawer = document.getElementById('invite-drawer');

    btnSettings?.addEventListener('click', () => {
      inviteDrawer?.classList.remove('open');
      const isOpen = settingsDrawer?.classList.toggle('open');
      this.setPersistedDrawer(isOpen ? 'settings' : null);
    });

    const btnInvite = document.getElementById('btn-toggle-invite');
    btnInvite?.addEventListener('click', () => {
      settingsDrawer?.classList.remove('open');
      const isOpen = inviteDrawer?.classList.toggle('open');
      this.setPersistedDrawer(isOpen ? 'invite' : null);
    });

    // Link in warning box to jump straight to Resend configuration
    const linkResend = document.getElementById('link-open-resend-settings');
    linkResend?.addEventListener('click', (e) => {
      e.preventDefault();
      inviteDrawer?.classList.remove('open');
      settingsDrawer?.classList.add('open');
      this.setPersistedDrawer('settings');
      const resendInput = document.getElementById('input-resend-key');
      resendInput?.focus();
    });

    // Open settings in dedicated browser tab so it never closes when switching tabs
    const btnOpenTab = document.getElementById('btn-open-settings-tab');
    btnOpenTab?.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?drawer=settings') });
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

    // Save Settings button (retained as confirmation button)
    const btnSave = document.getElementById('btn-save-settings');
    btnSave?.addEventListener('click', async () => {
      await this.saveSettingsData(false);
      settingsDrawer?.classList.remove('open');
      this.setPersistedDrawer(null);
    });

    // Filter Tabs (does NOT close settings drawer)
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeFilter = (tab.getAttribute('data-tab') as any) || 'all';
        this.renderCommentsList();
      });
    });
  }

  private async handleSendInvite() {
    const inputEmail = document.getElementById('input-invite-email') as HTMLInputElement;
    const btnSend = document.getElementById('btn-send-invite') as HTMLButtonElement;
    const email = inputEmail?.value.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.showToast('⚠️ Veuillez entrer une adresse email valide.');
      return;
    }

    if (!this.currentUrlHash || !this.currentTabUrl) return;

    // Verify Resend API Key is set - NO MAILTO FALLBACK, 100% Commyweb Resend
    const settings = await CacheManager.getSettings();
    if (!settings.resendApiKey || !settings.resendApiKey.trim()) {
      const resendWarning = document.getElementById('resend-warning-box');
      if (resendWarning) resendWarning.style.display = 'block';

      this.showToast('⚠️ Clé Resend requise : configurez-la dans Paramètres ⚙️ pour envoyer les emails.');

      // Automatically open settings drawer to guide user
      const inviteDrawer = document.getElementById('invite-drawer');
      const settingsDrawer = document.getElementById('settings-drawer');
      inviteDrawer?.classList.remove('open');
      settingsDrawer?.classList.add('open');
      this.setPersistedDrawer('settings');
      document.getElementById('input-resend-key')?.focus();
      return;
    }

    if (btnSend) {
      btnSend.disabled = true;
      btnSend.textContent = 'Envoi...';
    }

    // Register member via background and dispatch email exclusively via Resend
    chrome.runtime.sendMessage(
      {
        type: 'INVITE_MEMBER',
        payload: {
          urlHash: this.currentUrlHash,
          url: this.currentTabUrl,
          email,
          addedBy: this.currentAuthorName
        }
      },
      async (res) => {
        void chrome.runtime.lastError;
        if (btnSend) {
          btnSend.disabled = false;
          btnSend.textContent = 'Inviter';
        }

        if (res && res.member) {
          if (res.emailSent) {
            inputEmail.value = '';
            await this.loadInvitedMembers();
            this.showToast(`✓ Invitation envoyée avec succès par email à ${email} !`);
          } else {
            const errDetail = res.emailError || 'Erreur lors de l\'envoi';
            this.showToast(`⚠️ Erreur Resend : ${errDetail}`);
          }
        } else {
          this.showToast(`⚠️ Erreur : ${res?.error || 'Impossible d\'enregistrer le membre'}`);
        }
      }
    );
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
      this.showToast('Email HTML copié ! Prêt à coller dans votre client mail.');
    } catch {
      await navigator.clipboard.writeText(emailHtml);
      this.showToast('Code HTML copié !');
    }
  }

  private async handleCopyInviteLink() {
    if (!this.currentTabUrl || !this.currentUrlHash) return;

    const inviteText =
      `Bonjour,\n\n` +
      `${this.currentAuthorName} vous invite à réviser et commenter la page suivante avec l'extension Commyweb :\n` +
      `👉 ${this.currentTabUrl}\n\n` +
      `Guide express (30s) :\n` +
      `1. Téléchargez l'extension : https://github.com/kiou98/Commyweb/releases/latest\n` +
      `2. Sur chrome://extensions/, activez "Mode développeur" et chargez le dossier décompressé.\n` +
      `3. Rendez-vous sur la page web. Appuyez sur Alt + C (ou faites un clic droit) pour commenter comme dans Figma !`;

    await navigator.clipboard.writeText(inviteText);
    this.showToast('Message d\'invitation copié ! Prêt à envoyer par Slack/Teams/Email.');
  }

  private showToast(msg: string) {
    const toast = document.getElementById('toast-invite');
    if (toast) {
      toast.textContent = msg;
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 3500);
    }
  }

  private async loadInvitedMembers() {
    if (!this.currentUrlHash) return;

    chrome.runtime.sendMessage(
      {
        type: 'GET_MEMBERS',
        payload: { urlHash: this.currentUrlHash, url: this.currentTabUrl }
      },
      (res) => {
        void chrome.runtime.lastError;
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

        members.forEach((member) => {
          const chip = document.createElement('div');
          chip.className = 'member-chip';

          const isRevoked = member.status === 'revoked';

          chip.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span class="member-email" style="${isRevoked ? 'text-decoration: line-through; opacity: 0.5;' : ''}">${escapeHtml(member.email)}</span>
              <span class="member-status">${isRevoked ? '⚠️ Révoqué' : '✓ Autorisé'} • ${formatRelativeTime(member.addedAt)}</span>
            </div>
            <div>
              ${
                !isRevoked
                  ? `
                <button class="btn-revoke" data-id="${member.id}" style="background: none; border: 1px solid #e4e4e7; border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; color: #000000; transition: all 0.15s;">
                  Révoquer
                </button>
              `
                  : `
                <span style="font-size: 10px; color: #a1a1aa; font-weight: 600;">Accès coupé</span>
              `
              }
            </div>
          `;

          const btnRevoke = chip.querySelector('.btn-revoke');
          btnRevoke?.addEventListener('click', () => {
            if (confirm(`Voulez-vous vraiment révoquer l'accès de ${member.email} ?`)) {
              chrome.runtime.sendMessage(
                {
                  type: 'REVOKE_MEMBER',
                  payload: { urlHash: this.currentUrlHash, memberId: member.id }
                },
                () => {
                  void chrome.runtime.lastError;
                  this.loadInvitedMembers();
                }
              );
            }
          });

          container.appendChild(chip);
        });
      }
    );
  }

  private async fetchComments() {
    if (!this.currentUrlHash) return;

    chrome.runtime.sendMessage(
      { type: 'GET_PAGE_COMMENTS', payload: { urlHash: this.currentUrlHash } },
      (res) => {
        void chrome.runtime.lastError;
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
    const open = this.comments.filter((c) => c.status === 'open').length;
    const resolved = this.comments.filter((c) => c.status === 'resolved').length;

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

    const filtered = this.comments.filter((c) => {
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
          chrome.tabs.sendMessage(
            this.currentTabId,
            {
              type: 'FOCUS_COMMENT',
              payload: { commentId: comment.id }
            },
            () => {
              void chrome.runtime.lastError;
            }
          );
          window.close();
        }
      });

      container.appendChild(card);
    });
  }
}

new PopupController();
