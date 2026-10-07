import { WebComment, CommentReply } from '../../types';
import { formatRelativeTime, t } from '../../utils/i18n';
import { escapeHtml } from '../../utils/security';

export interface ThreadModalCallbacks {
  onReply: (commentId: string, text: string) => void;
  onToggleResolve: (commentId: string) => void;
  onCreateNew: (text: string) => void;
  onClose: () => void;
}

export class ThreadModal {
  public element: HTMLDivElement;
  private callbacks: ThreadModalCallbacks;

  constructor(callbacks: ThreadModalCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'commyweb-modal';
    this.element.addEventListener('click', (e) => e.stopPropagation());
  }

  /**
   * Render existing comment thread
   */
  public renderThread(comment: WebComment, pinX: number, pinY: number) {
    const isResolved = comment.status === 'resolved';

    this.element.innerHTML = `
      <div class="commyweb-modal-header">
        <div class="commyweb-header-user">
          <img class="commyweb-header-avatar" src="${escapeHtml(comment.author.avatarUrl || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')}" alt="" />
          <div>
            <div class="commyweb-header-name">${escapeHtml(comment.author.name || comment.author.username)}</div>
            <div class="commyweb-header-time">${formatRelativeTime(comment.createdAt)}</div>
          </div>
        </div>
        <div class="commyweb-header-actions">
          <button class="commyweb-btn-resolve" id="btn-toggle-resolve" title="${isResolved ? t('reopen') : t('resolve')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>${isResolved ? t('reopen') : t('resolve')}</span>
          </button>
          <button class="commyweb-btn-icon" id="btn-close-modal" title="${t('cancel')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="commyweb-modal-body">
        <div class="commyweb-comment-text">${escapeHtml(comment.content)}</div>
        <div class="commyweb-replies" id="replies-container">
          ${(comment.replies || []).map(r => this.renderReplyHtml(r)).join('')}
        </div>
      </div>
      <div class="commyweb-modal-footer">
        <textarea class="commyweb-input" id="reply-input" placeholder="${t('reply')}" rows="1"></textarea>
        <button class="commyweb-btn-send" id="btn-send-reply">${t('send')}</button>
      </div>
    `;

    this.positionNear(pinX, pinY);

    // Event handlers
    const resolveBtn = this.element.querySelector('#btn-toggle-resolve');
    resolveBtn?.addEventListener('click', () => {
      this.callbacks.onToggleResolve(comment.id);
    });

    const closeBtn = this.element.querySelector('#btn-close-modal');
    closeBtn?.addEventListener('click', () => {
      this.callbacks.onClose();
    });

    const replyInput = this.element.querySelector('#reply-input') as HTMLTextAreaElement;
    const sendBtn = this.element.querySelector('#btn-send-reply');

    const handleSend = () => {
      const text = replyInput?.value.trim();
      if (text) {
        this.callbacks.onReply(comment.id, text);
        replyInput.value = '';
      }
    };

    sendBtn?.addEventListener('click', handleSend);
    replyInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    setTimeout(() => replyInput?.focus(), 50);
  }

  /**
   * Render creation box for a new comment
   */
  public renderNewCommentBox(x: number, y: number) {
    this.element.innerHTML = `
      <div class="commyweb-modal-header">
        <div class="commyweb-header-user">
          <div class="commyweb-header-name">${t('addComment')}</div>
        </div>
        <button class="commyweb-btn-icon" id="btn-close-modal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="commyweb-modal-body">
        <textarea class="commyweb-input" id="new-comment-input" placeholder="${t('addComment')}" rows="3" style="min-height: 60px;"></textarea>
      </div>
      <div class="commyweb-modal-footer" style="justify-content: flex-end;">
        <button class="commyweb-btn-icon" id="btn-cancel-new" style="padding: 6px 12px; font-size: 12px;">${t('cancel')}</button>
        <button class="commyweb-btn-send" id="btn-submit-new">${t('send')}</button>
      </div>
    `;

    this.positionNear(x, y);

    const closeBtn = this.element.querySelector('#btn-close-modal');
    const cancelBtn = this.element.querySelector('#btn-cancel-new');
    const submitBtn = this.element.querySelector('#btn-submit-new');
    const input = this.element.querySelector('#new-comment-input') as HTMLTextAreaElement;

    closeBtn?.addEventListener('click', () => this.callbacks.onClose());
    cancelBtn?.addEventListener('click', () => this.callbacks.onClose());

    const submitAction = () => {
      const text = input?.value.trim();
      if (text) {
        this.callbacks.onCreateNew(text);
      }
    };

    submitBtn?.addEventListener('click', submitAction);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitAction();
      }
    });

    setTimeout(() => input?.focus(), 50);
  }

  private renderReplyHtml(reply: CommentReply): string {
    return `
      <div class="commyweb-reply-item">
        <img class="commyweb-reply-avatar" src="${escapeHtml(reply.author.avatarUrl || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')}" alt="" />
        <div class="commyweb-reply-content">
          <div class="commyweb-reply-header">
            <span class="commyweb-reply-author">${escapeHtml(reply.author.name || reply.author.username)}</span>
            <span class="commyweb-reply-time">${formatRelativeTime(reply.createdAt)}</span>
          </div>
          <div class="commyweb-comment-text">${escapeHtml(reply.content)}</div>
        </div>
      </div>
    `;
  }

  private positionNear(x: number, y: number) {
    const modalWidth = 320;
    const padding = 16;

    let targetX = x + 12;
    let targetY = y + 12;

    // Check bounds
    if (targetX + modalWidth > window.scrollX + window.innerWidth - padding) {
      targetX = x - modalWidth - 12;
    }
    if (targetX < window.scrollX + padding) {
      targetX = window.scrollX + padding;
    }

    this.element.style.left = `${Math.round(targetX)}px`;
    this.element.style.top = `${Math.round(targetY)}px`;
  }
}
