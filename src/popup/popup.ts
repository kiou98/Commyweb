import { WebComment, UserSettings, RealtimeConfig, Author } from '../types';
import { READ_MESSAGES_KEY, unreadKeys, compareConversations } from '../utils/unread';
import { normalizeUrl, hashUrl, escapeHtml, getUserColor } from '../utils/security';
import { formatRelativeTime } from '../utils/i18n';
import { CacheManager } from '../storage/cache';
import { decodeProjectConfig, projectLink } from '../utils/email-template';
import { parseGitHubRepo } from '../utils/github-parser';
import { githubTokenUrl, githubProjectUrl, invitationEmail, validateInvitationRecipient } from '../utils/github-setup';
import { newRealtimeChannel, realtimeEndpoint } from '../utils/realtime';
import { hasProjectAccess, isUserEdition } from '../storage/collaboration';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);

class PopupController {
  private tabId?: number;
  private url = '';
  private domain = '';
  private comments: WebComment[] = [];
  private readMessages = new Set<string>();
  private notificationUser?: Author;
  private notificationEmail?: string;
  private filter = 'all';
  private loading = false;
  private toastTimer?: number;
  private signature = '';
  private refreshRequested = false;
  private restoring = true;
  private panel = new URLSearchParams(location.search).get('panel') === '1';
  private windowId?: number;
  private userEdition = isUserEdition();

  constructor() { void this.init().catch(error => this.toast(error.message)); }

  private async message(type: string, payload?: unknown): Promise<any> {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response || response.success === false) throw new Error(response?.error || 'Action indisponible. Réessayez.');
    return response;
  }

  private async init() {
    const params = new URLSearchParams(location.search);
    document.body.classList.toggle('side-panel', this.panel);
    document.body.classList.toggle('user-edition', this.userEdition);
    if (this.userEdition) {
      element('btn-toggle-invite').hidden = true;
      element('settings-title').textContent = 'Votre profil';
      element('settings-drawer').querySelector<HTMLElement>(':scope > p')!.hidden = true;
      element('settings-form').hidden = true;
      element('settings-drawer').querySelector<HTMLElement>('.setup-utility')!.hidden = true;
      const join = element<HTMLDetailsElement>('join-details');
      join.classList.add('join-card');
      element('page-path').after(join);
    }
    this.setupEvents();
    const target = Number(new URLSearchParams(location.search).get('tabId'));
    const tab = target ? await chrome.tabs.get(target).catch(() => undefined) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const targetUrl = this.panel ? params.get('page') || tab?.url : tab?.url;
    this.windowId = tab?.windowId;
    if (targetUrl && /^https?:\/\//.test(targetUrl)) {
      this.tabId = tab?.id;
      this.url = normalizeUrl(targetUrl);
      this.domain = new URL(this.url).host;
      element('active-site-domain').textContent = this.domain;
      element('page-path').textContent = new URL(this.url).pathname;
      element('page-path').title = this.url;
    } else {
      element<HTMLButtonElement>('btn-add-comment').disabled = true;
      element('mode-hint').textContent = 'Ouvrez une page web pour laisser un commentaire.';
    }
    await this.loadSettings();
    const stored = await chrome.storage.local.get('commyweb_user');
    input('quick-author-name').value = stored.commyweb_user?.name || stored.commyweb_user?.username || '';
    await this.restoreSetupDraft();
    const requestedRepo = parseGitHubRepo(params.get('repo'));
    if (requestedRepo) { input('input-storage-repo').value = requestedRepo.fullName; this.updateSetupLinks(); }
    this.restoring = false;
    const keepOpen = element<HTMLButtonElement>('btn-keep-open');
    keepOpen.hidden = this.panel || !chrome.sidePanel?.open || !this.url || this.windowId === undefined;
    keepOpen.disabled = false;
    if (this.panel) element('setup-persistence-hint').textContent = 'Ce panneau reste ouvert sur ce site pendant vos recherches sur GitHub. Vos saisies sont conservées sur cet appareil.';
    void this.refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void this.refresh(); }, 15000);
    window.addEventListener('unload', () => clearInterval(timer));
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === 'REALTIME_STATUS_UPDATED') void this.refresh();
      if (message.type === 'COMMENTS_UPDATED' && (!message.payload?.urlHash || message.payload.urlHash === hashUrl(this.url))) void this.refresh(!!message.payload?.cacheOnly);
    });
    const visibility = input('toggle-comments');
    const visibilityStored = await chrome.storage.local.get('commyweb_comments_enabled');
    visibility.checked = visibilityStored.commyweb_comments_enabled !== false;
    visibility.disabled = !this.tabId;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.commyweb_comments_enabled) visibility.checked = changes.commyweb_comments_enabled.newValue !== false;
      if (area === 'local' && (changes[READ_MESSAGES_KEY] || changes.commyweb_user)) void this.refresh(true);
    });
    if (new URLSearchParams(location.search).get('drawer') === 'settings') this.openDrawer('settings');
  }

  private openDrawer(drawer?: string) {
    if (!drawer || (this.userEdition && drawer === 'invite')) drawer = 'comments';
    document.body.classList.toggle('settings-open', drawer === 'settings');
    // Three zones, one visible at a time: comments, invitation, settings.
    for (const name of ['comments', 'settings', 'invite']) {
      element(`${name}-drawer`).hidden = name !== drawer;
      element(`btn-toggle-${name}`).setAttribute('aria-pressed', String(name === drawer));
    }
    if (drawer === 'settings') this.updateSetupLinks();
    if (drawer === 'invite') { void this.updateInvitation(); void this.loadMembers(); }
    this.saveViewState();
  }

  private setupEvents() {
    for (const name of ['comments', 'settings', 'invite']) {
      element(`btn-toggle-${name}`).addEventListener('click', () => this.openDrawer(name));
    }
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => this.openDrawer()));
    document.querySelector('.brand')?.addEventListener('click', event => { event.preventDefault(); this.openDrawer(); });
    element('project-status-bar').addEventListener('click', () => this.openDrawer('settings'));
    element('btn-refresh').addEventListener('click', () => void this.refresh());
    element('btn-add-comment').addEventListener('click', () => void this.startComment());
    input('toggle-comments').addEventListener('change', () => void this.toggleComments());
    element('btn-keep-open').addEventListener('click', () => {
      const params = new URLSearchParams({ panel: '1', drawer: 'settings', page: this.url });
      if (this.tabId) params.set('tabId', String(this.tabId));
      // Start both calls directly in the click handler to preserve the user gesture.
      // Only this explicit action can change the site of an already-open panel.
      const options = chrome.sidePanel.setOptions({ path: `popup.html?${params}`, enabled: true });
      const opening = chrome.sidePanel.open({ windowId: this.windowId! });
      void Promise.all([options, opening]).then(() => window.close())
        .catch(() => this.toast('Ouverture du panneau impossible. Vos saisies sont conservées ; rouvrez Commyweb pour continuer.'));
    });
    element('btn-toggle-github-eye').addEventListener('click', () => {
      const field = input('input-github-token');
      const show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      element('btn-toggle-github-eye').textContent = show ? 'Masquer' : 'Afficher';
      element('btn-toggle-github-eye').setAttribute('aria-label', show ? 'Masquer le jeton' : 'Afficher le jeton');
      element('btn-toggle-github-eye').setAttribute('aria-pressed', String(show));
    });
    input('quick-author-name').addEventListener('input', () => { this.saveViewState(); void this.saveName(); });
    input('quick-author-name').addEventListener('keydown', event => {
      if (event.key === 'Enter') input('quick-author-name').blur();
    });
    element('settings-form').addEventListener('submit', event => { event.preventDefault(); void this.saveSettings(); });
    element('btn-local-mode').addEventListener('click', () => void this.useLocal());
    element('btn-copy-invite-link').addEventListener('click', () => void this.copyLink());
    element('btn-copy-invite-email').addEventListener('click', () => void this.copyEmail());
    element('btn-refresh-members').addEventListener('click', () => void this.loadMembers());
    element('invite-form').addEventListener('submit', event => { event.preventDefault(); void this.prepareEmail(); });
    input('input-storage-repo').addEventListener('input', () => { this.updateSetupLinks(); void this.saveSetupDraft(); });
    input('input-realtime-endpoint').addEventListener('input', () => void this.saveSetupDraft());
    input('input-github-token').addEventListener('input', () => void this.saveSetupDraft());
    for (const id of ['input-invite-email', 'input-join-link']) input(id).addEventListener('input', () => this.saveViewState());
    for (const id of ['realtime-settings', 'join-details']) element(id).addEventListener('toggle', () => this.saveViewState());
    element('btn-load-repositories').addEventListener('click', () => void this.loadRepositories());
    element<HTMLSelectElement>('select-github-repo').addEventListener('change', () => {
      const value = element<HTMLSelectElement>('select-github-repo').value;
      if (value) { input('input-storage-repo').value = value; this.updateSetupLinks(); void this.saveSetupDraft(); }
    });
    element('link-create-token').addEventListener('click', event => {
      event.preventDefault();
      void this.openTokenPage();
    });
    element('join-form').addEventListener('submit', event => { event.preventDefault(); void this.join(); });
    document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.addEventListener('click', () => {
      this.filter = button.dataset.filter!;
      document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(item => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      this.renderComments();
    }));
  }

  private async saveName() {
    const name = input('quick-author-name').value.trim();
    if (!name) return;
    const stored = await chrome.storage.local.get('commyweb_user');
    const user = stored.commyweb_user || { id: crypto.randomUUID(), avatarUrl: '' };
    await chrome.storage.local.set({ commyweb_user: { ...user, name, username: name } });
  }

  private async startComment() {
    if (!this.tabId) return;
    const button = element<HTMLButtonElement>('btn-add-comment');
    button.disabled = true;
    try {
      await this.saveName();
      const message = { type: 'SET_COMMENT_MODE', payload: { active: true } };
      try { await chrome.tabs.sendMessage(this.tabId, message); }
      catch {
        await chrome.scripting.executeScript({ target: { tabId: this.tabId }, files: ['content.js'] });
        await chrome.tabs.sendMessage(this.tabId, message);
      }
      window.close();
    } catch { this.toast('Cette page ne permet pas les annotations. Essayez sur une page web classique.'); }
    finally { button.disabled = false; }
  }

  private async toggleComments() {
    if (!this.tabId) return;
    const toggle = input('toggle-comments');
    toggle.disabled = true;
    try {
      await chrome.tabs.sendMessage(this.tabId, { type: 'SET_COMMENTS_ENABLED', payload: { enabled: toggle.checked } });
    } catch { toggle.checked = !toggle.checked; this.toast('Cette page ne permet pas les commentaires.'); }
    finally { toggle.disabled = false; }
  }

  private async loadSettings() {
    const settings = await CacheManager.getSettings(this.url);
    input('input-storage-repo').value = settings.storageRepo || '';
    input('input-github-token').value = settings.githubToken || '';
    input('input-realtime-endpoint').value = settings.realtime?.endpoint || '';
    this.updateSetupLinks();
    this.renderSettings(settings);
    if (settings.storageRepo && !hasProjectAccess(settings)) this.openDrawer('settings');
  }

  private renderSettings(settings: UserSettings) {
    const shared = hasProjectAccess(settings);
    element('project-status-repo').textContent = settings.storageRepo || 'Sur cet appareil';
    element('project-status-tag').textContent = shared ? 'Équipe' : settings.storageRepo ? 'Accès requis' : 'Local';
    element('project-status-dot').style.background = shared ? '#37845a' : '#8c8c97';
    if (this.userEdition) {
      const status = element<HTMLButtonElement>('project-status-bar');
      status.disabled = true;
      status.setAttribute('aria-label', shared ? 'Projet connecté' : 'Aucun projet connecté');
      const join = element<HTMLDetailsElement>('join-details');
      join.querySelector('summary')!.textContent = shared ? 'Rejoindre un autre projet' : 'J’ai reçu un lien magique';
      join.open = !shared;
    }
  }

  private updateSetupLinks() {
    const repo = parseGitHubRepo(input('input-storage-repo').value);
    element<HTMLAnchorElement>('link-create-token').href = githubTokenUrl(repo?.fullName);
    element<HTMLAnchorElement>('link-github-project').href = githubProjectUrl(repo?.fullName) || 'https://github.com/';
    element('link-github-project').textContent = repo ? `Ouvrir ${repo.fullName} ↗` : 'Retrouver mon projet sur GitHub ↗';
    element('token-project-hint').textContent = repo
      ? `Sur GitHub : « Only select repositories » → ${repo.repo}. Le propriétaire ${repo.owner} et les permissions Issues sont préremplis. Vérifiez-les, puis cliquez sur « Generate token ». Copiez le token et collez-le ci-dessous.`
      : 'Sur GitHub, choisissez « Only select repositories » puis votre projet. Les permissions Issues sont préremplies. Cliquez sur « Generate token », puis copiez le token ici.';
  }

  private async saveSetupDraft() {
    if (!this.domain || this.restoring) return;
    await chrome.storage.local.set({ [`commyweb_setup_draft:${this.domain}`]: {
      repo: input('input-storage-repo').value, token: input('input-github-token').value,
      endpoint: input('input-realtime-endpoint').value
    } });
  }

  private saveViewState() {
    if (!this.domain || this.restoring) return;
    void chrome.storage.local.set({ [`commyweb_popup_state:${this.domain}`]: {
      drawer: !element('settings-drawer').hidden ? 'settings' : !element('invite-drawer').hidden ? 'invite' : '',
      name: input('quick-author-name').value,
      email: input('input-invite-email').value, link: input('input-join-link').value,
      realtimeOpen: element<HTMLDetailsElement>('realtime-settings').open,
      joinOpen: element<HTMLDetailsElement>('join-details').open
    } });
  }

  private async restoreSetupDraft() {
    if (!this.domain) return;
    const key = `commyweb_setup_draft:${this.domain}`;
    const stateKey = `commyweb_popup_state:${this.domain}`;
    const stored = await chrome.storage.local.get([key, stateKey]);
    const draft = stored[key] || (await chrome.storage.session.get(key))[key];
    if (draft) {
      input('input-storage-repo').value = draft.repo ?? '';
      input('input-realtime-endpoint').value = draft.endpoint ?? '';
      if (typeof draft.token === 'string') input('input-github-token').value = draft.token;
      this.openDrawer('settings');
    }
    const state = stored[stateKey];
    if (!state) return;
    input('quick-author-name').value = state.name ?? input('quick-author-name').value;
    input('input-invite-email').value = state.email ?? '';
    input('input-join-link').value = state.link ?? '';
    element<HTMLDetailsElement>('realtime-settings').open = !!state.realtimeOpen;
    element<HTMLDetailsElement>('join-details').open = !!state.joinOpen;
    this.openDrawer(state.drawer);
  }

  private async openTokenPage() {
    try {
      await this.saveSetupDraft();
      await chrome.tabs.create({ url: githubTokenUrl(input('input-storage-repo').value) });
    } catch (error) { this.toast((error as Error).message); }
  }

  private async loadRepositories() {
    const button = element<HTMLButtonElement>('btn-load-repositories');
    button.disabled = true;
    try {
      const response = await this.message('LIST_GITHUB_REPOSITORIES', { token: input('input-github-token').value.trim() });
      const select = element<HTMLSelectElement>('select-github-repo');
      select.replaceChildren(new Option('Choisir le projet à connecter…', ''));
      for (const repo of response.repositories) select.append(new Option(`${repo.fullName}${repo.private ? ' · Privé' : ' · Public'}`, repo.fullName));
      select.hidden = !response.repositories.length;
      element('label-github-repo').hidden = select.hidden;
      select.value = parseGitHubRepo(input('input-storage-repo').value)?.fullName || '';
      const result = element('repository-result');
      result.textContent = response.repositories.length ? `${response.repositories.length} projet(s) accessible(s). Choisissez celui qui stockera vos commentaires.` : 'Aucun projet avec Issues trouvé. Vérifiez la sélection des dépôts dans les réglages de votre jeton GitHub.';
      result.hidden = false;
    } catch (error) { this.toast((error as Error).message); }
    finally { button.disabled = false; }
  }

  private async saveSettings() {
    if (!this.domain) { this.toast('Ouvrez une page web avant de configurer son projet.'); return; }
    const repo = parseGitHubRepo(input('input-storage-repo').value);
    if (!repo) { this.toast('Indiquez un dépôt valide : propriétaire/projet ou une URL GitHub.'); input('input-storage-repo').focus(); return; }
    const token = input('input-github-token').value.trim();
    if (!token) { this.toast('Ajoutez votre jeton personnel pour synchroniser ce projet.'); input('input-github-token').focus(); return; }
    const button = element<HTMLButtonElement>('btn-save-settings');
    button.disabled = true;
    try {
      const rawEndpoint = input('input-realtime-endpoint').value.trim();
      const endpoint = rawEndpoint && realtimeEndpoint(rawEndpoint);
      if (rawEndpoint && !endpoint) throw new Error('Utilisez l’adresse wss:// de votre relais (ws://localhost pour les essais).');
      let realtime: RealtimeConfig | null = null;
      if (endpoint) {
        const existing = (await CacheManager.getAllSiteProjects()).find(project => project.repo.toLowerCase() === repo.fullName.toLowerCase() && project.realtime?.endpoint === endpoint)?.realtime;
        realtime = { endpoint, channel: existing?.channel || newRealtimeChannel() };
      }
      button.textContent = 'Vérification de l’accès…';
      await this.message('VERIFY_GITHUB_PROJECT', { repo: repo.fullName, token });
      await this.message('SAVE_SITE_PROJECT', { project: { domain: this.domain, repo: repo.fullName, token, realtime } });
      await this.clearSetupDraft();
      await this.loadSettings();
      this.signature = '';
      await this.refresh();
      this.toast('Projet connecté : lecture GitHub vérifiée. Vous pouvez commenter ou inviter votre équipe.');
    } catch (error) { this.toast((error as Error).message); }
    finally { button.disabled = false; button.textContent = 'Vérifier et connecter'; }
  }

  private async useLocal() {
    if (!this.domain) return;
    try {
      await this.message('SAVE_SITE_PROJECT', { project: { domain: this.domain, repo: '', token: '', realtime: null } });
      await this.clearSetupDraft();
      await this.loadSettings();
      this.signature = '';
      await this.refresh();
      this.openDrawer();
      this.toast('Mode local activé. Les commentaires du projet restent conservés.');
    } catch (error) { this.toast((error as Error).message); }
  }

  private async clearSetupDraft() {
    const key = `commyweb_setup_draft:${this.domain}`;
    await chrome.storage.local.remove(key);
    await chrome.storage.session.remove(key);
  }

  private async copyLink() {
    if (!this.url) { this.toast('Ouvrez une page web à partager.'); return; }
    try {
      const invitation = await this.updateInvitation(true);
      if (!invitation) throw new Error('Connectez le projet et indiquez l’email du collaborateur.');
      await navigator.clipboard.writeText(invitation.link);
      this.toast('Lien magique personnel copié. Envoyez-le au collaborateur.');
    } catch (error) { this.toast((error as Error).message); }
  }

  private async updateInvitation(generate = false) {
    if (!this.url) return;
    const settings = await CacheManager.getSettings(this.url);
    element('invite-project-summary').textContent = settings.storageRepo ? `Projet : ${settings.storageRepo}` : 'Connectez un projet GitHub avant d’inviter votre équipe à partager ses retours.';
    const emailField = input('input-invite-email');
    const email = emailField.value.trim().toLowerCase();
    const key = `commyweb_invitation_draft:${this.domain}`;
    let cached = (await chrome.storage.local.get(key))[key];
    if (cached?.email !== email || cached?.repo !== settings.storageRepo || cached?.url !== this.url || Date.parse(cached?.expiresAt) <= Date.now()) cached = undefined;
    const button = element<HTMLButtonElement>('btn-prepare-email');
    button.disabled = !settings.githubToken || !settings.storageRepo;
    if (generate && !cached) {
      validateInvitationRecipient(email);
      const buttons = ['btn-prepare-email', 'btn-copy-invite-email', 'btn-copy-invite-link'].map(id => element<HTMLButtonElement>(id));
      buttons.forEach(item => { item.disabled = true; }); emailField.disabled = true;
      button.textContent = 'Création du lien magique…';
      try {
        const result = await this.message('INVITE_MEMBER', { url: this.url, email });
        cached = { email, repo: settings.storageRepo, url: this.url, expiresAt: result.member.expiresAt,
          link: projectLink(this.url, settings.storageRepo, settings.realtime, result.invitation) };
        await chrome.storage.local.set({ [key]: cached });
        void this.loadMembers();
      } finally {
        buttons.forEach(item => { item.disabled = false; }); emailField.disabled = false;
        button.textContent = '✉ Préparer l’email d’invitation';
      }
    }
    if (!cached) {
      element('invite-email-preview').textContent = 'Saisissez l’email du collaborateur, puis préparez l’invitation pour créer son lien magique personnel.';
      return;
    }
    const invitation = invitationEmail(this.url, settings.storageRepo, input('quick-author-name').value.trim() || 'Votre équipe', settings.realtime, cached.link);
    element('invite-email-preview').innerHTML = invitation.html;
    return invitation;
  }

  private async loadMembers() {
    if (!this.url || this.userEdition) return;
    const list = element('members-list');
    try {
      const response = await this.message('GET_MEMBERS', { url: this.url });
      list.replaceChildren();
      if (!response.members.length) { list.textContent = 'Aucune invitation pour ce site.'; return; }
      for (const member of response.members) {
        const row = document.createElement('div'); row.className = 'member-row';
        row.innerHTML = `<span>${escapeHtml(member.email)}<small>Expire le ${escapeHtml(new Date(member.expiresAt).toLocaleDateString('fr-FR'))}</small></span>`;
        const revoke = document.createElement('button'); revoke.className = 'text-button'; revoke.textContent = 'Retirer l’accès';
        revoke.addEventListener('click', async () => {
          revoke.disabled = true;
          try {
            await this.message('REVOKE_MEMBER', { url: this.url, memberId: member.id });
            await chrome.storage.local.remove(`commyweb_invitation_draft:${this.domain}`);
            await this.loadMembers(); this.toast('Accès retiré. Le lien ne permet plus de synchroniser les commentaires.');
          } catch (error) { this.toast((error as Error).message); revoke.disabled = false; }
        });
        row.append(revoke); list.append(row);
      }
    } catch (error) { list.textContent = (error as Error).message; }
  }

  private async prepareEmail() {
    try {
      const invitation = await this.updateInvitation(true);
      if (!invitation) throw new Error('Ouvrez une page web à partager.');
      element<HTMLDetailsElement>('invite-preview-details').open = true;
      this.toast('Email prêt. Cliquez sur « Copier l’email HTML », puis collez-le dans votre messagerie.');
    } catch (error) { this.toast((error as Error).message); }
  }

  private async copyEmail() {
    try {
      validateInvitationRecipient(input('input-invite-email').value.trim());
      // Start the clipboard operation during the click, even if creating the link takes time.
      const invitation = this.updateInvitation(true).then(email => {
        if (!email) throw new Error('Ouvrez une page web à partager.');
        return email;
      });
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': invitation.then(email => new Blob([email.html], { type: 'text/html' })),
        'text/plain': invitation.then(email => new Blob([`Objet : ${email.subject}\n\n${email.body}`], { type: 'text/plain' }))
      })]);
      this.toast('Email HTML copié. Collez-le dans un nouveau message en conservant la mise en forme, puis ajoutez le destinataire.');
    } catch (error) { this.toast((error as Error).message); }
  }

  private async join() {
    try {
      const link = new URL(input('input-join-link').value.trim());
      const encoded = new URLSearchParams(link.hash.slice(1)).get('commyweb_config');
      const config = encoded && decodeProjectConfig(encoded);
      if (!config) throw new Error('Lien Commyweb invalide.');
      if (config.invitation) {
        await this.message('AUTO_CONFIGURE_PROJECT', { url: config.url, repo: config.repo, invitation: config.invitation, realtime: config.realtime });
        if (this.tabId) await chrome.tabs.update(this.tabId, { url: config.url });
        else await chrome.tabs.create({ url: config.url });
        window.close(); return;
      }
      if (this.tabId) await chrome.tabs.update(this.tabId, { url: projectLink(config.url, config.repo, config.realtime, config.invitation) });
      else await chrome.tabs.create({ url: projectLink(config.url, config.repo, config.realtime, config.invitation) });
      window.close();
    } catch (error) { this.toast((error as Error).message); }
  }

  private async refresh(cacheOnly = false) {
    const data = await chrome.storage.local.get([READ_MESSAGES_KEY, 'commyweb_user', 'commyweb_settings']);
    this.readMessages = new Set<string>(data[READ_MESSAGES_KEY] || []);
    this.notificationUser = data.commyweb_user;
    this.notificationEmail = data.commyweb_settings?.userEmail;
    if (cacheOnly) {
      const settings = await CacheManager.getSettings(this.url);
      this.comments = (await CacheManager.getCommentsForUrl(hashUrl(this.url))).filter(c => CacheManager.belongsToProject(c, settings.storageRepo));
      this.signature = JSON.stringify(this.comments); this.renderComments();
      return;
    }
    if (this.loading) { this.refreshRequested = true; return; }
    if (!this.url) { element('comments-list').setAttribute('aria-busy', 'false'); this.renderComments(); return; }
    this.loading = true;
    const button = element<HTMLButtonElement>('btn-refresh');
    button.disabled = true;
    try {
      if (!this.signature) {
        const settings = await CacheManager.getSettings(this.url);
        this.comments = (await CacheManager.getCommentsForUrl(hashUrl(this.url)))
          .filter(comment => CacheManager.belongsToProject(comment, settings.storageRepo));
        this.signature = JSON.stringify(this.comments);
        this.renderComments();
      }
      const response = await this.message('GET_PAGE_COMMENTS', { urlHash: hashUrl(this.url), url: this.url });
      this.comments = response.comments || [];
      const settings = await CacheManager.getSettings(this.url);
      const realtimeStatus = element('realtime-status');
      realtimeStatus.dataset.state = response.realtimeStatus || 'off';
      realtimeStatus.textContent = !settings.storageRepo ? 'Mode local · sur cet appareil'
        : !hasProjectAccess(settings) ? 'Projet sélectionné · ouvrez votre lien magique pour vous connecter'
        : response.syncError ? 'GitHub indisponible · modifications conservées sur cet appareil'
        : response.realtimeStatus === 'live' ? '● Temps réel actif · changements reçus automatiquement'
        : response.realtimeStatus === 'connecting' ? 'Connexion au temps réel…'
        : response.realtimeStatus === 'reconnecting' ? 'Relais déconnecté · reconnexion automatique, secours toutes les 15 s'
        : 'GitHub connecté · actualisation toutes les 15 s (relais non configuré)';
      const notice = element('sync-status');
      notice.textContent = response.syncError ? `Enregistré sur cet appareil. ${response.syncError}` : '';
      notice.hidden = !response.syncError;
      const signature = JSON.stringify(this.comments);
      if (signature !== this.signature) { this.signature = signature; this.renderComments(); }
    } catch (error) { this.toast((error as Error).message); }
    finally {
      this.loading = false; button.disabled = false; element('comments-list').setAttribute('aria-busy', 'false');
      if (this.refreshRequested) { this.refreshRequested = false; void this.refresh(); }
    }
  }

  private renderComments() {
    const container = element('comments-list');
    const scroll = container.scrollTop;
    element('count-all').textContent = String(this.comments.length);
    element('count-open').textContent = String(this.comments.filter(c => c.status === 'open').length);
    element('count-resolved').textContent = String(this.comments.filter(c => c.status === 'resolved').length);
    const comments = [...this.comments].filter(c => this.filter === 'all' || c.status === this.filter)
      .sort((a, b) => compareConversations(a, b, this.readMessages, this.notificationUser, this.notificationEmail));
    container.replaceChildren();
    if (!comments.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const title = !this.url ? 'Une page à commenter ?' : this.filter === 'resolved' ? 'Aucune discussion résolue'
        : this.filter === 'open' ? 'Tout est à jour' : 'Votre premier retour commence ici';
      empty.innerHTML = `<strong>${title}</strong><p>${!this.url ? 'Ouvrez un site puis retrouvez Commyweb ici.' : this.filter === 'all'
        ? 'Ajoutez un commentaire sur un texte, une image ou un détail à améliorer.' : 'Retrouvez toutes les discussions dans le filtre « Toutes ».'}</p>`;
      container.append(empty);
    }
    for (const comment of comments) {
      const card = document.createElement('article');
      const resolved = comment.status === 'resolved';
      const unread = unreadKeys(comment, this.readMessages, this.notificationUser, this.notificationEmail);
      card.className = `comment-card${resolved ? ' resolved' : ''}${unread.length ? ' has-unread' : ''}`;
      const name = comment.author.name || comment.author.username;
      card.innerHTML = `<button class="card-open" aria-label="Ouvrir la discussion de ${escapeHtml(name)}">
        <span class="card-header"><span class="author-dot" style="background:${getUserColor(name)}"></span><span class="card-name">${escapeHtml(name)}</span><span class="card-time">${escapeHtml(formatRelativeTime(comment.createdAt))}</span></span>
        ${unread.length ? `<span class="unread-label">${unread.length} nouveau${unread.length > 1 ? 'x' : ''} message${unread.length > 1 ? 's' : ''}</span>` : ''}
        <span class="card-text">${escapeHtml(comment.content)}</span></button>
        <div class="card-footer"><span>${comment.replies.length ? `${comment.replies.length} réponse${comment.replies.length > 1 ? 's' : ''}` : 'Aucune réponse'}${comment.pendingChanges?.length ? ' · Sur cet appareil' : ''}</span>
        <button class="resolve-btn">${resolved ? 'Rouvrir' : 'Résoudre'}</button></div>`;
      card.querySelector('.card-open')!.addEventListener('click', async () => {
        try {
          await this.message('NAVIGATE_OR_FOCUS_COMMENT', { commentId: comment.id, targetUrl: comment.url, tabId: this.tabId });
          window.close();
        } catch (error) { this.toast((error as Error).message); }
      });
      card.querySelector('.resolve-btn')!.addEventListener('click', async event => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        try {
          const response = await this.message('RESOLVE_COMMENT', { commentId: comment.id, urlHash: comment.urlHash, url: comment.url });
          if (response.error) this.toast(`Modification conservée sur cet appareil. ${response.error}`);
          await this.refresh(true);
        } catch (error) { this.toast((error as Error).message); }
        finally { button.disabled = false; }
      });
      container.append(card);
    }
    container.scrollTop = scroll;
  }

  private toast(message: string) {
    const toast = element('toast');
    clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    this.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 5500);
  }
}

new PopupController();
