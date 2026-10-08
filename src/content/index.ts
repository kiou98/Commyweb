import { AnchorEngine } from './anchor';
import { ShadowHostManager } from './ui/shadow-host';
import { PinElement } from './ui/pin';
import { ThreadModal } from './ui/thread-modal';
import { CursorManager } from './ui/cursor';
import { WebComment, Author, AnchorData } from '../types';
import { normalizeUrl, hashUrl, generateId } from '../utils/security';

class CommywebContentApp {
  private shadowHost: ShadowHostManager;
  private cursorManager: CursorManager;
  private threadModal: ThreadModal;
  private pins: Map<string, PinElement> = new Map();
  private comments: WebComment[] = [];
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
    this.loadComments();
  }

  /**
   * Magic Link join handler
   */
  private checkMagicJoinLink() {
    const hash = window.location.hash;
    if (hash && hash.includes('commyweb_join=')) {
      const params = new URLSearchParams(hash.substring(1));
      const code = params.get('commyweb_join');
      const email = params.get('email');

      if (code) {
        chrome.runtime.sendMessage({
          type: 'VALIDATE_JOIN_CODE',
          payload: { urlHash: this.currentUrlHash, code, email }
        }, (res) => {
          if (res && res.valid) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            this.showJoinSuccessBanner(email || 'Collaborateur');
            setTimeout(() => this.setCommentMode(true), 800);
          }
        });
      }
    }
  }

  private showJoinSuccessBanner(userLabel: string) {
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
    banner.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>✓ Accès autorisé ! Bienvenue sur le projet (${userLabel})</span>
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

  public setCommentMode(active: boolean) {
    this.isCommentModeActive = active;
    this.cursorManager.setActive(active);

    if (active) {
      this.closeActiveModal();
    }
    // Only display comment pins when comment mode is active
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

    this.comments.push(newComment);
    if (!this.isCommentModeActive) {
      this.setCommentMode(true);
    } else {
      this.renderPin(newComment, this.comments.length);
    }
    this.closeActiveModal();
    this.pendingNewAnchor = null;

    chrome.runtime.sendMessage({
      type: 'ADD_COMMENT',
      payload: { comment: newComment }
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
      payload: { commentId, urlHash: this.currentUrlHash, reply }
    });
  }

  private handleToggleResolve(commentId: string) {
    const comment = this.comments.find(c => c.id === commentId);
    if (!comment) return;

    comment.status = comment.status === 'resolved' ? 'open' : 'resolved';
    
    // When resolved, hide pin from the page
    if (comment.status === 'resolved') {
      const pin = this.pins.get(commentId);
      if (pin) {
        pin.element.remove();
        this.pins.delete(commentId);
      }
      this.closeActiveModal();
    } else {
      // Reopened
      this.renderPin(comment, this.comments.indexOf(comment) + 1);
      const coords = AnchorEngine.resolveCoordinates(comment.anchor);
      const x = coords ? coords.x : 100;
      const y = coords ? coords.y : 100;
      this.threadModal.renderThread(comment, x, y);
    }

    chrome.runtime.sendMessage({
      type: 'RESOLVE_COMMENT',
      payload: { commentId, urlHash: this.currentUrlHash }
    });
  }

  private renderAllPins() {
    this.pins.forEach(p => p.element.remove());
    this.pins.clear();

    // If comment mode is NOT active, do not display any comments on the site
    if (!this.isCommentModeActive) {
      this.closeActiveModal();
      return;
    }

    // When comment mode is active, display all open comments
    this.comments.forEach((c, i) => {
      if (c.status !== 'resolved') {
        this.renderPin(c, i + 1);
      }
    });
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
      { type: 'GET_PAGE_COMMENTS', payload: { urlHash: this.currentUrlHash } },
      (response) => {
        if (response && response.comments) {
          this.comments = response.comments;
          this.renderAllPins();
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
}

if (typeof window !== 'undefined') {
  new CommywebContentApp();
}
