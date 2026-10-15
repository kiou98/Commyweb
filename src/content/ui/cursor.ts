/**
 * Custom cursor manager for Commyweb Comment Mode
 * Replaces system cursor with the transparent Commyweb logo pin
 * Removes all annoying trailing text badges
 */

const CURSOR_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACN0lEQVR4nO2WP0jVURTHP4qp/YEw/9A/xCEXBwMHDSGIIMKhWkpoEKFBGhNHwb1R0UVwEXSVoskhE5trimyLEsTBSeypz9eLC+fA4XLv7x/Pt+QXLvf+/pxzvvfcc+458L+jIef/HcBD4AkwBNwC/gI7wGfgHbAJHNSaaC+wAlQzjGPgLdBWC8MtwIJRXhEDZVnb92X5Zsk4TxVGF/BLFJXEgL/bSoIXlMxkEePXjUF/V+UAITXoEzqQ+Xke463AvnGrv7O0GPBlDmV2AZwJawk7d/Mn4AFwTWLkInAbeG1kfO+4zaxmMd5vzjy086cpqXtFCPokdO3iKhEfA65X48MZPXgB+Cl6Kp6ON0mCNyLuc/MM+XAvcoxfk4QmTJ7bNCvJWedFS2RE8cHzgBJxF1FdsOe5SwPx0VkabTTrrgRidSFwWqOKWZjAb5ldebXoqReBDY+AfhulTngcyF0tu5cL6HMyl2S2I1Hg2KtoSmY2p/GXkUL1PU1wNnAZ6Xoko/FO05zodVySeSxNuD1yherzuBc3Pu6YUq6e1NpSksqZiqkUEt+AF0A3cFXq/CCwGOmU9EJzV30mNADrBRuScsT4l5jnGgPvnMC2fHMpeWJSs1nWR/L+VIY+Nxmdf6S72gXuB+6XxHp+aALH7ibU91UDZ63/bBVJ4bue4nngR8SYNqP+UbnnVykBG8WyKJmWIEMUDQBzplWvBjrg98CzrNEegjvDpZTerUnStVd6yD7gppz3OciLf1Q9PYegjmqRAAAAAElFTkSuQmCC';

const CURSOR_STYLE_ID = 'commyweb-custom-cursor-style';

export class CursorManager {
  private isActive: boolean = false;
  private onKeyDownHandler: (e: KeyboardEvent) => void;
  private onEscapeCallback?: () => void;
  private styleEl: HTMLStyleElement | null = null;

  constructor(_shadowRoot?: ShadowRoot, onEscape?: () => void) {
    this.onEscapeCallback = onEscape;

    this.onKeyDownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isActive) {
        this.setActive(false);
        this.onEscapeCallback?.();
      }
    };

    window.addEventListener('keydown', this.onKeyDownHandler);
  }

  public setActive(active: boolean) {
    this.isActive = active;

    if (active) {
      if (!this.styleEl) {
        this.styleEl = document.createElement('style');
        this.styleEl.id = CURSOR_STYLE_ID;
        this.styleEl.textContent = `
          * {
            cursor: url("data:image/png;base64,${CURSOR_BASE64}") 14 28, crosshair !important;
          }
        `;
        (document.head || document.documentElement).appendChild(this.styleEl);
      }
    } else {
      if (this.styleEl) {
        this.styleEl.remove();
        this.styleEl = null;
      }
    }
  }

  public getIsActive(): boolean {
    return this.isActive;
  }

  public destroy() {
    this.setActive(false);
    window.removeEventListener('keydown', this.onKeyDownHandler);
  }
}
