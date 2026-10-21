import { READ_MESSAGES_KEY, unreadKeys, compareConversations } from '../utils/unread';
import { WebComment, UserSettings, Author, ProjectMember } from '../types';
import { normalizeUrl, hashUrl, escapeHtml, getUserColor, extractDomain } from '../utils/security';
import { formatRelativeTime, t } from '../utils/i18n';
import { CacheManager } from '../storage/cache';
import { generateInviteEmailHtml, encodeProjectConfig, decodeProjectConfig } from '../utils/email-template';
import { parseGitHubRepo } from '../utils/github-parser';

class PopupController {
  private currentTabId?: number;
  private currentTabUrl?: string;
  private currentUrlHash?: string;
  private currentDomain: string = '';
  private currentScope: 'page' | 'all' = 'page';
  private comments: WebComment[] = [];
  private activeFilter: 'all' | 'open' | 'resolved' = 'all';
  private currentAuthorName: string = 'Vincent';
  private readMessages = new Set<string>();
  private notificationUser?: Author;
  private notificationEmail?: string;
  private autoSaveTimer?: number;
  private pollTimer?: number;

  constructor() {
    this.init();
  }

  private async init() {
    this.localizeUI();

    // 1. Attach event listeners IMMEDIATELY so buttons are never dead or delayed
    try {
      this.setupEventListeners();
    } catch (e) {
      console.error('[Commyweb] Error attaching listeners:', e);
    }

    // 2. Discover current tab and domain
    await this.setupCurrentTab();

    // 3. Load settings (scoped to current domain if available)
    await this.loadSettings();
    await this.restoreDrawerState();
    await this.loadInvitedMembers();
    await this.loadSiteProjects();
    await this.fetchComments();
    this.checkForUpdates();

    // Real-time polling while popup is open (every 2s)
    this.pollTimer = window.setInterval(() => {
      this.fetchComments();
    }, 2000);

    // Listen to background broadcast events
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'COMMENTS_UPDATED') {
        if (this.currentScope === 'all' || !message.payload?.urlHash || message.payload.urlHash === this.currentUrlHash) {
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
    try {
      let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab || !tab.url) {
        const [curTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (curTab && curTab.url) tab = curTab;
      }
      if (!tab || !tab.url) {
        const allTabs = await chrome.tabs.query({ active: true });
        tab = allTabs.find((t) => t.url && !t.url.startsWith('chrome-extension://')) || allTabs[0];
      }

      if (tab && tab.id && tab.url) {
        this.currentTabId = tab.id;
        this.currentTabUrl = tab.url;
        this.currentDomain = extractDomain(tab.url);
        const normalized = normalizeUrl(tab.url);
        this.currentUrlHash = hashUrl(normalized);

        // Display current active site domain in projects drawer
        const activeSiteDomainEl = document.getElementById('active-site-domain');
        if (activeSiteDomainEl) {
          activeSiteDomainEl.textContent = this.currentDomain || 'Ce site web';
        }

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
    } catch (e) {
      console.warn('[Commyweb] Could not resolve current tab:', e);
    }
  }

  private async restoreDrawerState() {
    const urlParams = new URLSearchParams(window.location.search);
    const requestedDrawer = urlParams.get('drawer');

    const settingsDrawer = document.getElementById('settings-drawer');
    const inviteDrawer = document.getElementById('invite-drawer');
    const projectsDrawer = document.getElementById('projects-drawer');

    const closeAll = () => {
      settingsDrawer?.classList.remove('open');
      inviteDrawer?.classList.remove('open');
      projectsDrawer?.classList.remove('open');
    };

    if (requestedDrawer === 'settings') {
      closeAll();
      settingsDrawer?.classList.add('open');
      return;
    }
    if (requestedDrawer === 'invite') {
      closeAll();
      inviteDrawer?.classList.add('open');
      return;
    }
    if (requestedDrawer === 'projects') {
      closeAll();
      projectsDrawer?.classList.add('open');
      return;
    }

    try {
      const res = await chrome.storage.local.get(['commyweb_active_drawer']);
      closeAll();
      if (res.commyweb_active_drawer === 'settings') {
        settingsDrawer?.classList.add('open');
      } else if (res.commyweb_active_drawer === 'invite') {
        inviteDrawer?.classList.add('open');
      } else if (res.commyweb_active_drawer === 'projects') {
        projectsDrawer?.classList.add('open');
      }
    } catch {
      // ignore
    }
  }

  private setPersistedDrawer(drawer: 'settings' | 'invite' | 'projects' | null) {
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
          const projectsDrawer = document.getElementById('projects-drawer');
          settingsDrawer?.classList.add('open');
          inviteDrawer?.classList.remove('open');
          projectsDrawer?.classList.remove('open');
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
      const domainLabel = this.currentDomain ? ` [${this.currentDomain}]` : '';
      statusRepo.title = settings.storageRepo ? `Projet GitHub : ${settings.storageRepo}${domainLabel}` : 'Aucun projet connecté';
    }

    if (statusDot && statusTag) {
      if (isConfigured) {
        statusDot.style.background = '#16a34a';
        statusTag.textContent = this.currentDomain ? `● ${this.currentDomain}` : '● Synchronisé';
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
    const settings = await CacheManager.getSettings(this.currentTabUrl);

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
    const btnInvite = document.getElementById('btn-toggle-invite');
    const btnProjects = document.getElementById('btn-toggle-projects');
    const projectStatusBar = document.getElementById('project-status-bar');

    const settingsDrawer = document.getElementById('settings-drawer');
    const inviteDrawer = document.getElementById('invite-drawer');
    const projectsDrawer = document.getElementById('projects-drawer');

    const closeAllDrawers = () => {
      settingsDrawer?.classList.remove('open');
      inviteDrawer?.classList.remove('open');
      projectsDrawer?.classList.remove('open');
    };

    btnSettings?.addEventListener('click', () => {
      const isCurrentlyOpen = settingsDrawer?.classList.contains('open');
      closeAllDrawers();
      if (!isCurrentlyOpen) {
        settingsDrawer?.classList.add('open');
        this.setPersistedDrawer('settings');
      } else {
        this.setPersistedDrawer(null);
      }
    });

    btnInvite?.addEventListener('click', () => {
      const isCurrentlyOpen = inviteDrawer?.classList.contains('open');
      closeAllDrawers();
      if (!isCurrentlyOpen) {
        inviteDrawer?.classList.add('open');
        this.setPersistedDrawer('invite');
      } else {
        this.setPersistedDrawer(null);
      }
    });

    const toggleProjectsDrawer = () => {
      const isCurrentlyOpen = projectsDrawer?.classList.contains('open');
      closeAllDrawers();
      if (!isCurrentlyOpen) {
        projectsDrawer?.classList.add('open');
        this.setPersistedDrawer('projects');
        this.loadSiteProjects();
      } else {
        this.setPersistedDrawer(null);
      }
    };

    btnProjects?.addEventListener('click', toggleProjectsDrawer);
    projectStatusBar?.addEventListener('click', toggleProjectsDrawer);

    // Save project association for current site
    const btnSaveSiteProject = document.getElementById('btn-save-site-project');
    const inputSiteRepo = document.getElementById('input-site-repo') as HTMLInputElement;

    btnSaveSiteProject?.addEventListener('click', async () => {
      const rawRepo = inputSiteRepo?.value.trim();
      if (!rawRepo) {
        this.showToast('⚠️ Indiquez le nom du dépôt (owner/repo) à associer à ce site.');
        return;
      }
      const parsed = parseGitHubRepo(rawRepo);
      const cleanRepo = parsed ? parsed.fullName : rawRepo;
      if (!this.currentDomain) {
        this.currentDomain = extractDomain(this.currentTabUrl || 'current-site');
      }

      await CacheManager.saveSiteProject({
        domain: this.currentDomain,
        repo: cleanRepo,
        name: this.currentDomain
      });

      await this.loadSettings();
      await this.loadSiteProjects();
      await this.fetchComments();
      this.showToast(`✓ Dépôt ${cleanRepo} associé au site ${this.currentDomain} !`);
    });

    // Click on Commyweb brand logo closes any open drawer and returns to main view
    const brandLogo = document.getElementById('brand-logo') || document.querySelector('.brand');
    brandLogo?.addEventListener('click', () => {
      closeAllDrawers();
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
      projectsDrawer?.classList.remove('open');
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
            await this.loadSiteProjects();
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

    // Scope selector: Current page vs Whole site
    const btnScopePage = document.getElementById('btn-scope-page');
    const btnScopeAll = document.getElementById('btn-scope-all');

    const setScope = (scope: 'page' | 'all') => {
      this.currentScope = scope;
      if (scope === 'page') {
        btnScopePage?.classList.add('active');
        btnScopeAll?.classList.remove('active');
        if (btnScopePage) {
          btnScopePage.style.background = '#ffffff';
          btnScopePage.style.color = '#000000';
          btnScopePage.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        }
        if (btnScopeAll) {
          btnScopeAll.style.background = 'transparent';
          btnScopeAll.style.color = '#71717a';
          btnScopeAll.style.boxShadow = 'none';
        }
      } else {
        btnScopeAll?.classList.add('active');
        btnScopePage?.classList.remove('active');
        if (btnScopeAll) {
          btnScopeAll.style.background = '#ffffff';
          btnScopeAll.style.color = '#000000';
          btnScopeAll.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        }
        if (btnScopePage) {
          btnScopePage.style.background = 'transparent';
          btnScopePage.style.color = '#71717a';
          btnScopePage.style.boxShadow = 'none';
        }
      }

      const lblNoComments = document.getElementById('lbl-no-comments');
      if (lblNoComments) {
        lblNoComments.textContent =
          scope === 'page'
            ? "Aucun commentaire sur cette page. Activez le Mode commentaire et cliquez n'importe où pour commencer !"
            : "Aucun commentaire trouvé sur l'ensemble du site / projet.";
      }

      this.fetchComments();
    };

    btnScopePage?.addEventListener('click', () => setScope('page'));
    btnScopeAll?.addEventListener('click', () => setScope('all'));

    // Update Plugin Button in Banner
    const btnDoUpdate = document.getElementById('btn-do-update');
    btnDoUpdate?.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://github.com/kiou98/Commyweb/releases/latest' });
      // Chrome extension reload (preserves chrome.storage.local/sync 100%)
      chrome.runtime.reload();
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

  private async loadSiteProjects() {
    const container = document.getElementById('site-projects-list');
    const emptyState = document.getElementById('lbl-no-site-projects');
    const inputSiteRepo = document.getElementById('input-site-repo') as HTMLInputElement;
    if (!container) return;

    const projects = await CacheManager.getAllSiteProjects();
    container.innerHTML = '';

    // Check if current site has an assigned repo
    const currentSiteProject = projects.find((p) => p.domain === this.currentDomain);
    if (inputSiteRepo && currentSiteProject) {
      inputSiteRepo.value = currentSiteProject.repo;
    }

    if (projects.length === 0) {
      if (emptyState) {
        container.appendChild(emptyState);
        emptyState.style.display = 'block';
      }
      return;
    }

    projects.forEach((proj) => {
      const chip = document.createElement('div');
      chip.className = 'member-chip';
      const isCurrentSite = proj.domain === this.currentDomain;

      chip.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden; max-width: 65%;">
          <div style="display: flex; align-items: center; gap: 5px;">
            <span style="font-size: 11px; font-weight: 800; color: #000000; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">🌐 ${escapeHtml(proj.domain)}</span>
            ${isCurrentSite ? `<span style="font-size: 9px; font-weight: 700; background: #dcfce7; color: #15803d; padding: 1px 5px; border-radius: 4px;">Actif</span>` : ''}
          </div>
          <span style="font-size: 10px; font-family: monospace; color: #71717a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">📁 ${escapeHtml(proj.repo)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          ${
            !isCurrentSite
              ? `<button class="btn-apply-site-repo" data-repo="${escapeHtml(proj.repo)}" style="background: #000000; color: #ffffff; border: none; border-radius: 6px; padding: 3px 8px; font-size: 10px; font-weight: 700; cursor: pointer;">
                  Associer
                </button>`
              : ''
          }
          <button class="btn-delete-site-project" data-domain="${escapeHtml(proj.domain)}" title="Supprimer l'association de ce site" style="background: none; border: 1px solid #e4e4e7; border-radius: 6px; padding: 3px 6px; font-size: 11px; cursor: pointer; color: #ef4444;">
            ✕
          </button>
        </div>
      `;

      const btnApply = chip.querySelector('.btn-apply-site-repo') as HTMLButtonElement;
      btnApply?.addEventListener('click', async () => {
        if (!this.currentDomain) return;
        await CacheManager.saveSiteProject({
          domain: this.currentDomain,
          repo: proj.repo,
          name: this.currentDomain
        });
        if (inputSiteRepo) inputSiteRepo.value = proj.repo;
        await this.loadSettings();
        await this.loadSiteProjects();
        await this.fetchComments();
        this.showToast(`✓ Dépôt ${proj.repo} associé au site ${this.currentDomain} !`);
      });

      const btnDelete = chip.querySelector('.btn-delete-site-project') as HTMLButtonElement;
      btnDelete?.addEventListener('click', async () => {
        if (confirm(`Supprimer l'association pour le site ${proj.domain} ?`)) {
          await CacheManager.removeSiteProject(proj.domain);
          await this.loadSettings();
          await this.loadSiteProjects();
          await this.fetchComments();
          this.showToast(`✓ Association supprimée pour ${proj.domain}`);
        }
      });

      container.appendChild(chip);
    });
  }

  private async copyHtmlToClipboard(html: string, fallbackPlain: string) {
    let copied = false;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobText = new Blob([fallbackPlain], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })
        ]);
        copied = true;
      }
    } catch {}

    if (!copied) {
      try {
        await navigator.clipboard.writeText(html);
        copied = true;
      } catch {}
    }

    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = html;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        copied = true;
      } catch {}
    }

    return copied;
  }

  private async handleSendInvite() {
    const inputEmail = document.getElementById('input-invite-email') as HTMLInputElement;
    const btnSend = document.getElementById('btn-send-invite') as HTMLButtonElement;
    const email = inputEmail?.value.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.showToast('⚠️ Veuillez entrer une adresse email valide.');
      return;
    }

    // Ensure tab URL and hash are resolved
    if (!this.currentTabUrl || !this.currentUrlHash) {
      await this.setupCurrentTab();
    }

    if (!this.currentTabUrl || !this.currentUrlHash) {
      this.showToast("⚠️ Ouvrez une page web pour inviter des collaborateurs.");
      return;
    }

    const settings = await CacheManager.getSettings(this.currentTabUrl);
    const tokenInput = (document.getElementById('input-github-token') as HTMLInputElement)?.value.trim();
    const repoInput = (document.getElementById('input-storage-repo') as HTMLInputElement)?.value.trim();
    const effectiveRepo = settings.storageRepo || repoInput;
    const effectiveToken = settings.githubToken || tokenInput;

    const hasSettings = Boolean(document.getElementById('settings-drawer'));
    if (!effectiveRepo || !effectiveToken) {
      if (!hasSettings) {
        this.showToast('⚠️ Vous devez d\'abord rejoindre un projet avec le lien reçu par email.');
        return;
      }
      this.showToast('⚠️ Renseignez votre GitHub Token et votre Dépôt dans les Paramètres ⚙️.');
      const settingsDrawer = document.getElementById('settings-drawer');
      const inviteDrawer = document.getElementById('invite-drawer');
      const projectsDrawer = document.getElementById('projects-drawer');
      settingsDrawer?.classList.add('open');
      inviteDrawer?.classList.remove('open');
      projectsDrawer?.classList.remove('open');
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

        const member: ProjectMember = res?.member || {
          id: 'mem_' + Date.now(),
          email,
          role: 'member',
          status: 'active',
          addedAt: new Date().toISOString(),
          addedBy: this.currentAuthorName,
          authCode: 'cw_auth_' + Math.random().toString(36).substring(2, 12)
        };

        await this.loadInvitedMembers();

        // Generate HTML email with project auto-config
        const emailHtml = generateInviteEmailHtml({
          recipientEmail: email,
          invitedByName: this.currentAuthorName,
          pageUrl: this.currentTabUrl!,
          authCode: member.authCode,
          storageRepo: effectiveRepo,
          githubToken: effectiveToken
        });

        // Copy formatted HTML email to clipboard
        await this.copyHtmlToClipboard(emailHtml, this.currentTabUrl!);

        if (inputEmail) inputEmail.value = '';
        this.showToast(`✓ Accès autorisé pour ${email} ! L'email complet est copié : collez-le dans Gmail ou Outlook.`);
      }
    );
  }

  private async handleCopyHtmlEmail() {
    if (!this.currentTabUrl || !this.currentUrlHash) {
      await this.setupCurrentTab();
    }
    if (!this.currentTabUrl || !this.currentUrlHash) {
      this.showToast('⚠️ Ouvrez une page web pour préparer une invitation.');
      return;
    }

    const inputEmail = document.getElementById('input-invite-email') as HTMLInputElement;
    const typedEmail = inputEmail?.value.trim().toLowerCase();
    const recipientEmail = typedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail)
      ? typedEmail
      : 'collaborateur@entreprise.com';

    const settings = await CacheManager.getSettings(this.currentTabUrl);
    const tokenInput = (document.getElementById('input-github-token') as HTMLInputElement)?.value.trim();
    const repoInput = (document.getElementById('input-storage-repo') as HTMLInputElement)?.value.trim();
    const effectiveRepo = settings.storageRepo || repoInput;
    const effectiveToken = settings.githubToken || tokenInput;

    if (!effectiveRepo || !effectiveToken) {
      this.showToast('⚠️ Renseignez votre GitHub Token et votre Dépôt dans les Paramètres ⚙️.');
      return;
    }

    const emailHtml = generateInviteEmailHtml({
      recipientEmail,
      invitedByName: this.currentAuthorName,
      pageUrl: this.currentTabUrl,
      authCode: 'cw_auth_join',
      storageRepo: effectiveRepo,
      githubToken: effectiveToken
    });

    await this.copyHtmlToClipboard(emailHtml, this.currentTabUrl);
    this.showToast('✓ Email HTML copié ! Ouvrez un nouvel email dans Gmail / Outlook et faites Ctrl+V.');
  }

  private async handleCopyInviteLink() {
    if (!this.currentTabUrl || !this.currentUrlHash) {
      await this.setupCurrentTab();
    }
    if (!this.currentTabUrl || !this.currentUrlHash) {
      this.showToast('⚠️ Ouvrez une page web pour préparer une invitation.');
      return;
    }

    const inputEmail = document.getElementById('input-invite-email') as HTMLInputElement;
    const typedEmail = inputEmail?.value.trim().toLowerCase();
    const recipientEmail = typedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail)
      ? typedEmail
      : 'collaborateur@domaine.com';

    const settings = await CacheManager.getSettings(this.currentTabUrl);
    const tokenInput = (document.getElementById('input-github-token') as HTMLInputElement)?.value.trim();
    const repoInput = (document.getElementById('input-storage-repo') as HTMLInputElement)?.value.trim();
    const effectiveRepo = settings.storageRepo || repoInput;
    const effectiveToken = settings.githubToken || tokenInput;

    if (!effectiveRepo || !effectiveToken) {
      this.showToast('⚠️ Renseignez votre GitHub Token et votre Dépôt dans les Paramètres ⚙️.');
      return;
    }

    const encodedConfig = encodeProjectConfig({
      repo: effectiveRepo,
      token: effectiveToken,
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
      `📁 Projet : ${effectiveRepo}\n` +
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

    await this.copyHtmlToClipboard(inviteText, projectLink);
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
    const data = await chrome.storage.local.get([READ_MESSAGES_KEY, 'commyweb_user', 'commyweb_settings']);
    this.readMessages = new Set<string>(data[READ_MESSAGES_KEY] || []);
    this.notificationUser = data.commyweb_user;
    this.notificationEmail = data.commyweb_settings?.userEmail;
    const targetHash = this.currentScope === 'all' ? 'all' : this.currentUrlHash;
    if (!targetHash && this.currentScope !== 'all') return;

    chrome.runtime.sendMessage(
      { type: 'GET_PAGE_COMMENTS', payload: { urlHash: targetHash, url: this.currentTabUrl } },
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
    const resolved = this.comments.filter((c) => c.status === 'resolved').length;
    const open = Math.max(0, total - resolved);

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

    // Unread conversations first, then most recent activity (including replies).
    const sorted = [...this.comments].sort((a, b) =>
      compareConversations(a, b, this.readMessages, this.notificationUser, this.notificationEmail));

    const filtered = sorted.filter((c) => {
      if (this.activeFilter === 'all') return true;
      if (this.activeFilter === 'resolved') return c.status === 'resolved';
      if (this.activeFilter === 'open') return c.status !== 'resolved';
      return true;
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
      const isResolved = comment.status === 'resolved';
      const unread = unreadKeys(comment, this.readMessages, this.notificationUser, this.notificationEmail);
      card.className = `comment-card ${isResolved ? 'resolved' : ''} ${unread.length ? 'has-unread' : ''}`;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.addEventListener('keydown', event => { if (event.target === card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); card.click(); } });

      const authorId = comment.author.name || comment.author.username || comment.author.id || 'User';
      const userColor = getUserColor(authorId);
      const repliesCount = comment.replies?.length || 0;
      const repliesText = repliesCount > 0 ? `${repliesCount} ${t('reply')}` : '';

      let pageBadgeHtml = '';
      try {
        const parsed = new URL(comment.url);
        const pathname = parsed.pathname === '' ? '/' : parsed.pathname;
        pageBadgeHtml = `<span title="${escapeHtml(comment.url)}" style="font-size: 10px; font-family: monospace; background: #f4f4f5; color: #52525b; padding: 2px 5px; border-radius: 4px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">📄 ${escapeHtml(pathname)}</span>`;
      } catch {
        pageBadgeHtml = '';
      }

      card.innerHTML = `
        <div class="card-header">
          <div class="card-author" style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 14px; height: 14px; border-radius: 50%; background-color: ${userColor}; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></div>
            <span class="card-name" style="font-weight: 700;">${escapeHtml(comment.author.name || comment.author.username)}</span>
            ${pageBadgeHtml}
          </div>
          <span class="card-time">${formatRelativeTime(comment.createdAt)}</span>
        </div>
        ${unread.length ? `<span class="unread-label">${unread.length} nouveau${unread.length > 1 ? 'x' : ''} message${unread.length > 1 ? 's' : ''}</span>` : ''}
        <div class="card-text">${escapeHtml(comment.content)}</div>
        <div class="card-footer">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="badge-tag ${isResolved ? 'badge-resolved' : 'badge-open'}" style="${!isResolved ? `border-color: ${userColor}; color: ${userColor};` : ''}">
              ${isResolved ? t('resolved') : t('active')} #${index + 1}
            </span>
            ${repliesText ? `<span>${repliesText}</span>` : ''}
          </div>
          <button class="btn-quick-resolve" data-id="${comment.id}" data-hash="${comment.urlHash}" title="${isResolved ? 'Rouvrir le commentaire' : 'Marquer comme résolu'}" style="border: 1px solid ${isResolved ? '#bbf7d0' : '#e4e4e7'}; background: ${isResolved ? '#dcfce7' : '#ffffff'}; color: ${isResolved ? '#15803d' : '#71717a'}; border-radius: 6px; padding: 2px 7px; font-size: 10px; font-weight: 700; cursor: pointer; transition: all 0.15s;">
            ${isResolved ? '✓ Résolu' : 'Résoudre'}
          </button>
        </div>
      `;

      // Quick resolve toggle without navigating
      const btnResolve = card.querySelector('.btn-quick-resolve') as HTMLButtonElement;
      btnResolve?.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage(
          {
            type: 'RESOLVE_COMMENT',
            payload: { commentId: comment.id, urlHash: comment.urlHash }
          },
          (res) => {
            void chrome.runtime.lastError;
            comment.status = res?.isResolved ? 'resolved' : 'open';
            this.updateCounts();
            this.renderCommentsList();
          }
        );
      });

      // Clicking anywhere on card navigates/focuses comment
      card.addEventListener('click', () => {
        chrome.runtime.sendMessage(
          {
            type: 'NAVIGATE_OR_FOCUS_COMMENT',
            payload: {
              commentId: comment.id,
              targetUrl: comment.url,
              tabId: this.currentTabId
            }
          },
          () => {
            void chrome.runtime.lastError;
            window.close();
          }
        );
      });

      container.appendChild(card);
    });
  }

  private async checkForUpdates() {
    try {
      const manifest = chrome.runtime.getManifest();
      const currentVersion = manifest.version; // e.g. "1.5.4"

      const settings = await CacheManager.getSettings();
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json'
      };
      if (settings.githubToken) {
        headers['Authorization'] = `token ${settings.githubToken}`;
      }

      const res = await fetch('https://api.github.com/repos/kiou98/Commyweb/releases/latest', { headers });
      if (!res.ok) return;
      const data = await res.json();
      const latestTag = (data.tag_name || '').replace(/^v/, '').trim();

      if (latestTag && this.isNewerVersion(latestTag, currentVersion)) {
        const banner = document.getElementById('update-banner');
        const tagEl = document.getElementById('update-version-tag');
        if (banner) banner.style.display = 'block';
        if (tagEl) tagEl.textContent = `v${latestTag}`;
      }
    } catch {
      // offline / quiet
    }
  }

  private isNewerVersion(remote: string, current: string): boolean {
    const remoteParts = remote.split('.').map((n) => parseInt(n, 10) || 0);
    const currentParts = current.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(remoteParts.length, currentParts.length); i++) {
      const r = remoteParts[i] || 0;
      const c = currentParts[i] || 0;
      if (r > c) return true;
      if (r < c) return false;
    }
    return false;
  }
}

new PopupController();
