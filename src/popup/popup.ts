import { WebComment, UserSettings, Author, ProjectMember } from '../types';
import { normalizeUrl, hashUrl, escapeHtml, getUserColor } from '../utils/security';
import { formatRelativeTime, t } from '../utils/i18n';
import { CacheManager } from '../storage/cache';
import { generateInviteEmailHtml, encodeProjectConfig, decodeProjectConfig } from '../utils/email-template';
import { parseGitHubRepo } from '../utils/github-parser';

class PopupController {
  private currentTabId?: number;
  private currentTabUrl?: string;
  private currentUrlHash?: string;
  private comments: WebComment[] = [];
  private activeFilter: 'all' | 'open' | 'resolved' = 'all';
  private currentAuthorName: string = 'Vincent';
  private autoSaveTimer?: number;
  private pollTimer?: number;

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

    // Real-time polling while popup is open (every 2.5s)
    this.pollTimer = window.setInterval(() => {
      this.fetchComments();
    }, 2500);

    // Listen to background broadcast events
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'COMMENTS_UPDATED') {
        if (!message.payload?.urlHash || message.payload.urlHash === this.currentUrlHash) {
          this.fetchComments();
        }
      }
    });

    window.addEventListener('unload', () => {
      if (this.pollTimer) clearInterval(this.pollTimer);
    });
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
            const err = chrome.runtime.lastError;
            const chk = document.getElementById('chk-comment-mode') as HTMLInputElement;
            if (!err && res && typeof res.isCommentModeActive === 'boolean') {
              if (chk) chk.checked = res.isCommentModeActive;
            } else {
              chrome.storage.local.get(['commyweb_comment_mode'], (storageRes) => {
                if (chk) chk.checked = typeof storageRes?.commyweb_comment_mode === 'boolean' ? storageRes.commyweb_comment_mode : true;
              });
            }
          });
        } catch {
          // Tab might not have content script loaded
        }
      }
    }
  }

  private async restoreDrawerState() {
    const urlParams = new URLSearchParams(window.location.search);
    const requestedDrawer = urlParams.get('drawer');

    const settingsDrawer = document.getElementById('settings-drawer');
    const inviteDrawer = document.getElementById('invite-drawer');

    if (requestedDrawer === 'settings') {
      settingsDrawer?.classList.add('open');
      inviteDrawer?.classList.remove('open');
      return;
    }

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

  private updateConfiguredUI(settings: UserSettings) {
    const hasRepo = Boolean(settings.storageRepo && settings.storageRepo.trim());
    const hasToken = Boolean(settings.githubToken && settings.githubToken.trim());
    const isConfigured = hasRepo && hasToken;

    const joinCard = document.getElementById('join-project-card');
    const collabBanner = document.getElementById('collaborator-banner');
    const warnUnconfigured = document.getElementById('warn-admin-unconfigured');
    const scopeRepoEl = document.getElementById('scope-repo-name');
    const badgeGithub = document.getElementById('badge-github-status');

    if (joinCard) {
      joinCard.style.display = isConfigured ? 'none' : 'block';
    }

    const hasSettings = Boolean(document.getElementById('settings-drawer'));
    if (warnUnconfigured) {
      if (!hasSettings) {
        if (!isConfigured) {
          warnUnconfigured.innerHTML = `⚠️ <strong>Projet non connecté :</strong><br>Ouvrez le lien reçu par email ou collez-le ci-dessous pour vous connecter au projet.`;
          warnUnconfigured.style.display = 'block';
        } else {
          warnUnconfigured.style.display = 'none';
        }
      } else {
        if (!hasRepo && !hasToken) {
          warnUnconfigured.innerHTML = `⚠️ <strong>Configuration requise :</strong><br>Renseignez votre <strong>GitHub Token</strong> et votre <strong>Dépôt</strong> dans les <a href="#" id="link-open-settings" style="color: #991b1b; font-weight: 700; text-decoration: underline;">Paramètres ⚙️</a> pour inviter des collaborateurs.`;
          warnUnconfigured.style.display = 'block';
        } else if (!hasRepo) {
          warnUnconfigured.innerHTML = `⚠️ <strong>Dépôt GitHub manquant :</strong><br>Indiquez le nom du <strong>Dépôt de stockage (owner/repo)</strong> dans les <a href="#" id="link-open-settings" style="color: #991b1b; font-weight: 700; text-decoration: underline;">Paramètres ⚙️</a>.`;
          warnUnconfigured.style.display = 'block';
        } else if (!hasToken) {
          warnUnconfigured.innerHTML = `⚠️ <strong>GitHub Token manquant :</strong><br>Renseignez votre <strong>GitHub Token (PAT)</strong> dans les <a href="#" id="link-open-settings" style="color: #991b1b; font-weight: 700; text-decoration: underline;">Paramètres ⚙️</a> pour autoriser la synchronisation.`;
          warnUnconfigured.style.display = 'block';
        } else {
          warnUnconfigured.style.display = 'none';
        }

        const link = warnUnconfigured.querySelector('#link-open-settings');
        link?.addEventListener('click', (e) => {
          e.preventDefault();
          const settingsDrawer = document.getElementById('settings-drawer');
          const inviteDrawer = document.getElementById('invite-drawer');
          settingsDrawer?.classList.add('open');
          inviteDrawer?.classList.remove('open');
          this.setPersistedDrawer('settings');
        });
      }
    }

    if (collabBanner) {
      collabBanner.style.display = (isConfigured && settings.userRole === 'collaborator') ? 'flex' : 'none';
    }

    if (scopeRepoEl) {
      scopeRepoEl.textContent = settings.storageRepo || 'Non configuré';
    }

    const statusDot = document.getElementById('project-status-dot');
    const statusRepo = document.getElementById('project-status-repo');
    const statusTag = document.getElementById('project-status-tag');

    if (statusRepo) {
      statusRepo.textContent = settings.storageRepo || 'Non connecté';
      statusRepo.title = settings.storageRepo ? `Projet GitHub : ${settings.storageRepo}` : 'Aucun projet connecté';
    }

    if (statusDot && statusTag) {
      if (isConfigured) {
        statusDot.style.background = '#16a34a';
        statusTag.textContent = '● Synchronisé';
        statusTag.style.background = '#dcfce7';
        statusTag.style.color = '#15803d';
      } else {
        statusDot.style.background = '#dc2626';
        statusTag.textContent = 'Non connecté';
        statusTag.style.background = '#fee2e2';
        statusTag.style.color = '#991b1b';
      }
    }

    if (badgeGithub) {
      if (hasToken) {
        badgeGithub.textContent = '● Configuré';
        badgeGithub.className = 'key-status-badge configured';
      } else {
        badgeGithub.textContent = 'Non configuré';
        badgeGithub.className = 'key-status-badge empty';
      }
    }
  }

  private async loadSettings() {
    const settings = await CacheManager.getSettings();

    const tokenInput = document.getElementById('input-github-token') as HTMLInputElement;
    const repoInput = document.getElementById('input-storage-repo') as HTMLInputElement;

    if (tokenInput && settings.githubToken) {
      tokenInput.value = settings.githubToken;
    }

    const userRepo = settings.storageRepo || '';
    if (repoInput) {
      const parsed = parseGitHubRepo(userRepo);
      repoInput.value = parsed ? parsed.fullName : userRepo;
    }

    this.updateConfiguredUI(settings);

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
    const tokenInput = document.getElementById('input-github-token') as HTMLInputElement | null;
    const repoInput = document.getElementById('input-storage-repo') as HTMLInputElement | null;
    const userNameInput = document.getElementById('input-user-name') as HTMLInputElement | null;

    const newSettings: Partial<UserSettings> = {};
    if (tokenInput) {
      newSettings.githubToken = tokenInput.value.trim() || undefined;
    }
    if (repoInput) {
      const rawVal = repoInput.value.trim();
      if (rawVal) {
        let fallbackOwner: string | undefined;
        try {
          const userRes = await chrome.storage.local.get(['commyweb_user']);
          fallbackOwner = userRes?.commyweb_user?.username;
        } catch {
          // ignore
        }
        const parsed = parseGitHubRepo(rawVal, fallbackOwner);
        if (parsed) {
          newSettings.storageRepo = parsed.fullName;
          repoInput.value = parsed.fullName;
        } else {
          newSettings.storageRepo = rawVal;
          if (!isSilent) {
            this.showToast('⚠️ Format du dépôt invalide : utilisez owner/repo ou l\'URL GitHub.');
          }
        }
      } else {
        newSettings.storageRepo = undefined;
      }
    }

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

    const updatedSettings = await CacheManager.getSettings();
    this.updateConfiguredUI(updatedSettings);

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

    // Auto-save listeners on all settings inputs
    const settingsInputs = [
      'input-github-token',
      'input-storage-repo',
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
      chrome.storage.local.set({ commyweb_comment_mode: chk.checked });
      if (this.currentTabId) {
        chrome.tabs.sendMessage(this.currentTabId, { type: 'TOGGLE_COMMENT_MODE' }, () => {
          const err = chrome.runtime.lastError;
          if (err && this.currentTabId) {
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

    // Click on Commyweb brand logo closes any open drawer (settings or invite) and returns to main view
    const brandLogo = document.getElementById('brand-logo') || document.querySelector('.brand');
    brandLogo?.addEventListener('click', () => {
      settingsDrawer?.classList.remove('open');
      inviteDrawer?.classList.remove('open');
      this.setPersistedDrawer(null);
    });

    // Open settings in dedicated browser tab so it never closes when switching tabs
    const btnOpenTab = document.getElementById('btn-open-settings-tab');
    btnOpenTab?.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?drawer=settings') });
    });

    // Send Email Invite (Authorize & Prepare Email to copy)
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

    // Click on warning link in invite drawer opens settings
    const linkOpenSettings = document.getElementById('link-open-settings');
    linkOpenSettings?.addEventListener('click', (e) => {
      e.preventDefault();
      settingsDrawer?.classList.add('open');
      inviteDrawer?.classList.remove('open');
      this.setPersistedDrawer('settings');
    });

    // Quick Join Project handler
    const btnJoinProject = document.getElementById('btn-join-project');
    const inputJoinLink = document.getElementById('input-join-link') as HTMLInputElement;
    const handleQuickJoin = async () => {
      const raw = inputJoinLink?.value.trim();
      if (!raw) return;

      let configStr = raw;
      if (raw.includes('commyweb_config=')) {
        try {
          const urlObj = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
          const hash = urlObj.hash || '';
          const params = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : hash);
          configStr = params.get('commyweb_config') || raw;
        } catch {
          const match = raw.match(/commyweb_config=([^&#\s]+)/);
          if (match) configStr = match[1];
        }
      }

      const config = decodeProjectConfig(configStr);
      if (config && (config.repo || config.token)) {
        chrome.runtime.sendMessage({
          type: 'AUTO_CONFIGURE_PROJECT',
          payload: {
            repo: config.repo,
            token: config.token,
            email: config.email,
            url: this.currentTabUrl,
            authCode: config.authCode
          }
        }, async (res) => {
          void chrome.runtime.lastError;
          if (res?.success) {
            await this.loadSettings();
            await this.fetchComments();
            this.showToast('✓ Connecté au projet avec succès !');
            if (inputJoinLink) inputJoinLink.value = '';
          } else {
            this.showToast('⚠️ Impossible de configurer ce projet.');
          }
        });
      } else {
        this.showToast('⚠️ Lien ou code d\'invitation invalide.');
      }
    };

    btnJoinProject?.addEventListener('click', handleQuickJoin);
    inputJoinLink?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleQuickJoin();
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

    const settings = await CacheManager.getSettings();
    const hasSettings = Boolean(document.getElementById('settings-drawer'));
    if (!settings.storageRepo || !settings.githubToken) {
      if (!hasSettings) {
        this.showToast('⚠️ Vous devez d\'abord rejoindre un projet avec le lien reçu par email.');
        return;
      }
      if (!settings.storageRepo && !settings.githubToken) {
        this.showToast('⚠️ Renseignez votre GitHub Token et votre Dépôt dans les Paramètres ⚙️.');
      } else if (!settings.storageRepo) {
        this.showToast('⚠️ Renseignez votre Dépôt de stockage (owner/repo) dans les Paramètres ⚙️.');
      } else {
        this.showToast('⚠️ Renseignez votre GitHub Token (PAT) dans les Paramètres ⚙️.');
      }
      const settingsDrawer = document.getElementById('settings-drawer');
      const inviteDrawer = document.getElementById('invite-drawer');
      settingsDrawer?.classList.add('open');
      inviteDrawer?.classList.remove('open');
      this.setPersistedDrawer('settings');
      return;
    }

    if (btnSend) {
      btnSend.disabled = true;
      btnSend.textContent = 'Enregistrement...';
    }

    // Register member in project security policy
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
          btnSend.textContent = 'Autoriser & Préparer';
        }

        if (res && res.member) {
          const member: ProjectMember = res.member;
          await this.loadInvitedMembers();

          const settings = await CacheManager.getSettings();

          // Generate HTML email for this specific member with project auto-config
          const emailHtml = generateInviteEmailHtml({
            recipientEmail: email,
            invitedByName: this.currentAuthorName,
            pageUrl: this.currentTabUrl!,
            authCode: member.authCode,
            storageRepo: settings.storageRepo,
            githubToken: settings.githubToken
          });

          // Automatically copy formatted HTML email to clipboard for instant pasting into Gmail / Outlook
          let copied = false;
          try {
            if (navigator.clipboard && window.ClipboardItem) {
              const blobHtml = new Blob([emailHtml], { type: 'text/html' });
              const blobText = new Blob([this.currentTabUrl!], { type: 'text/plain' });
              await navigator.clipboard.write([
                new ClipboardItem({
                  'text/html': blobHtml,
                  'text/plain': blobText
                })
              ]);
              copied = true;
            } else {
              await navigator.clipboard.writeText(emailHtml);
              copied = true;
            }
          } catch {
            copied = false;
          }

          inputEmail.value = '';

          if (copied) {
            this.showToast(`✓ Accès autorisé pour ${email} ! L'email complet est copié : collez-le dans Gmail ou Outlook.`);
          } else {
            this.showToast(`✓ Accès autorisé pour ${email} ! Cliquez sur "Copier Email (HTML)" pour l'envoyer.`);
          }
        } else {
          this.showToast(`⚠️ Erreur : ${res?.error || 'Impossible d\'enregistrer le membre'}`);
        }
      }
    );
  }

  private async handleCopyHtmlEmail() {
    if (!this.currentTabUrl || !this.currentUrlHash) return;

    const inputEmail = document.getElementById('input-invite-email') as HTMLInputElement;
    const typedEmail = inputEmail?.value.trim().toLowerCase();
    const recipientEmail = typedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail)
      ? typedEmail
      : 'collaborateur@entreprise.com';

    const settings = await CacheManager.getSettings();
    const hasSettings = Boolean(document.getElementById('settings-drawer'));
    if (!settings.storageRepo || !settings.githubToken) {
      if (!hasSettings) {
        this.showToast('⚠️ Vous devez d\'abord rejoindre un projet avec le lien reçu par email.');
        return;
      }
      if (!settings.storageRepo && !settings.githubToken) {
        this.showToast('⚠️ Renseignez votre GitHub Token et votre Dépôt dans les Paramètres ⚙️.');
      } else if (!settings.storageRepo) {
        this.showToast('⚠️ Renseignez votre Dépôt de stockage (owner/repo) dans les Paramètres ⚙️.');
      } else {
        this.showToast('⚠️ Renseignez votre GitHub Token (PAT) dans les Paramètres ⚙️.');
      }
      const settingsDrawer = document.getElementById('settings-drawer');
      const inviteDrawer = document.getElementById('invite-drawer');
      settingsDrawer?.classList.add('open');
      inviteDrawer?.classList.remove('open');
      this.setPersistedDrawer('settings');
      return;
    }

    const emailHtml = generateInviteEmailHtml({
      recipientEmail,
      invitedByName: this.currentAuthorName,
      pageUrl: this.currentTabUrl,
      authCode: 'cw_auth_join',
      storageRepo: settings.storageRepo,
      githubToken: settings.githubToken
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
      this.showToast('✓ Email HTML copié ! Ouvrez un nouvel email dans Gmail / Outlook et faites Ctrl+V.');
    } catch {
      await navigator.clipboard.writeText(emailHtml);
      this.showToast('✓ Code de l\'email copié !');
    }
  }

  private async handleCopyInviteLink() {
    if (!this.currentTabUrl || !this.currentUrlHash) return;

    const inputEmail = document.getElementById('input-invite-email') as HTMLInputElement;
    const typedEmail = inputEmail?.value.trim().toLowerCase();
    const recipientEmail = typedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail)
      ? typedEmail
      : 'collaborateur@domaine.com';

    const settings = await CacheManager.getSettings();
    const hasSettings = Boolean(document.getElementById('settings-drawer'));
    if (!settings.storageRepo || !settings.githubToken) {
      if (!hasSettings) {
        this.showToast('⚠️ Vous devez d\'abord rejoindre un projet avec le lien reçu par email.');
        return;
      }
      if (!settings.storageRepo && !settings.githubToken) {
        this.showToast('⚠️ Renseignez votre GitHub Token et votre Dépôt dans les Paramètres ⚙️.');
      } else if (!settings.storageRepo) {
        this.showToast('⚠️ Renseignez votre Dépôt de stockage (owner/repo) dans les Paramètres ⚙️.');
      } else {
        this.showToast('⚠️ Renseignez votre GitHub Token (PAT) dans les Paramètres ⚙️.');
      }
      const settingsDrawer = document.getElementById('settings-drawer');
      const inviteDrawer = document.getElementById('invite-drawer');
      settingsDrawer?.classList.add('open');
      inviteDrawer?.classList.remove('open');
      this.setPersistedDrawer('settings');
      return;
    }

    const encodedConfig = encodeProjectConfig({
      repo: settings.storageRepo,
      token: settings.githubToken,
      email: recipientEmail,
      url: this.currentTabUrl,
      authCode: 'cw_auth_join'
    });

    const projectLink = encodedConfig
      ? `${this.currentTabUrl}#commyweb_config=${encodedConfig}`
      : this.currentTabUrl;

    const inviteText =
      `Bonjour,\n\n` +
      `${this.currentAuthorName} vous invite à collaborer et annoter une page web avec Commyweb.\n\n` +
      `📁 Projet : ${settings.storageRepo || 'Commyweb'}\n` +
      `🌐 Page : ${this.currentTabUrl}\n\n` +
      `PROCÉDURE SIMPLE EN 2 ÉTAPES (30 secondes) :\n\n` +
      `1️⃣ INSTALLER L'EXTENSION (si pas encore fait) :\n` +
      `   • Téléchargez : https://github.com/kiou98/Commyweb/releases/latest/download/commyweb-user.zip\n` +
      `   • Décompressez le dossier zip sur votre ordinateur.\n` +
      `   • Dans Chrome, allez sur chrome://extensions, activez "Mode développeur" et cliquez sur "Charger l'extension non empaquetée".\n\n` +
      `2️⃣ REJOINDRE LE PROJET :\n` +
      `   • Ouvrez simplement ce lien dans votre navigateur :\n` +
      `   👉 ${projectLink}\n\n` +
      `L'extension se configure automatiquement et affiche directement tous les commentaires de l'équipe !\n` +
      `Pour commenter : faites un clic droit n'importe où (ou Alt + C).`;

    await navigator.clipboard.writeText(inviteText);
    this.showToast('✓ Message et lien d\'invitation copiés pour Slack / Teams / SMS !');
  }

  private showToast(msg: string) {
    const toast = document.getElementById('toast-invite');
    if (toast) {
      toast.textContent = msg;
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 4500);
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
            <div style="display: flex; align-items: center; gap: 4px;">
              ${
                !isRevoked
                  ? `
                <button class="btn-copy-member-email" data-email="${escapeHtml(member.email)}" data-code="${member.authCode}" title="Copier l'email d'invitation pour ce membre" style="background: none; border: 1px solid #e4e4e7; border-radius: 6px; padding: 3px 6px; font-size: 10px; font-weight: 700; cursor: pointer; color: #000000;">
                  ✉️ Copier
                </button>
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

          const btnCopyMember = chip.querySelector('.btn-copy-member-email') as HTMLButtonElement;
          btnCopyMember?.addEventListener('click', async () => {
            const memberEmail = btnCopyMember.getAttribute('data-email') || member.email;
            const authCode = btnCopyMember.getAttribute('data-code') || member.authCode;
            const settings = await CacheManager.getSettings();
            const html = generateInviteEmailHtml({
              recipientEmail: memberEmail,
              invitedByName: this.currentAuthorName,
              pageUrl: this.currentTabUrl!,
              authCode,
              storageRepo: settings.storageRepo,
              githubToken: settings.githubToken
            });
            try {
              if (navigator.clipboard && window.ClipboardItem) {
                const blobHtml = new Blob([html], { type: 'text/html' });
                const blobText = new Blob([this.currentTabUrl!], { type: 'text/plain' });
                await navigator.clipboard.write([
                  new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })
                ]);
              } else {
                await navigator.clipboard.writeText(html);
              }
              this.showToast(`✓ Email copié pour ${memberEmail} ! Collez-le dans Gmail/Outlook.`);
            } catch {
              await navigator.clipboard.writeText(html);
              this.showToast(`✓ Email copié pour ${memberEmail} !`);
            }
          });

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
