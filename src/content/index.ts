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
  private filterStatus: 'all' | 'open' | 'resolved' = 'all';

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
    this.loadComments();
    this.loadCurrentUser();
  }

  private initEventListeners() {
    // Intercept clicks on page for commenting
    window.addEventListener('click', (e) => {
      // Don't intercept if clicking inside our shadow root
      if (e.target === this.shadowHost.hostElement) return;

      if (this.isCommentModeActive) {
        e.preventDefault();
        e.stopPropagation();
        this.handleClickToComment(e);
      } else {
        // Outside click closes open modal
        if (this.activePin) {
          const path = e.composedPath();
          if (!path.includes(this.threadModal.element)) {
            this.closeActiveModal();
          }
        }
      }
    }, true);

    // Reposition pins on window resize and scroll
    const updatePositions = () => this.refreshPinPositions();
    window.addEventListener('resize', updatePositions, { passive: true });
    window.addEventListener('scroll', updatePositions, { passive: true });

    // Keyboard shortcut: Alt+C to toggle comment mode
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
        if (message.type === 'TOGGLE_COMMENT_MODE') {
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

  public setCommentMode(active: boolean) {
    this.isCommentModeActive = active;
    this.cursorManager.setActive(active);

    if (active) {
      this.closeActiveModal();
    }
  }

  private handleClickToComment(e: MouseEvent) {
    this.pendingNewAnchor = AnchorEngine.createAnchorFromEvent(e);
    const coords = AnchorEngine.resolveCoordinates(this.pendingNewAnchor);

    if (coords) {
      if (!this.shadowHost.shadowRoot.contains(this.threadModal.element)) {
        this.shadowHost.shadowRoot.appendChild(this.threadModal.element);
      }
      this.threadModal.renderNewCommentBox(coords.x, coords.y);
      this.setCommentMode(false);
    }
  }

  private handleCreateNewComment(text: string) {
    if (!this.pendingNewAnchor) return;

    const newComment: WebComment = {
      id: generateId(),
      url: this.currentUrl,
      urlHash: this.currentUrlHash,
      anchor: this.pendingNewAnchor,
      author: this.currentUser,
      content: text,
      status: 'open',
      createdAt: new Date().toISOString(),
      replies: []
    };

    this.comments.push(newComment);
    this.renderPin(newComment, this.comments.length);
    this.closeActiveModal();
    this.pendingNewAnchor = null;

    // Send to background service worker for storage/sync
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
      author: this.currentUser,
      content: text,
      createdAt: new Date().toISOString()
    };

    if (!comment.replies) comment.replies = [];
    comment.replies.push(reply);

    // Re-render modal thread
    const pin = this.pins.get(commentId);
    if (pin) {
      const coords = AnchorEngine.resolveCoordinates(comment.anchor);
      if (coords) {
        this.threadModal.renderThread(comment, coords.x, coords.y);
      }
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
    const pin = this.pins.get(commentId);
    if (pin) {
      pin.updateComment(comment);
      const coords = AnchorEngine.resolveCoordinates(comment.anchor);
      if (coords) {
        this.threadModal.renderThread(comment, coords.x, coords.y);
      }
    }

    chrome.runtime.sendMessage({
      type: 'RESOLVE_COMMENT',
      payload: { commentId, urlHash: this.currentUrlHash }
    });
  }

  private renderPin(comment: WebComment, index: number) {
    const coords = AnchorEngine.resolveCoordinates(comment.anchor);
    if (!coords) return;

    // Remove existing pin for this comment if any
    const existing = this.pins.get(comment.id);
    if (existing) {
      existing.element.remove();
    }

    const pin = new PinElement(comment, index, (c, p) => {
      this.openThread(c, p);
    });

    pin.setPosition(coords.x, coords.y);
    this.shadowHost.shadowRoot.appendChild(pin.element);
    this.pins.set(comment.id, pin);
  }

  private openThread(comment: WebComment, pin: PinElement) {
    if (this.activePin) {
      this.activePin.setActive(false);
    }
    this.activePin = pin;
    pin.setActive(true);

    const coords = AnchorEngine.resolveCoordinates(comment.anchor);
    if (coords) {
      if (!this.shadowHost.shadowRoot.contains(this.threadModal.element)) {
        this.shadowHost.shadowRoot.appendChild(this.threadModal.element);
      }
      this.threadModal.renderThread(comment, coords.x, coords.y);
    }
  }

  private closeActiveModal() {
    if (this.activePin) {
      this.activePin.setActive(false);
      this.activePin = null;
    }
    this.threadModal.element.remove();
  }

  private focusComment(commentId: string) {
    const comment = this.comments.find(c => c.id === commentId);
    const pin = this.pins.get(commentId);
    if (comment && pin) {
      const coords = AnchorEngine.resolveCoordinates(comment.anchor);
      if (coords) {
        window.scrollTo({
          top: Math.max(0, coords.y - 150),
          left: Math.max(0, coords.x - 150),
          behavior: 'smooth'
        });
        setTimeout(() => this.openThread(comment, pin), 300);
      }
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
          // Clear current pins
          this.pins.forEach(p => p.element.remove());
          this.pins.clear();

          // Render all
          this.comments.forEach((c, i) => {
            if (this.filterStatus === 'all' || c.status === this.filterStatus) {
              this.renderPin(c, i + 1);
            }
          });
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
  }
}

// Auto bootstrap when script executes
if (typeof window !== 'undefined') {
  new CommywebContentApp();
}
