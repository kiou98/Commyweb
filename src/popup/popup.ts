import { WebComment, UserSettings, RealtimeConfig } from '../types';
import { normalizeUrl, hashUrl, escapeHtml, getUserColor } from '../utils/security';
import { formatRelativeTime } from '../utils/i18n';
import { CacheManager } from '../storage/cache';
import { decodeProjectConfig, projectLink } from '../utils/email-template';
import { parseGitHubRepo } from '../utils/github-parser';
import { githubTokenUrl, githubProjectUrl, invitationEmail, invitationMailto } from '../utils/github-setup';
import { newRealtimeChannel, realtimeEndpoint } from '../utils/realtime';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);

class PopupController {
  private tabId?: number;
  private url = '';
  private domain = '';
  private comments: WebComment[] = [];
  private filter = 'all';
  private loading = false;
  private toastTimer?: number;
  private signature = '';
  private refreshRequested = false;

  constructor() { void this.init().catch(error => this.toast(error.message)); }

  private async message(type: string, payload?: unknown): Promise<any> {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response || response.success === false) throw new Error(response?.error || 'Action indisponible. Réessayez.');
    return response;
  }

  private async init() {
    const params = new URLSearchParams(location.search);
    this.setupEvents();
    const target = Number(new URLSearchParams(location.search).get('tabId'));
    const tab = target ? await chrome.tabs.get(target) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab?.id && tab.url && /^https?:\/\//.test(tab.url)) {
      this.tabId = tab.id;
      this.url = normalizeUrl(tab.url);
      this.domain = new URL(this.url).host;
      element('active-site-domain').textContent = this.domain;
      element('page-path').textContent = new URL(this.url).pathname;
      element('page-path').title = this.url;
    } else {
      element<HTMLButtonElement>('btn-add-comment').disabled = true;
      element('mode-hint').textContent = 'Ouvrez une page web pour laisser un commentaire.';
    }
    await this.loadSettings();
    await this.restoreSetupDraft();
    const requestedRepo = parseGitHubRepo(params.get('repo'));
    if (requestedRepo) { input('input-storage-repo').value = requestedRepo.fullName; this.updateSetupLinks(); }
    const stored = await chrome.storage.local.get('commyweb_user');
    input('quick-author-name').value = stored.commyweb_user?.name || stored.commyweb_user?.username || '';
    await this.refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void this.refresh(); }, 15000);
    window.addEventListener('unload', () => clearInterval(timer));
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === 'REALTIME_STATUS_UPDATED') void this.refresh();
      if (message.type === 'COMMENTS_UPDATED' && (!message.payload?.urlHash || message.payload.urlHash === hashUrl(this.url))) void this.refresh();
    });
    if (new URLSearchParams(location.search).get('drawer') === 'settings') this.openDrawer('settings');
  }

  private openDrawer(drawer?: string) {
    for (const name of ['settings', 'invite']) {
      element(`${name}-drawer`).hidden = name !== drawer;
      element(`btn-toggle-${name}`).setAttribute('aria-expanded', String(name === drawer));
    }
    if (drawer === 'settings') this.updateSetupLinks();
    if (drawer === 'invite') void this.updateInvitation();
  }

  private setupEvents() {
    for (const name of ['settings', 'invite']) {
      element(`btn-toggle-${name}`).addEventListener('click', () => this.openDrawer(element(`${name}-drawer`).hidden ? name : undefined));
    }
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => this.openDrawer()));
    document.querySelector('.brand')?.addEventListener('click', event => { event.preventDefault(); this.openDrawer(); });
    element('project-status-bar').addEventListener('click', () => this.openDrawer('settings'));
    element('btn-refresh').addEventListener('click', () => void this.refresh());
    element('btn-add-comment').addEventListener('click', () => void this.startComment());
    element('btn-toggle-github-eye').addEventListener('click', () => {
      const field = input('input-github-token');
      const show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      element('btn-toggle-github-eye').textContent = show ? 'Masquer' : 'Afficher';
      element('btn-toggle-github-eye').setAttribute('aria-label', show ? 'Masquer le jeton' : 'Afficher le jeton');
      element('btn-toggle-github-eye').setAttribute('aria-pressed', String(show));
    });
    input('quick-author-name').addEventListener('change', () => void this.saveName());
    input('quick-author-name').addEventListener('keydown', event => {
      if (event.key === 'Enter') input('quick-author-name').blur();
    });
    element('settings-form').addEventListener('submit', event => { event.preventDefault(); void this.saveSettings(); });
    element('btn-local-mode').addEventListener('click', () => void this.useLocal());
    element('btn-copy-invite-link').addEventListener('click', () => void this.copyLink());
    element('btn-copy-invite-email').addEventListener('click', () => void this.copyEmail());
    element('invite-form').addEventListener('submit', event => { event.preventDefault(); void this.prepareEmail(); });
    input('input-storage-repo').addEventListener('input', () => { this.updateSetupLinks(); void this.saveSetupDraft(); });
    input('input-realtime-endpoint').addEventListener('input', () => void this.saveSetupDraft());
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

  private async loadSettings() {
    const settings = await CacheManager.getSettings(this.url);
    input('input-storage-repo').value = settings.storageRepo || '';
    input('input-github-token').value = settings.githubToken || '';
    input('input-realtime-endpoint').value = settings.realtime?.endpoint || '';
    this.updateSetupLinks();
    this.renderSettings(settings);
    if (settings.storageRepo && !settings.githubToken) this.openDrawer('settings');
  }

  private renderSettings(settings: UserSettings) {
    const shared = !!(settings.storageRepo && settings.githubToken);
    element('project-status-repo').textContent = settings.storageRepo || 'Sur cet appareil';
    element('project-status-tag').textContent = shared ? 'Équipe' : settings.storageRepo ? 'Accès requis' : 'Local';
    element('project-status-dot').style.background = shared ? '#37845a' : '#8c8c97';
  }

  private updateSetupLinks() {
    const repo = parseGitHubRepo(input('input-storage-repo').value);
    element<HTMLAnchorElement>('link-create-token').href = githubTokenUrl(repo?.fullName);
    element<HTMLAnchorElement>('link-github-project').href = githubProjectUrl(repo?.fullName) || 'https://github.com/';
    element('link-github-project').textContent = repo ? `Ouvrir ${repo.fullName} ↗` : 'Retrouver mon projet sur GitHub ↗';
    element('token-project-hint').textContent = repo
      ? `Sur GitHub : « Only select repositories » → ${repo.repo}. Le propriétaire ${repo.owner} et les permissions Issues sont préremplis. Vérifiez-les, puis cliquez sur « Generate token ».`
      : 'Sur GitHub, choisissez « Only select repositories » puis votre projet. Les permissions Issues sont préremplies.';
  }

  private async saveSetupDraft() {
    if (!this.domain) return;
    await chrome.storage.session.set({ [`commyweb_setup_draft:${this.domain}`]: {
      repo: input('input-storage-repo').value, endpoint: input('input-realtime-endpoint').value
    } });
  }

  private async restoreSetupDraft() {
    if (!this.domain) return;
    const key = `commyweb_setup_draft:${this.domain}`;
    const draft = (await chrome.storage.session.get(key))[key];
    if (!draft) return;
    input('input-storage-repo').value = draft.repo || '';
    input('input-realtime-endpoint').value = draft.endpoint || '';
    this.openDrawer('settings');
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
      await chrome.storage.session.remove(`commyweb_setup_draft:${this.domain}`);
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
      await chrome.storage.session.remove(`commyweb_setup_draft:${this.domain}`);
      await this.loadSettings();
      this.signature = '';
      await this.refresh();
      this.openDrawer();
      this.toast('Mode local activé. Les commentaires du projet restent conservés.');
    } catch (error) { this.toast((error as Error).message); }
  }

  private async copyLink() {
    if (!this.url) { this.toast('Ouvrez une page web à partager.'); return; }
    try {
      const settings = await CacheManager.getSettings(this.url);
      await navigator.clipboard.writeText(projectLink(this.url, settings.storageRepo, settings.realtime));
      this.toast(settings.storageRepo ? 'Lien copié. Votre jeton reste sur cet appareil.' : 'Lien copié. Les commentaires locaux ne sont pas partagés.');
    } catch { this.toast('Copie impossible. Vérifiez l’autorisation du presse-papier et réessayez.'); }
  }

  private async updateInvitation() {
    if (!this.url) return;
    const settings = await CacheManager.getSettings(this.url);
    const invitation = invitationEmail(this.url, settings.storageRepo, input('quick-author-name').value.trim() || 'Votre équipe', settings.realtime);
    element<HTMLTextAreaElement>('invite-email-preview').value = `Objet : ${invitation.subject}\n\n${invitation.body}`;
    element('invite-project-summary').textContent = settings.storageRepo ? `Projet : ${settings.storageRepo}` : 'Connectez un projet GitHub avant d’inviter votre équipe à partager ses retours.';
    const projectUrl = githubProjectUrl(settings.storageRepo);
    element<HTMLAnchorElement>('link-github-access').href = projectUrl ? `${projectUrl}/settings/access` : 'https://github.com/';
    element<HTMLButtonElement>('btn-prepare-email').disabled = !settings.storageRepo;
    return invitation;
  }

  private async prepareEmail() {
    try {
      const invitation = await this.updateInvitation();
      if (!invitation) throw new Error('Ouvrez une page web à partager.');
      const href = invitationMailto(input('input-invite-email').value.trim(), invitation.subject, invitation.body);
      const link = document.createElement('a');
      link.href = href; document.body.append(link); link.click(); link.remove();
      this.toast('Terminez dans votre messagerie : vérifiez l’email, puis cliquez sur Envoyer. Si elle ne s’ouvre pas, utilisez « Copier l’email complet ».');
    } catch (error) { this.toast((error as Error).message); }
  }

  private async copyEmail() {
    try {
      const invitation = await this.updateInvitation();
      if (!invitation) throw new Error('Ouvrez une page web à partager.');
      await navigator.clipboard.writeText(`Objet : ${invitation.subject}\n\n${invitation.body}`);
      this.toast('Email copié. Collez-le dans un nouvel email, ajoutez le destinataire et cliquez sur Envoyer.');
    } catch (error) { this.toast((error as Error).message); }
  }

  private async join() {
    try {
      const link = new URL(input('input-join-link').value.trim());
      const encoded = new URLSearchParams(link.hash.slice(1)).get('commyweb_config');
      const config = encoded && decodeProjectConfig(encoded);
      if (!config) throw new Error('Lien Commyweb invalide.');
      if (this.tabId) await chrome.tabs.update(this.tabId, { url: projectLink(config.url, config.repo, config.realtime) });
      else await chrome.tabs.create({ url: projectLink(config.url, config.repo, config.realtime) });
      window.close();
    } catch (error) { this.toast((error as Error).message); }
  }

  private async refresh() {
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
        : !settings.githubToken ? 'Projet sélectionné · votre accès GitHub est nécessaire'
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
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
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
      card.className = `comment-card${resolved ? ' resolved' : ''}`;
      const name = comment.author.name || comment.author.username;
      card.innerHTML = `<button class="card-open" aria-label="Ouvrir la discussion de ${escapeHtml(name)}">
        <span class="card-header"><span class="author-dot" style="background:${getUserColor(name)}"></span><span class="card-name">${escapeHtml(name)}</span><span class="card-time">${escapeHtml(formatRelativeTime(comment.createdAt))}</span></span>
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
          await this.refresh();
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
