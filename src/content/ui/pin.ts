import { WebComment } from '../../types';

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

    this.element = document.createElement('div');
    this.element.className = 'commyweb-pin';
    this.element.dataset.commentId = comment.id;
    if (comment.status === 'resolved') {
      this.element.classList.add('resolved');
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
    } else {
      this.element.classList.remove('resolved');
    }
  }
}
