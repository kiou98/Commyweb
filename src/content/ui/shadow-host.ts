/**
 * Shadow Host Container
 * Isolate all Commyweb UI from the host page's CSS.
 */

export class ShadowHostManager {
  private static instance: ShadowHostManager;
  public hostElement: HTMLElement;
  public shadowRoot: ShadowRoot;

  private constructor() {
    // Check if host already exists
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
    this.hostElement.style.zIndex = '2147483640'; // Highest safe z-index

    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });
    this.injectStyles();

    document.documentElement.appendChild(this.hostElement);
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
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #1e293b;
        font-size: 13px;
        line-height: 1.4;
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      /* Figma Pin Marker */
      .commyweb-pin {
        position: absolute;
        width: 32px;
        height: 32px;
        border-radius: 50% 50% 50% 4px;
        transform: translate(-10px, -32px) rotate(-45deg);
        background: #0d99ff; /* Figma Comment Blue */
        border: 2px solid #ffffff;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        pointer-events: auto;
        transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.15s ease;
        user-select: none;
      }

      .commyweb-pin:hover {
        transform: translate(-10px, -36px) rotate(-45deg) scale(1.1);
        box-shadow: 0 8px 16px rgba(13, 153, 255, 0.35);
      }

      .commyweb-pin.active {
        background: #7b61ff; /* Figma Purple Active */
        transform: translate(-10px, -36px) rotate(-45deg) scale(1.15);
      }

      .commyweb-pin.resolved {
        background: #64748b;
        opacity: 0.65;
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
      }

      .commyweb-pin-number {
        color: #ffffff;
        font-weight: 700;
        font-size: 12px;
      }

      /* Thread Popover Modal */
      .commyweb-modal {
        position: absolute;
        width: 320px;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        z-index: 2147483647;
        animation: commyweb-fade-in 0.18s ease-out;
        overflow: hidden;
      }

      @keyframes commyweb-fade-in {
        from {
          opacity: 0;
          transform: translateY(6px) scale(0.98);
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
        padding: 10px 14px;
        border-bottom: 1px solid #f1f5f9;
        background: #f8fafc;
      }

      .commyweb-header-user {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .commyweb-header-avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
      }

      .commyweb-header-name {
        font-weight: 600;
        color: #0f172a;
        font-size: 13px;
      }

      .commyweb-header-time {
        font-size: 11px;
        color: #64748b;
      }

      .commyweb-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .commyweb-btn-icon {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        color: #64748b;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.12s, color 0.12s;
      }

      .commyweb-btn-icon:hover {
        background: #e2e8f0;
        color: #0f172a;
      }

      .commyweb-btn-resolve {
        color: #059669;
        font-weight: 600;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid #d1fae5;
        background: #ecfdf5;
      }

      .commyweb-btn-resolve:hover {
        background: #d1fae5;
      }

      .commyweb-modal-body {
        padding: 12px 14px;
        max-height: 280px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .commyweb-comment-text {
        font-size: 13px;
        color: #334155;
        line-height: 1.5;
        word-break: break-word;
        white-space: pre-wrap;
      }

      .commyweb-replies {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 8px;
        border-top: 1px dashed #e2e8f0;
      }

      .commyweb-reply-item {
        display: flex;
        gap: 8px;
      }

      .commyweb-reply-avatar {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-top: 2px;
      }

      .commyweb-reply-content {
        flex: 1;
        background: #f8fafc;
        padding: 8px 10px;
        border-radius: 8px;
      }

      .commyweb-reply-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 4px;
      }

      .commyweb-reply-author {
        font-weight: 600;
        font-size: 11px;
        color: #1e293b;
      }

      .commyweb-reply-time {
        font-size: 10px;
        color: #94a3b8;
      }

      /* Modal Footer Input */
      .commyweb-modal-footer {
        padding: 10px 14px;
        border-top: 1px solid #f1f5f9;
        display: flex;
        gap: 8px;
      }

      .commyweb-input {
        flex: 1;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 13px;
        outline: none;
        resize: none;
        min-height: 36px;
        max-height: 90px;
        font-family: inherit;
        transition: border-color 0.15s, box-shadow 0.15s;
      }

      .commyweb-input:focus {
        border-color: #0d99ff;
        box-shadow: 0 0 0 2px rgba(13, 153, 255, 0.15);
      }

      .commyweb-btn-send {
        background: #0d99ff;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 0 12px;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .commyweb-btn-send:hover {
        background: #007be5;
      }

      /* Active Cursor Tooltip overlay */
      .commyweb-cursor-badge {
        position: fixed;
        pointer-events: none;
        background: #0f172a;
        color: #ffffff;
        font-size: 11px;
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 6px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        transform: translate(16px, 16px);
        z-index: 2147483647;
        white-space: nowrap;
      }
    `;
    this.shadowRoot.appendChild(style);
  }
}
