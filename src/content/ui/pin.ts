import { WebComment } from '../../types';
import { getUserColor } from '../../utils/security';

export interface PinCallbacks {
  onClick: (comment: WebComment, pin: PinElement) => void;
  onDragEnd?: (comment: WebComment, newX: number, newY: number) => void;
}

export class PinElement {
  public element: HTMLDivElement;
  public comment: WebComment;
  public index: number;
  private callbacks: PinCallbacks;
  private isDragging: boolean = false;
  private hasMoved: boolean = false;
  private startMouseX: number = 0;
  private startMouseY: number = 0;
  private startPinX: number = 0;
  private startPinY: number = 0;

  constructor(
    comment: WebComment,
    index: number,
    callbacks: PinCallbacks | ((comment: WebComment, pin: PinElement) => void)
  ) {
    this.comment = comment;
    this.index = index;
    if (typeof callbacks === 'function') {
      this.callbacks = { onClick: callbacks };
    } else {
      this.callbacks = callbacks;
    }

    const authorId = comment.author.name || comment.author.username || comment.author.id || 'User';
    const userColor = getUserColor(authorId);

    this.element = document.createElement('div');
    this.element.className = 'commyweb-pin';
    this.element.style.position = 'absolute';
    this.element.style.width = '32px';
    this.element.style.height = '32px';
    this.element.style.background = userColor;
    this.element.style.borderRadius = '50% 50% 50% 4px';
    this.element.style.transform = 'translate(-6px, -26px) rotate(-45deg)';
    this.element.style.border = '2px solid #ffffff';
    this.element.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.4)';
    this.element.style.cursor = 'grab';
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

    this.setupDragEvents();
  }

  private setupDragEvents() {
    this.element.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // Only left button
      e.stopPropagation();
      e.preventDefault();

      this.isDragging = true;
      this.hasMoved = false;
      this.startMouseX = e.pageX;
      this.startMouseY = e.pageY;
      this.startPinX = parseInt(this.element.style.left) || e.pageX;
      this.startPinY = parseInt(this.element.style.top) || e.pageY;

      this.element.style.cursor = 'grabbing';
      this.element.style.zIndex = '2147483647';
      this.element.setPointerCapture(e.pointerId);

      const onPointerMove = (moveEv: PointerEvent) => {
        if (!this.isDragging) return;
        const dx = moveEv.pageX - this.startMouseX;
        const dy = moveEv.pageY - this.startMouseY;

        if (Math.hypot(dx, dy) > 4) {
          this.hasMoved = true;
        }

        const newX = this.startPinX + dx;
        const newY = this.startPinY + dy;
        this.setPosition(newX, newY);
      };

      const onPointerUp = (upEv: PointerEvent) => {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.element.style.cursor = 'grab';
        this.element.style.zIndex = '2147483646';

        try {
          this.element.releasePointerCapture(upEv.pointerId);
        } catch {}

        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);

        if (this.hasMoved) {
          const finalX = parseInt(this.element.style.left) || upEv.pageX;
          const finalY = parseInt(this.element.style.top) || upEv.pageY;
          if (this.callbacks.onDragEnd) {
            this.callbacks.onDragEnd(this.comment, finalX, finalY);
          }
        } else {
          this.callbacks.onClick(this.comment, this);
        }
      };

      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
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
