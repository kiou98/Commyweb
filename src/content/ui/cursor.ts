import { t } from '../../utils/i18n';

export class CursorManager {
  private badge: HTMLDivElement;
  private isActive: boolean = false;
  private onMouseMoveHandler: (e: MouseEvent) => void;
  private onKeyDownHandler: (e: KeyboardEvent) => void;
  private onEscapeCallback?: () => void;

  constructor(shadowRoot: ShadowRoot, onEscape?: () => void) {
    this.onEscapeCallback = onEscape;
    this.badge = document.createElement('div');
    this.badge.className = 'commyweb-cursor-badge';
    this.badge.textContent = t('clickToComment');
    this.badge.style.display = 'none';
    shadowRoot.appendChild(this.badge);

    this.onMouseMoveHandler = (e: MouseEvent) => {
      if (!this.isActive) return;
      this.badge.style.left = `${e.clientX}px`;
      this.badge.style.top = `${e.clientY}px`;
    };

    this.onKeyDownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isActive) {
        this.setActive(false);
        this.onEscapeCallback?.();
      }
    };

    window.addEventListener('mousemove', this.onMouseMoveHandler, { passive: true });
    window.addEventListener('keydown', this.onKeyDownHandler);
  }

  public setActive(active: boolean) {
    this.isActive = active;
    if (active) {
      document.body.style.cursor = 'crosshair';
      this.badge.style.display = 'block';
    } else {
      document.body.style.cursor = '';
      this.badge.style.display = 'none';
    }
  }

  public getIsActive(): boolean {
    return this.isActive;
  }

  public destroy() {
    this.setActive(false);
    window.removeEventListener('mousemove', this.onMouseMoveHandler);
    window.removeEventListener('keydown', this.onKeyDownHandler);
    this.badge.remove();
  }
}
