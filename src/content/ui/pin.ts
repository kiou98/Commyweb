import { WebComment } from '../../types';
import { getUserColor } from '../../utils/security';

export class PinElement {
  public element: HTMLDivElement;
  public comment: WebComment;
  public index: number;
  private onClickCallback: (comment: WebComment, pin: PinElement) => void;

  constructor(
    comment: WebComment,
    index: number,
    onClick: (comment: WebComment, pin: PinElement) => void
  ) {
    this.comment = comment;
    this.index = index;
    this.onClickCallback = onClick;

    const authorId = comment.author.name || comment.author.username || comment.author.id || 'User';
    const userColor = getUserColor(authorId);

    this.element = document.createElement('div');
    this.element.className = 'commyweb-pin';
    this.element.style.position = 'absolute';
    this.element.style.width = '32px';
    this.element.style.height = '32px';
    this.element.style.background = userColor;
    this.element.style.borderRadius = '50% 50% 50% 4px';
    this.element.style.transform = 'translate(-10px, -32px) rotate(-45deg)';
    this.element.style.border = '2px solid #ffffff';
    this.element.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.4)';
    this.element.style.cursor = 'pointer';
    this.element.style.pointerEvents = 'auto';
    this.element.style.zIndex = '2147483646';
    this.element.dataset.commentId = comment.id;
    if (comment.status === 'resolved') {
      this.element.classList.add('resolved');
      this.element.style.background = '#71717a';
    }

    const inner = document.createElement('div');
    inner.className = 'commyweb-pin-inner';

    if (comment.author.avatarUrl) {
      const img = document.createElement('img');
      img.className = 'commyweb-pin-avatar';
      img.src = comment.author.avatarUrl;
      img.alt = comment.author.username;
      inner.appendChild(img);
    } else {
      const numSpan = document.createElement('span');
      numSpan.className = 'commyweb-pin-number';
      numSpan.textContent = String(index);
      inner.appendChild(numSpan);
    }

    this.element.appendChild(inner);

    this.element.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onClickCallback(this.comment, this);
    });
  }

  public setPosition(x: number, y: number) {
    this.element.style.left = `${Math.round(x)}px`;
    this.element.style.top = `${Math.round(y)}px`;
  }

  public setActive(active: boolean) {
    if (active) {
      this.element.classList.add('active');
    } else {
      this.element.classList.remove('active');
    }
  }

  public updateComment(comment: WebComment) {
    this.comment = comment;
    if (comment.status === 'resolved') {
      this.element.classList.add('resolved');
      this.element.style.background = '#71717a';
    } else {
      this.element.classList.remove('resolved');
      const authorId = comment.author.name || comment.author.username || comment.author.id || 'User';
      this.element.style.background = getUserColor(authorId);
    }
  }
}
