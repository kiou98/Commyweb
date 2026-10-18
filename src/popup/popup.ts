import { WebComment, UserSettings } from '../types';
import { normalizeUrl, hashUrl, escapeHtml, getUserColor } from '../utils/security';
import { formatRelativeTime } from '../utils/i18n';
import { CacheManager } from '../storage/cache';
import { decodeProjectConfig, projectLink } from '../utils/email-template';
import { parseGitHubRepo } from '../utils/github-parser';

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

  constructor() { void this.init().catch(error => this.toast(error.message)); }

  private async message(type: string, payload?: unknown): Promise<any> {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response || response.success === false) throw new Error(response?.error || 'Action indisponible. Réessayez.');
    return response;
  }

  private async init() {
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
    const stored = await chrome.storage.local.get('commyweb_user');
    input('quick-author-name').value = stored.commyweb_user?.name || stored.commyweb_user?.username || '';
    await this.refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void this.refresh(); }, 15000);
    window.addEventListener('unload', () => clearInterval(timer));
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === 'COMMENTS_UPDATED' && (!message.payload?.urlHash || message.payload.urlHash === hashUrl(this.url))) void this.refresh();
    });
    if (new URLSearchParams(location.search).get('drawer') === 'settings') this.openDrawer('settings');
  }

  private openDrawer(drawer?: string) {
    for (const name of ['settings', 'invite']) {
      element(`${name}-drawer`).hidden = name !== drawer;
      element(`btn-toggle-${name}`).setAttribute('aria-expanded', String(name === drawer));
    }
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
    this.renderSettings(settings);
  }

  private renderSettings(settings: UserSettings) {
    const shared = !!(settings.storageRepo && settings.githubToken);
    element('project-status-repo').textContent = settings.storageRepo || 'Sur cet appareil';
    element('project-status-tag').textContent = shared ? 'Équipe' : settings.storageRepo ? 'Accès requis' : 'Local';
    element('project-status-dot').style.background = shared ? '#37845a' : '#8c8c97';
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
      await this.message('SAVE_SITE_PROJECT', { project: { domain: this.domain, repo: repo.fullName, token } });
      await this.loadSettings();
      this.signature = '';
      await this.refresh();
      this.toast('Projet enregistré. Les droits GitHub sont vérifiés à la synchronisation.');
    } catch (error) { this.toast((error as Error).message); }
    finally { button.disabled = false; }
  }

  private async useLocal() {
    if (!this.domain) return;
    try {
      await this.message('SAVE_SITE_PROJECT', { project: { domain: this.domain, repo: '', token: '' } });
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
      await navigator.clipboard.writeText(projectLink(this.url, settings.storageRepo));
      this.toast(settings.storageRepo ? 'Lien copié. Votre jeton reste sur cet appareil.' : 'Lien copié. Les commentaires locaux ne sont pas partagés.');
    } catch { this.toast('Copie impossible. Vérifiez l’autorisation du presse-papier et réessayez.'); }
  }

  private async join() {
    try {
      const link = new URL(input('input-join-link').value.trim());
      const encoded = new URLSearchParams(link.hash.slice(1)).get('commyweb_config');
      const config = encoded && decodeProjectConfig(encoded);
      if (!config) throw new Error('Lien Commyweb invalide.');
      if (this.tabId) await chrome.tabs.update(this.tabId, { url: projectLink(config.url, config.repo) });
      else await chrome.tabs.create({ url: projectLink(config.url, config.repo) });
      window.close();
    } catch (error) { this.toast((error as Error).message); }
  }

  private async refresh() {
    if (!this.url || this.loading) { element('comments-list').setAttribute('aria-busy', 'false'); if (!this.url) this.renderComments(); return; }
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
      const notice = element('sync-status');
      notice.textContent = response.syncError ? `Enregistré sur cet appareil. ${response.syncError}` : '';
      notice.hidden = !response.syncError;
      const signature = JSON.stringify(this.comments);
      if (signature !== this.signature) { this.signature = signature; this.renderComments(); }
    } catch (error) { this.toast((error as Error).message); }
    finally { this.loading = false; button.disabled = false; element('comments-list').setAttribute('aria-busy', 'false'); }
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
