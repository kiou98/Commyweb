import { AnchorData } from '../types';

/**
 * Spatial DOM Anchoring Engine
 * Anchors comments to specific DOM elements with relative percentage offsets
 * to remain accurately positioned during resize, responsive layout changes, and scrolling.
 */

export class AnchorEngine {
  /**
   * Generates a stable CSS selector for an element
   */
  static getCssSelector(el: Element): string {
    if (!(el instanceof Element)) return 'body';

    // Check for unique ID
    if (el.id && !/^[0-9]/.test(el.id) && !el.id.includes(':')) {
      const escapedId = CSS.escape ? CSS.escape(el.id) : el.id;
      if (document.querySelectorAll(`#${escapedId}`).length === 1) {
        return `#${escapedId}`;
      }
    }

    const path: string[] = [];
    let current: Element | null = el;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let selector = current.nodeName.toLowerCase();
      
      // If element has ID, we can terminate path
      if (current.id && document.querySelectorAll(`#${current.id}`).length === 1) {
        selector = `#${CSS.escape ? CSS.escape(current.id) : current.id}`;
        path.unshift(selector);
        break;
      }

      // Add nth-of-type or nth-child
      let sibling = current;
      let nth = 1;
      while ((sibling = sibling.previousElementSibling as Element)) {
        if (sibling.nodeName.toLowerCase() === selector) {
          nth++;
        }
      }

      if (nth > 1) {
        selector += `:nth-of-type(${nth})`;
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  /**
   * Generates XPath for fallback
   */
  static getXPath(el: Element): string {
    if (el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el === document.body) return '/html/body';

    let path = '';
    let current: Element | null = el;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let count = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === current.nodeName) {
          count++;
        }
        sibling = sibling.previousElementSibling;
      }

      const tagName = current.nodeName.toLowerCase();
      path = `/${tagName}[${count}]${path}`;
      current = current.parentElement;
    }

    return path;
  }

  /**
   * Creates anchor data from a mouse click event
   */
  static createAnchorFromEvent(event: MouseEvent): AnchorData {
    return this.createAnchorFromPoint(event.clientX, event.clientY, event.target as Element);
  }

  /**
   * Creates anchor data from client/viewport coordinates and optional target element
   */
  static createAnchorFromPoint(clientX: number, clientY: number, fallbackTarget?: Element): AnchorData {
    let target = fallbackTarget || document.elementFromPoint(clientX, clientY) || document.body;
    
    // Ignore Commyweb shadow host if hit
    if (target && (target.id === 'commyweb-extension-host' || (target as HTMLElement).classList?.contains('commyweb-pin'))) {
      target = document.body;
    }

    const rect = target.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);

    const xPercent = Math.min(Math.max((clientX - rect.left) / width, 0), 1);
    const yPercent = Math.min(Math.max((clientY - rect.top) / height, 0), 1);

    const selector = this.getCssSelector(target);
    const xpath = this.getXPath(target);
    const textSnippet = target.textContent?.trim().slice(0, 80) || undefined;

    return {
      selector,
      xpath,
      xPercent,
      yPercent,
      textSnippet,
      scrollOffset: {
        x: window.scrollX,
        y: window.scrollY
      }
    };
  }

  /**
   * Resolves the current pixel coordinates (relative to document body) for an anchor
   */
  static resolveCoordinates(anchor: AnchorData): { x: number; y: number } | null {
    let targetElement: Element | null = null;

    // 1. Try CSS selector
    try {
      if (anchor.selector) {
        targetElement = document.querySelector(anchor.selector);
      }
    } catch {
      // Invalid selector fallback
    }

    // 2. Try XPath fallback
    if (!targetElement && anchor.xpath) {
      try {
        const result = document.evaluate(
          anchor.xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        targetElement = result.singleNodeValue as Element;
      } catch {
        // XPath failed
      }
    }

    // 3. Fallback: if element found, compute position based on live rect + scroll
    if (targetElement) {
      const rect = targetElement.getBoundingClientRect();
      const x = rect.left + window.scrollX + (anchor.xPercent * rect.width);
      const y = rect.top + window.scrollY + (anchor.yPercent * rect.height);
      return { x, y };
    }

    // 4. Absolute fallback if element is no longer found in dynamic page
    if (anchor.scrollOffset) {
      return {
        x: anchor.scrollOffset.x + (window.innerWidth * anchor.xPercent),
        y: anchor.scrollOffset.y + 100
      };
    }

    return null;
  }
}
