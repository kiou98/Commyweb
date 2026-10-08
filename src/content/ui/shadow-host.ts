/**
 * Shadow Host Container
 * Isolate all Commyweb UI from the host page's CSS.
 * Art Direction: Pure Black & White (Noir & Blanc uniquement)
 * Typography: Satoshi font everywhere
 */

export class ShadowHostManager {
  private static instance: ShadowHostManager;
  public hostElement: HTMLElement;
  public shadowRoot: ShadowRoot;

  private constructor() {
    let existing = document.getElementById('commyweb-extension-host');
    if (existing) {
      existing.remove();
    }

    this.hostElement = document.createElement('div');
    this.hostElement.id = 'commyweb-extension-host';
    this.hostElement.style.position = 'absolute';
    this.hostElement.style.top = '0';
    this.hostElement.style.left = '0';
    this.hostElement.style.width = '100%';
    this.hostElement.style.height = '100%';
    this.hostElement.style.pointerEvents = 'none';
    this.hostElement.style.zIndex = '2147483640';

    this.hostElement.style.minHeight = '100vh';
    this.hostElement.style.minWidth = '100vw';

    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });
    this.injectStyles();

    (document.body || document.documentElement).appendChild(this.hostElement);
  }

  public static getInstance(): ShadowHostManager {
    if (!ShadowHostManager.instance || !document.contains(ShadowHostManager.instance.hostElement)) {
      ShadowHostManager.instance = new ShadowHostManager();
    }
    return ShadowHostManager.instance;
  }

  private injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://api.fontshare.com/v2/css?f[]=satoshi@900,700,500,400&display=swap');

      :host {
        all: initial;
        font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #000000;
        font-size: 13px;
        line-height: 1.4;
        -webkit-font-smoothing: antialiased;
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      /* Minimalist Black & White Pin Marker */
      .commyweb-pin {
        position: absolute;
        width: 32px;
        height: 32px;
        border-radius: 50% 50% 50% 4px;
        transform: translate(-6px, -26px) rotate(-45deg);
        background: #000000;
        border: 2px solid #ffffff;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        pointer-events: auto;
        transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s ease;
        user-select: none;
      }

      .commyweb-pin:hover {
        transform: translate(-6px, -29px) rotate(-45deg) scale(1.12);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
      }

      .commyweb-pin.active {
        box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #000000, 0 10px 25px rgba(0, 0, 0, 0.4);
        transform: translate(-6px, -29px) rotate(-45deg) scale(1.15);
      }

      .commyweb-pin.resolved {
        background: #71717a;
        opacity: 0.7;
        border-color: #f4f4f5;
      }

      .commyweb-pin-inner {
        transform: rotate(45deg);
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }

      .commyweb-pin-avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        object-fit: cover;
        border: 1px solid #ffffff;
      }

      .commyweb-pin-logo {
        width: 18px;
        height: 18px;
        filter: invert(1); /* makes the black C white inside black pin */
      }

      .commyweb-pin-number {
        color: #ffffff;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: -0.3px;
      }

      /* Pure B&W Modal Popover */
      .commyweb-modal {
        position: absolute;
        width: 320px;
        background: #ffffff;
        border: 1px solid #000000;
        border-radius: 14px;
        box-shadow: 0 20px 35px -5px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        z-index: 2147483647;
        animation: commyweb-fade-in 0.16s ease-out;
        overflow: hidden;
      }

      @keyframes commyweb-fade-in {
        from {
          opacity: 0;
          transform: translateY(6px) scale(0.97);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .commyweb-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid #e4e4e7;
        background: #fafafa;
      }

      .commyweb-header-user {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .commyweb-header-avatar {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 1px solid #e4e4e7;
      }

      .commyweb-header-name {
        font-weight: 700;
        color: #000000;
        font-size: 13px;
        letter-spacing: -0.2px;
      }

      .commyweb-header-time {
        font-size: 11px;
        color: #71717a;
      }

      .commyweb-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .commyweb-btn-icon {
        background: none;
        border: 1px solid transparent;
        cursor: pointer;
        padding: 5px;
        border-radius: 8px;
        color: #52525b;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.12s;
      }

      .commyweb-btn-icon:hover {
        background: #f4f4f5;
        border-color: #e4e4e7;
        color: #000000;
      }

      .commyweb-btn-resolve {
        color: #000000;
        font-weight: 700;
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 8px;
        border: 1px solid #000000;
        background: #ffffff;
        cursor: pointer;
        transition: all 0.12s;
      }

      .commyweb-btn-resolve:hover {
        background: #000000;
        color: #ffffff;
      }

      .commyweb-modal-body {
        padding: 14px;
        max-height: 260px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .commyweb-comment-text {
        font-size: 13px;
        color: #09090b;
        line-height: 1.5;
        word-break: break-word;
        white-space: pre-wrap;
      }

      .commyweb-replies {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 10px;
        border-top: 1px solid #f4f4f5;
      }

      .commyweb-reply-item {
        display: flex;
        gap: 8px;
      }

      .commyweb-reply-avatar {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        margin-top: 2px;
        border: 1px solid #e4e4e7;
      }

      .commyweb-reply-content {
        flex: 1;
        background: #f4f4f5;
        padding: 8px 10px;
        border-radius: 10px;
      }

      .commyweb-reply-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 4px;
      }

      .commyweb-reply-author {
        font-weight: 700;
        font-size: 11px;
        color: #000000;
      }

      .commyweb-reply-time {
        font-size: 10px;
        color: #71717a;
      }

      /* Modal Footer */
      .commyweb-modal-footer {
        padding: 10px 14px;
        border-top: 1px solid #f4f4f5;
        display: flex;
        gap: 8px;
        background: #ffffff;
      }

      .commyweb-input {
        flex: 1;
        border: 1px solid #d4d4d8;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 13px;
        outline: none;
        resize: none;
        min-height: 36px;
        max-height: 90px;
        color: #000000;
        transition: border-color 0.15s, box-shadow 0.15s;
      }

      .commyweb-input:focus {
        border-color: #000000;
        box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);
      }

      .commyweb-btn-send {
        background: #000000;
        color: #ffffff;
        border: 1px solid #000000;
        border-radius: 8px;
        padding: 0 14px;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .commyweb-btn-send:hover {
        background: #27272a;
        border-color: #27272a;
      }

      /* Monochrome Cursor Badge */
      .commyweb-cursor-badge {
        position: fixed;
        pointer-events: none;
        background: #000000;
        color: #ffffff;
        font-size: 11px;
        font-weight: 600;
        padding: 5px 10px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
        transform: translate(16px, 16px);
        z-index: 2147483647;
        white-space: nowrap;
        letter-spacing: -0.2px;
      }
    `;
    this.shadowRoot.appendChild(style);
  }
}
