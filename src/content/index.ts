import { AnchorEngine } from './anchor';
import { ShadowHostManager } from './ui/shadow-host';
import { PinElement } from './ui/pin';
import { ThreadModal } from './ui/thread-modal';
import { CursorManager } from './ui/cursor';
import { WebComment, Author, AnchorData } from '../types';
import { normalizeUrl, hashUrl, generateId } from '../utils/security';
import { decodeProjectConfig } from '../utils/email-template';

class CommywebContentApp {
  private shadowHost: ShadowHostManager;
  private cursorManager: CursorManager;
  private threadModal: ThreadModal;
  private pins: Map<string, PinElement> = new Map();
  private comments: WebComment[] = [];
  private resolvedCommentIds: Set<string> = new Set();
  private activePin: PinElement | null = null;
  private currentUrl: string;
  private currentUrlHash: string;
  private currentUser: Author = {
    id: 'anonymous',
    username: 'Guest User',
    avatarUrl: ''
  };
  private isCommentModeActive: boolean = false;
  private pendingNewAnchor: AnchorData | null = null;
  private floatingIndicatorEl: HTMLElement | null = null;

  // Last right click position tracking
  private lastRightClickPoint = {
    x: 200,
    y: 200,
    pageX: 200,
    pageY: 200,
    clientX: 200,
    clientY: 200,
    target: document.body as Element
  };

  constructor() {
    this.currentUrl = normalizeUrl(window.location.href);
    this.currentUrlHash = hashUrl(this.currentUrl);

    this.shadowHost = ShadowHostManager.getInstance();

    this.cursorManager = new CursorManager(this.shadowHost.shadowRoot, () => {
      this.setCommentMode(false);
    });

    this.threadModal = new ThreadModal({
      onReply: (commentId, text) => this.handleReply(commentId, text),
      onToggleResolve: (commentId) => this.handleToggleResolve(commentId),
      onCreateNew: (text) => this.handleCreateNewComment(text),
      onClose: () => this.closeActiveModal()
    });

    this.initEventListeners();
    this.initMessageListener();
    this.checkMagicJoinLink();
    this.loadCurrentUser();

    // Restore persisted comment mode preference (default: true so pins are immediately visible)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['commyweb_comment_mode'], (res) => {
        const mode = typeof res?.commyweb_comment_mode === 'boolean' ? res.commyweb_comment_mode : true;
        this.setCommentMode(mode, false);
      });
    } else {
      this.setCommentMode(true, false);
    }

    this.loadComments();
    this.setupAutoSync();
  }

  /**
   * Automatically polls and refreshes comments from backend periodically (every 3s when visible)
   * and when the user switches back to this browser tab
   */
  private setupAutoSync() {
    // Refresh when tab gains focus or becomes visible
    window.addEventListener('focus', () => {
      this.loadComments();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.loadComments();
      }
    });

    // Listen to hash changes (e.g. if link is clicked or pasted on active tab)
    window.addEventListener('hashchange', () => {
      this.checkMagicJoinLink();
    });

    // Real-time fast background poll (every 1.5 seconds when tab is active/visible)
    setInterval(() => {
      if (!this.threadModal.isCreatingNew && !document.hidden) {
        this.loadComments();
      }
    }, 1500);

    // Fallback poll (every 10 seconds when tab is hidden)
    setInterval(() => {
      if (!this.threadModal.isCreatingNew && document.hidden) {
        this.loadComments();
      }
    }, 10000);
  }

  /**
   * Magic auto-configuration, focus link, and invite join link handler
   */
  private checkMagicJoinLink() {
    const rawHash = window.location.hash || '';
    if (!rawHash) return;

    if (rawHash.includes('commyweb_focus=')) {
      const match = rawHash.match(/commyweb_focus=([^&#\s]+)/);
      const commentId = match ? match[1] : '';
      if (commentId) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        this.setCommentMode(true);
        let retries = 0;
        const tryFocus = () => {
          retries++;
          const found = this.comments.some(c => c.id === commentId);
          if (found) {
            this.focusComment(commentId);
          } else if (retries < 15) {
            setTimeout(tryFocus, 200);
          }
        };
        setTimeout(tryFocus, 150);
        return;
      }
    }

    if (rawHash.includes('commyweb_config=')) {
      let configStr = '';
      const match = rawHash.match(/commyweb_config=([^&#\s]+)/);
      if (match) {
        configStr = match[1];
      } else {
        const params = new URLSearchParams(rawHash.substring(1));
        configStr = params.get('commyweb_config') || '';
      }

      if (configStr) {
        const config = decodeProjectConfig(configStr);
        if (config) {
          chrome.runtime.sendMessage({
            type: 'AUTO_CONFIGURE_PROJECT',
            payload: {
              repo: config.repo,
              token: config.token,
              email: config.email,
              url: window.location.href,
              authCode: config.authCode
            }
          }, () => {
            void chrome.runtime.lastError;
            // Clean hash immediately from the browser address bar
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            this.showJoinSuccessBanner(config.email || 'Collaborateur', config.repo);
            this.loadCurrentUser();
            // Immediately reload comments now that repo & token are auto-configured
            setTimeout(() => {
              this.loadComments();
              this.setCommentMode(true);
            }, 500);
          });
          return;
        }
      }
    }

    if (rawHash.includes('commyweb_join=')) {
      const params = new URLSearchParams(rawHash.substring(1));
      const code = params.get('commyweb_join');
      const email = params.get('email');

      if (code) {
        chrome.runtime.sendMessage({
          type: 'VALIDATE_JOIN_CODE',
          payload: { urlHash: this.currentUrlHash, code, email }
        }, (res) => {
          void chrome.runtime.lastError;
          if (res && res.valid) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            this.showJoinSuccessBanner(email || 'Collaborateur');
            setTimeout(() => {
              this.loadComments();
              this.setCommentMode(true);
            }, 600);
          }
        });
      }
    }
  }

  private showJoinSuccessBanner(userLabel: string, repoName?: string) {
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      background: #000000;
      color: #ffffff;
      padding: 14px 20px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 10px 25px rgba(0,0,0,0.35);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'Satoshi', sans-serif;
      animation: commyweb-fade-in 0.2s ease-out;
    `;
    const repoText = repoName ? ` au projet <strong>${repoName}</strong>` : ' au projet d\'équipe';
    banner.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>✓ Connecté${repoText} (${userLabel})</span>
    `;

    this.shadowHost.shadowRoot.appendChild(banner);
    setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transition = 'opacity 0.4s';
      setTimeout(() => banner.remove(), 400);
    }, 4500);
  }

  private initEventListeners() {
    // Save coordinates on every right-click event
    const recordRightClick = (e: MouseEvent) => {
      if (e.target === this.shadowHost.hostElement) return;
      this.lastRightClickPoint = {
        x: e.pageX || (e.clientX + window.scrollX),
        y: e.pageY || (e.clientY + window.scrollY),
        pageX: e.pageX || (e.clientX + window.scrollX),
        pageY: e.pageY || (e.clientY + window.scrollY),
        clientX: e.clientX,
        clientY: e.clientY,
        target: (e.target as Element) || document.body
      };
    };

    window.addEventListener('contextmenu', recordRightClick, true);
    window.addEventListener('pointerdown', (e) => {
      if (e.button === 2) recordRightClick(e);
    }, true);
    window.addEventListener('mousedown', (e) => {
      if (e.button === 2) recordRightClick(e);
    }, true);

    // Left click handling
    window.addEventListener('click', (e) => {
      if (e.target === this.shadowHost.hostElement) return;

      if (this.isCommentModeActive) {
        e.preventDefault();
        e.stopPropagation();
        this.handleClickToComment(e);
      } else {
        if (this.activePin) {
          const path = e.composedPath();
          if (!path.includes(this.threadModal.element)) {
            this.closeActiveModal();
          }
        }
      }
    }, true);

    const updatePositions = () => this.refreshPinPositions();
    window.addEventListener('resize', updatePositions, { passive: true });
    window.addEventListener('scroll', updatePositions, { passive: true });

    // Keyboard shortcut: Alt+C
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        this.setCommentMode(!this.isCommentModeActive);
      }
    });
  }

  private initMessageListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'CONTEXT_MENU_ADD_COMMENT') {
          this.handleRightClickAddComment();
          sendResponse({ success: true });
        } else if (message.type === 'TOGGLE_COMMENT_MODE') {
          this.setCommentMode(!this.isCommentModeActive);
          sendResponse({ isCommentModeActive: this.isCommentModeActive });
        } else if (message.type === 'GET_COMMENT_MODE') {
          sendResponse({ isCommentModeActive: this.isCommentModeActive });
        } else if (message.type === 'SYNC_COMMENTS') {
          this.loadComments();
          sendResponse({ success: true });
        } else if (message.type === 'COMMENTS_UPDATED') {
          const targetHash = message.payload?.urlHash;
          if (!targetHash || targetHash === this.currentUrlHash) {
            this.loadComments();
          }
          sendResponse({ success: true });
        } else if (message.type === 'FOCUS_COMMENT') {
          const commentId = message.payload?.commentId;
          if (commentId) this.focusComment(commentId);
        }
      });
    }
  }

  /**
   * Called when user clicks "Ajouter un commentaire" on right click
   */
  private handleRightClickAddComment() {
    const clickClientX = this.lastRightClickPoint.clientX;
    const clickClientY = this.lastRightClickPoint.clientY;
    const clickPageX = this.lastRightClickPoint.pageX;
    const clickPageY = this.lastRightClickPoint.pageY;
    const targetEl = this.lastRightClickPoint.target || document.body;

    this.pendingNewAnchor = AnchorEngine.createAnchorFromPoint(clickClientX, clickClientY, targetEl);

    // Ensure hostElement is attached to document
    if (!document.contains(this.shadowHost.hostElement)) {
      (document.body || document.documentElement).appendChild(this.shadowHost.hostElement);
    }

    if (!this.shadowHost.shadowRoot.contains(this.threadModal.element)) {
      this.shadowHost.shadowRoot.appendChild(this.threadModal.element);
    }

    this.threadModal.renderNewCommentBox(clickPageX, clickPageY);
  }

  public setCommentMode(active: boolean, persist: boolean = true) {
    this.isCommentModeActive = active;
    this.cursorManager.setActive(active);

    if (persist && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ commyweb_comment_mode: active });
    }

    if (active) {
      this.closeActiveModal();
      this.loadComments();
    }
    // Update pins and floating indicator
    this.renderAllPins();
  }

  private handleClickToComment(e: MouseEvent) {
    this.pendingNewAnchor = AnchorEngine.createAnchorFromEvent(e);
    const coords = AnchorEngine.resolveCoordinates(this.pendingNewAnchor);

    const x = coords ? coords.x : e.pageX;
    const y = coords ? coords.y : e.pageY;

    if (!this.shadowHost.shadowRoot.contains(this.threadModal.element)) {
      this.shadowHost.shadowRoot.appendChild(this.threadModal.element);
    }
    this.threadModal.renderNewCommentBox(x, y);
  }

  private handleCreateNewComment(text: string) {
    if (!this.pendingNewAnchor) return;

    const newComment: WebComment = {
      id: generateId(),
      url: this.currentUrl,
      urlHash: this.currentUrlHash,
      anchor: this.pendingNewAnchor,
      author: { ...this.currentUser },
      content: text,
      status: 'open',
      createdAt: new Date().toISOString(),
      replies: []
    };

    // 1. Immediately keep in local memory - NEVER DISAPPEARS!
    this.comments.push(newComment);
    this.isCommentModeActive = true;
    this.cursorManager.setActive(true);
    chrome.storage.local.set({ commyweb_comment_mode: true });

    // 2. Render pin immediately on screen
    this.renderPin(newComment, this.comments.length);
    this.updateFloatingIndicator();

    this.closeActiveModal();
    this.pendingNewAnchor = null;

    chrome.runtime.sendMessage({
      type: 'ADD_COMMENT',
      payload: { comment: newComment }
    }, (res) => {
      void chrome.runtime.lastError;
      if (res && res.error) {
        this.showToastBanner(`⚠️ ${res.error}`, '#991b1b');
      } else {
        this.showToastBanner('✓ Commentaire synchronisé sur GitHub !', '#000000');
        if (res && res.issueNumber) {
          newComment.issueNumber = res.issueNumber;
        }
      }
    });
  }

  private handleReply(commentId: string, text: string) {
    const comment = this.comments.find(c => c.id === commentId);
    if (!comment) return;

    const reply = {
      id: generateId(),
      author: { ...this.currentUser },
      content: text,
      createdAt: new Date().toISOString()
    };

    if (!comment.replies) comment.replies = [];
    comment.replies.push(reply);

    const pin = this.pins.get(commentId);
    if (pin) {
      const coords = AnchorEngine.resolveCoordinates(comment.anchor);
      const x = coords ? coords.x : (comment.anchor.scrollOffset?.x || 100);
      const y = coords ? coords.y : (comment.anchor.scrollOffset?.y || 100);
      this.threadModal.renderThread(comment, x, y);
    }

    chrome.runtime.sendMessage({
      type: 'ADD_REPLY',
      payload: { commentId, urlHash: this.currentUrlHash, url: this.currentUrl, reply }
    });
  }

  private handleToggleResolve(commentId: string) {
    const comment = this.comments.find(c => c.id === commentId);
    if (!comment) return;

    const isNowResolved = comment.status !== 'resolved';
    comment.status = isNowResolved ? 'resolved' : 'open';

    if (isNowResolved) {
      // Add to resolved set so delayed network responses can NEVER revive it
      this.resolvedCommentIds.add(commentId);

      // DISPARAÎT IMMÉDIATEMENT : remove pin from DOM
      const pin = this.pins.get(commentId);
      if (pin) {
        pin.element.remove();
        this.pins.delete(commentId);
      }
      this.closeActiveModal();
      this.updateFloatingIndicator();
    } else {
      this.resolvedCommentIds.delete(commentId);
      this.updatePinsDiff();
      this.updateFloatingIndicator();
    }

    chrome.runtime.sendMessage({
      type: 'RESOLVE_COMMENT',
      payload: { commentId, urlHash: this.currentUrlHash, url: this.currentUrl }
    });
  }

  private renderAllPins() {
    this.updatePinsDiff();
  }

  private updatePinsDiff() {
    if (!this.isCommentModeActive) {
      this.pins.forEach(p => p.element.remove());
      this.pins.clear();
      this.closeActiveModal();
      this.updateFloatingIndicator();
      return;
    }

    const activeComments = this.comments.filter(c => c.status !== 'resolved' && !this.resolvedCommentIds.has(c.id));
    const activeCommentIds = new Set(activeComments.map(c => c.id));

    // 1. Remove pins that are no longer active (e.g. resolved or deleted)
    this.pins.forEach((pin, id) => {
      if (!activeCommentIds.has(id)) {
        pin.element.remove();
        this.pins.delete(id);
      }
    });

    // 2. Add or update active pins smoothly without recreating untouched DOM
    activeComments.forEach((comment, index) => {
      const existingPin = this.pins.get(comment.id);
      if (existingPin) {
        existingPin.updateComment(comment);
        const coords = AnchorEngine.resolveCoordinates(comment.anchor);
        if (coords) {
          existingPin.setPosition(coords.x, coords.y);
        }
      } else {
        this.renderPin(comment, index + 1);
      }
    });

    this.updateFloatingIndicator();
  }

  private renderPin(comment: WebComment, index: number) {
    // Only display comments if Comment Mode is ACTIVE and comment is not resolved
    if (!this.isCommentModeActive || comment.status === 'resolved') {
      return;
    }

    const coords = AnchorEngine.resolveCoordinates(comment.anchor);
    const x = coords ? coords.x : (this.lastRightClickPoint.pageX || 100);
    const y = coords ? coords.y : (this.lastRightClickPoint.pageY || 100);

    const existing = this.pins.get(comment.id);
    if (existing) {
      existing.element.remove();
    }

    const pin = new PinElement(comment, index, {
      onClick: (c, p) => this.openThread(c, p),
      onDragEnd: (c, newX, newY) => this.handlePinMoved(c, newX, newY)
    });

    pin.setPosition(x, y);
    this.shadowHost.shadowRoot.appendChild(pin.element);
    this.pins.set(comment.id, pin);
  }

  /**
   * Handle dragging and dropping a pin to a new position on the page
   */
  private handlePinMoved(comment: WebComment, newPageX: number, newPageY: number) {
    const clientX = newPageX - window.scrollX;
    const clientY = newPageY - window.scrollY;

    const newAnchor = AnchorEngine.createAnchorFromPoint(clientX, clientY);
    comment.anchor = newAnchor;
    comment.updatedAt = new Date().toISOString();

    const pin = this.pins.get(comment.id);
    if (pin) {
      pin.updateComment(comment);
      pin.setPosition(newPageX, newPageY);
    }

    // Persist new position
    chrome.runtime.sendMessage({
      type: 'UPDATE_COMMENT_ANCHOR',
      payload: {
        commentId: comment.id,
        urlHash: this.currentUrlHash,
        anchor: newAnchor
      }
    });
  }

  private openThread(comment: WebComment, pin: PinElement) {
    if (this.activePin) {
      this.activePin.setActive(false);
    }
    this.activePin = pin;
    pin.setActive(true);

    const coords = AnchorEngine.resolveCoordinates(comment.anchor);
    const x = coords ? coords.x : parseInt(pin.element.style.left) || 100;
    const y = coords ? coords.y : parseInt(pin.element.style.top) || 100;

    if (!this.shadowHost.shadowRoot.contains(this.threadModal.element)) {
      this.shadowHost.shadowRoot.appendChild(this.threadModal.element);
    }
    this.threadModal.renderThread(comment, x, y);
  }

  private closeActiveModal() {
    if (this.activePin) {
      this.activePin.setActive(false);
      this.activePin = null;
    }
    this.threadModal.element.remove();
  }

  private focusComment(commentId: string) {
    if (!this.isCommentModeActive) {
      this.setCommentMode(true);
    }
    const comment = this.comments.find(c => c.id === commentId);
    let pin = this.pins.get(commentId);
    if (!pin && comment) {
      this.renderPin(comment, this.comments.indexOf(comment) + 1);
      pin = this.pins.get(commentId);
    }
    if (comment && pin) {
      const coords = AnchorEngine.resolveCoordinates(comment.anchor);
      const x = coords ? coords.x : parseInt(pin.element.style.left) || 100;
      const y = coords ? coords.y : parseInt(pin.element.style.top) || 100;

      window.scrollTo({
        top: Math.max(0, y - 150),
        left: Math.max(0, x - 150),
        behavior: 'smooth'
      });
      setTimeout(() => {
        if (pin) this.openThread(comment, pin);
      }, 300);
    }
  }

  private refreshPinPositions() {
    this.pins.forEach((pin, commentId) => {
      const comment = this.comments.find(c => c.id === commentId);
      if (comment) {
        const coords = AnchorEngine.resolveCoordinates(comment.anchor);
        if (coords) {
          pin.setPosition(coords.x, coords.y);
        }
      }
    });
  }

  private async loadComments() {
    chrome.runtime.sendMessage(
      { type: 'GET_PAGE_COMMENTS', payload: { urlHash: this.currentUrlHash, url: this.currentUrl } },
      (response) => {
        void chrome.runtime.lastError;
        if (response && response.comments) {
          const incoming: WebComment[] = response.comments;

          // Preserve locally created comments that haven't been confirmed by GitHub yet
          const incomingIds = new Set(incoming.map(c => c.id));
          const pendingLocals = this.comments.filter(c => !incomingIds.has(c.id) && !c.issueNumber);

          // Merge and strictly respect locally resolved items so network delay never revives them
          const updated = [...incoming, ...pendingLocals].map(c => {
            if (this.resolvedCommentIds.has(c.id)) {
              return { ...c, status: 'resolved' as const };
            }
            return c;
          });

          this.comments = updated;
          this.updatePinsDiff();
          this.updateFloatingIndicator();

          // Live-update replies in open thread modal if any
          if (this.threadModal.currentCommentId) {
            const openComment = this.comments.find(c => c.id === this.threadModal.currentCommentId);
            if (openComment) {
              this.threadModal.updateRepliesIfActive(openComment);
            }
          }
        }
      }
    );
  }

  private async loadCurrentUser() {
    chrome.storage.local.get(['commyweb_user'], (res) => {
      if (res.commyweb_user) {
        this.currentUser = res.commyweb_user;
      }
    });

    // Listen to changes to author name from popup
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.commyweb_user?.newValue) {
          this.currentUser = changes.commyweb_user.newValue;
        }
      });
    }
  }

  private showToastBanner(message: string, bgColor: string = '#000000') {
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      background: ${bgColor};
      color: #ffffff;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 10px 25px rgba(0,0,0,0.35);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'Satoshi', -apple-system, sans-serif;
      animation: commyweb-fade-in 0.2s ease-out;
    `;
    banner.innerHTML = `<span>${message}</span>`;
    this.shadowHost.shadowRoot.appendChild(banner);
    setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transition = 'opacity 0.4s';
      setTimeout(() => banner.remove(), 400);
    }, 4500);
  }

  private updateFloatingIndicator() {
    // ONLY display if comment mode is ON!
    // If comment mode is OFF, remove indicator completely as requested!
    if (!this.isCommentModeActive) {
      if (this.floatingIndicatorEl) {
        this.floatingIndicatorEl.remove();
        this.floatingIndicatorEl = null;
      }
      return;
    }

    const openComments = this.comments.filter(c => c.status !== 'resolved' && !this.resolvedCommentIds.has(c.id));
    if (openComments.length === 0) {
      if (this.floatingIndicatorEl) {
        this.floatingIndicatorEl.remove();
        this.floatingIndicatorEl = null;
      }
      return;
    }

    if (!this.floatingIndicatorEl) {
      this.floatingIndicatorEl = document.createElement('div');
      this.floatingIndicatorEl.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #000000;
        color: #ffffff;
        padding: 9px 16px;
        border-radius: 20px;
        font-size: 12.5px;
        font-weight: 800;
        box-shadow: 0 4px 18px rgba(0,0,0,0.35);
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-family: 'Satoshi', -apple-system, sans-serif;
        user-select: none;
        transition: transform 0.15s, background 0.15s;
      `;
      this.floatingIndicatorEl.addEventListener('mouseenter', () => {
        if (this.floatingIndicatorEl) this.floatingIndicatorEl.style.transform = 'scale(1.05)';
      });
      this.floatingIndicatorEl.addEventListener('mouseleave', () => {
        if (this.floatingIndicatorEl) this.floatingIndicatorEl.style.transform = 'scale(1)';
      });
      this.floatingIndicatorEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setCommentMode(!this.isCommentModeActive);
      });
      this.shadowHost.shadowRoot.appendChild(this.floatingIndicatorEl);
    }

    const count = openComments.length;
    this.floatingIndicatorEl.innerHTML = `
      <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e;"></span>
      <span>${count} commentaire${count > 1 ? 's' : ''} (Alt+C pour masquer)</span>
    `;
    this.floatingIndicatorEl.title = 'Cliquez ou appuyez sur Alt+C pour masquer les pastilles';
  }
}

if (typeof window !== 'undefined') {
  new CommywebContentApp();
}
