import { AnchorEngine } from './anchor';
import { ShadowHostManager } from './ui/shadow-host';
import { PinElement } from './ui/pin';
import { ThreadModal } from './ui/thread-modal';
import { CursorManager } from './ui/cursor';
import { WebComment, Author, AnchorData } from '../types';
import { normalizeUrl, hashUrl, generateId } from '../utils/security';
import { decodeProjectConfig } from '../utils/email-template';
import { CacheManager } from '../storage/cache';

class CommywebContentApp {
  private host = ShadowHostManager.getInstance();
  private cursor: CursorManager;
  private modal: ThreadModal;
  private pins = new Map<string, PinElement>();
  private comments: WebComment[] = [];
  private currentUrl = normalizeUrl(location.href);
  private currentUser: Author = { id: 'anonymous', username: 'Invité', avatarUrl: '' };
  private active = false;
  private pendingAnchor: AnchorData | null = null;
  private activeCommentId: string | null = null;
  private loading = false;
  private refreshRequested = false;
  private positionFrame = 0;
  private lastRightClick: { x: number; y: number; target: Element } | null = null;
  private focusId: string | null = null;
  private toolbar: HTMLButtonElement;

  constructor() {
    this.cursor = new CursorManager(this.host.shadowRoot);
    this.modal = new ThreadModal({
      onReply: (id, text) => this.reply(id, text),
      onToggleResolve: id => this.resolve(id),
      onCreateNew: text => this.createComment(text), onClose: () => this.closeModal()
    });
    this.toolbar = document.createElement('button');
    this.toolbar.className = 'commyweb-toolbar';
    this.toolbar.addEventListener('click', () => this.setMode(!this.active));
    this.host.shadowRoot.append(this.toolbar);
    this.updateToolbar();
    this.setupEvents();
    this.setupMessages();
    void this.loadUser();
    void this.checkLink();
    void this.loadComments();
    window.setInterval(() => { if (!document.hidden) void this.loadComments(); }, 15000);
    // History changes in the page's JavaScript world cannot always be intercepted by an extension.
    window.setInterval(() => this.checkNavigation(), 1000);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.commyweb_user?.newValue) this.currentUser = changes.commyweb_user.newValue;
    });
  }

  private async message(type: string, payload: Record<string, unknown> = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload: { ...payload, url: this.currentUrl } });
    if (!response || !response.success) throw new Error(response?.error || 'Enregistrement impossible. Réessayez.');
    return response;
  }

  private setupEvents() {
    window.addEventListener('contextmenu', event => {
      if (event.composedPath().includes(this.host.hostElement)) return;
      this.lastRightClick = { x: event.clientX, y: event.clientY, target: event.target as Element };
    }, true);
    window.addEventListener('click', event => {
      if (event.composedPath().includes(this.host.hostElement)) return;
      if (!this.active) { this.closeModal(); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.modal.isCreatingNew && this.modal.hasDraft()) return;
      this.pendingAnchor = AnchorEngine.createAnchorFromEvent(event);
      this.openComposer(event.pageX, event.pageY);
    }, true);
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (this.modal.element.isConnected) { this.closeModal(); event.preventDefault(); }
      this.setMode(false);
    });
    const schedule = () => {
      if (this.positionFrame) return;
      this.positionFrame = requestAnimationFrame(() => { this.positionFrame = 0; this.refreshPositions(); });
    };
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule, { passive: true });
    new ResizeObserver(schedule).observe(document.body || document.documentElement);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.checkNavigation(); void this.loadComments(); } });
    window.addEventListener('focus', () => { this.checkNavigation(); void this.loadComments(); });
    window.addEventListener('popstate', () => this.checkNavigation());
    window.addEventListener('hashchange', () => { this.checkNavigation(); void this.checkLink(); });
  }

  private setupMessages() {
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      this.checkNavigation();
      switch (message.type) {
        case 'CONTEXT_MENU_ADD_COMMENT': {
          if (this.modal.hasDraft()) { this.modal.focusInput(); break; }
          const point = this.lastRightClick;
          if (point && point.target.isConnected) {
            this.pendingAnchor = AnchorEngine.createAnchorFromPoint(point.x, point.y, point.target);
            this.openComposer(point.x + scrollX, point.y + scrollY);
          } else this.setMode(true);
          break;
        }
        case 'SET_COMMENT_MODE': this.setMode(!!message.payload?.active); break;
        case 'TOGGLE_COMMENT_MODE': this.setMode(!this.active); break;
        case 'GET_COMMENT_MODE': break;
        case 'COMMENTS_UPDATED':
          if (!message.payload?.urlHash || message.payload.urlHash === hashUrl(this.currentUrl)) void this.loadComments();
          break;
        case 'SYNC_COMMENTS': void this.loadComments(); break;
        case 'FOCUS_COMMENT': this.focusId = message.payload?.commentId; void this.loadComments(); break;
        default: return;
      }
      respond({ success: true, isCommentModeActive: this.active });
    });
  }

  private checkNavigation() {
    const url = normalizeUrl(location.href);
    if (url === this.currentUrl) return;
    this.currentUrl = url;
    this.comments = [];
    this.pins.forEach(pin => pin.element.remove());
    this.pins.clear();
    this.closeModal();
    this.setMode(false);
    void this.checkLink();
    void this.loadComments();
  }

  private async checkLink() {
    const params = new URLSearchParams(location.hash.slice(1));
    const focusId = params.get('commyweb_focus');
    const config = params.get('commyweb_config');
    if (!focusId && !config) return;
    // Remove legacy secret-bearing fragments before awaiting any asynchronous work.
    history.replaceState(history.state, '', location.pathname + location.search);
    if (focusId) { this.focusId = focusId; void this.loadComments(); }
    if (config) {
      const decoded = decodeProjectConfig(config);
      if (!decoded || normalizeUrl(decoded.url) !== this.currentUrl) { this.toast('Ce lien ne correspond pas à cette page.'); return; }
      if (!decoded.repo) return;
      try {
        await this.message('AUTO_CONFIGURE_PROJECT', { repo: decoded.repo });
        this.toast('Projet sélectionné. Ajoutez votre propre accès GitHub dans les réglages Commyweb.');
        void this.loadComments();
      } catch (error) { this.toast((error as Error).message); }
    }
  }

  private setMode(active: boolean) {
    this.active = active;
    this.cursor.setActive(active);
    this.updateToolbar();
    if (active && !this.modal.hasDraft()) this.closeModal();
  }

  private openComposer(x: number, y: number) {
    this.activeCommentId = null;
    this.pins.forEach(pin => pin.setActive(false));
    this.host.shadowRoot.append(this.modal.element);
    this.modal.renderNewCommentBox(x, y);
  }

  private async createComment(text: string) {
    if (!this.pendingAnchor) throw new Error('Choisissez un endroit sur la page.');
    const settings = await CacheManager.getSettings(this.currentUrl);
    const comment: WebComment = {
      id: generateId(), url: this.currentUrl, urlHash: hashUrl(this.currentUrl), anchor: this.pendingAnchor,
      author: { ...this.currentUser }, content: text, status: 'open', createdAt: new Date().toISOString(), replies: [],
      storageRepo: settings.storageRepo || '', pendingChanges: ['content']
    };
    // Confirm local persistence before dismissing the draft; network work continues afterwards.
    await CacheManager.addComment(comment);
    this.comments.push(comment);
    this.closeModal();
    this.setMode(false);
    this.renderPins();
    this.toast('Commentaire enregistré sur cet appareil.');
    void this.message('ADD_COMMENT', { comment }).then(response => {
      if (response.synced) this.toast('Commentaire partagé avec l’équipe.');
      else if (response.error) this.toast(`Commentaire conservé sur cet appareil. ${response.error}`);
      void this.loadComments();
    }).catch(error => this.toast(`Commentaire conservé sur cet appareil. ${error.message}`));
  }

  private async reply(id: string, text: string) {
    const response = await this.message('ADD_REPLY', { commentId: id, urlHash: hashUrl(this.currentUrl), reply: {
      id: generateId(), author: { ...this.currentUser }, content: text, createdAt: new Date().toISOString()
    } });
    if (response.error) this.toast(`Réponse conservée sur cet appareil. ${response.error}`);
    await this.loadComments();
  }

  private async resolve(id: string) {
    const response = await this.message('RESOLVE_COMMENT', { commentId: id, urlHash: hashUrl(this.currentUrl) });
    if (response.error) this.toast(`Modification conservée sur cet appareil. ${response.error}`);
    this.closeModal();
    await this.loadComments();
  }

  private async move(comment: WebComment, x: number, y: number) {
    const anchor = AnchorEngine.createAnchorFromPoint(x - scrollX, y - scrollY);
    try {
      const response = await this.message('UPDATE_COMMENT_ANCHOR', { commentId: comment.id, urlHash: comment.urlHash, anchor });
      if (response.error) this.toast(`Position conservée sur cet appareil. ${response.error}`);
      await this.loadComments();
    } catch (error) { this.toast((error as Error).message); this.refreshPositions(); }
  }

  private renderPins() {
    const visible = this.comments.filter(c => c.status === 'open' || c.id === this.activeCommentId);
    const ids = new Set(visible.map(c => c.id));
    for (const [id, pin] of this.pins) if (!ids.has(id)) { pin.element.remove(); this.pins.delete(id); }
    visible.forEach((comment, index) => {
      let pin = this.pins.get(comment.id);
      if (!pin) {
        pin = new PinElement(comment, index + 1, { onClick: c => this.openThread(c), onDragEnd: (c, x, y) => void this.move(c, x, y) });
        this.pins.set(comment.id, pin);
        this.host.shadowRoot.append(pin.element);
      }
      pin.updateComment(comment, index + 1);
      const coords = AnchorEngine.resolveCoordinates(comment.anchor);
      if (coords) pin.setPosition(coords.x, coords.y);
    });
    this.updateToolbar();
  }

  private openThread(comment: WebComment) {
    if (this.modal.hasDraft() && this.activeCommentId !== comment.id) { this.modal.focusInput(); return; }
    this.activeCommentId = comment.id;
    this.renderPins();
    this.pins.forEach((pin, id) => pin.setActive(id === comment.id));
    const coords = AnchorEngine.resolveCoordinates(comment.anchor) || { x: scrollX + 24, y: scrollY + 24 };
    this.host.shadowRoot.append(this.modal.element);
    this.modal.renderThread(comment, coords.x, coords.y);
  }

  private closeModal() {
    const previous = this.activeCommentId;
    this.activeCommentId = null;
    this.pendingAnchor = null;
    this.pins.forEach(pin => pin.setActive(false));
    this.modal.close();
    if (previous && this.comments.find(comment => comment.id === previous)?.status === 'resolved') {
      this.pins.get(previous)?.element.remove();
      this.pins.delete(previous);
    }
  }

  private refreshPositions() {
    for (const [id, pin] of this.pins) {
      const comment = this.comments.find(c => c.id === id);
      const coords = comment && AnchorEngine.resolveCoordinates(comment.anchor);
      if (coords) { pin.setPosition(coords.x, coords.y); if (id === this.activeCommentId) this.modal.reposition(coords.x, coords.y); }
    }
  }

  private async loadComments() {
    if (this.loading) { this.refreshRequested = true; return; }
    this.loading = true;
    const url = this.currentUrl;
    try {
      const settings = await CacheManager.getSettings(url);
      const cached = (await CacheManager.getCommentsForUrl(hashUrl(url))).filter(c => CacheManager.belongsToProject(c, settings.storageRepo));
      if (url === this.currentUrl) { this.comments = cached; this.renderPins(); }
      const response = await this.message('GET_PAGE_COMMENTS', { urlHash: hashUrl(url) });
      if (url !== this.currentUrl) return;
      this.comments = response.comments;
      this.renderPins();
      const open = this.comments.find(c => c.id === this.activeCommentId);
      if (open) this.modal.updateRepliesIfActive(open);
      if (this.focusId) {
        const comment = this.comments.find(c => c.id === this.focusId);
        if (comment) {
          this.focusId = null;
          const coords = AnchorEngine.resolveCoordinates(comment.anchor);
          if (coords) window.scrollTo({ top: Math.max(0, coords.y - 150), left: Math.max(0, coords.x - 150), behavior: 'instant' });
          this.openThread(comment);
        }
      }
    } catch { /* Existing pins remain available while the extension reconnects. */ }
    finally {
      this.loading = false;
      if (this.refreshRequested) { this.refreshRequested = false; void this.loadComments(); }
    }
  }

  private async loadUser() {
    const stored = await chrome.storage.local.get('commyweb_user');
    if (stored.commyweb_user) this.currentUser = stored.commyweb_user;
  }

  private toast(message: string) {
    const previous = this.host.shadowRoot.querySelector('.commyweb-toast');
    previous?.remove();
    const banner = document.createElement('div');
    banner.className = 'commyweb-toast';
    banner.setAttribute('role', 'status');
    banner.textContent = message;
    this.host.shadowRoot.append(banner);
    setTimeout(() => banner.remove(), 5500);
  }

  private updateToolbar() {
    const count = this.comments.filter(c => c.status === 'open').length;
    this.toolbar.hidden = !this.active && count === 0;
    this.toolbar.textContent = this.active ? 'Choisissez un endroit · Échap pour annuler' : `${count} commentaire${count > 1 ? 's' : ''} · ＋ Ajouter`;
    this.toolbar.setAttribute('aria-pressed', String(this.active));
  }
}

const appWindow = window as Window & { __commywebInitialized?: boolean };
if (!appWindow.__commywebInitialized) {
  appWindow.__commywebInitialized = true;
  new CommywebContentApp();
}
