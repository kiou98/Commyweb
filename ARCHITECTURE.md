# Commyweb Architecture & Technical Design

This document details the internal design and key architectural choices of **Commyweb**.

---

## 🏛️ System Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                          HOST WEBPAGE (Any URL)                        │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │               Commyweb Isolated Shadow DOM                   │     │
│   │                                                              │     │
│   │   [Pin 1]            [Pin 2 (Active)]                        │     │
│   │                          │                                   │     │
│   │                          ▼                                   │     │
│   │               ┌───────────────────────┐                      │     │
│   │               │   Figma Thread Modal  │                      │     │
│   │               │   - Author & time     │                      │     │
│   │               │   - Replies           │                      │     │
│   │               │   - [Resolve] [Reply] │                      │     │
│   │               └───────────────────────┘                      │     │
│   └──────────────────────────────▲───────────────────────────────┘     │
└──────────────────────────────────┼─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        CHROME EXTENSION RUNTIME                        │
│                                                                        │
│   ┌───────────────────────────┐      ┌─────────────────────────────┐   │
│   │     Content Script        │◄────►│  Background Service Worker  │   │
│   │   - Spatial DOM Anchoring │      │  - Central Message Broker   │   │
│   │   - Resize & Scroll Watch │      │  - Badge Counter            │   │
│   └───────────────────────────┘      └──────────────┬──────────────┘   │
│                                                     │                  │
│   ┌───────────────────────────┐                     │                  │
│   │        Popup UI           │◄────────────────────┤                  │
│   │   - Mode Switch & Filters │                     │                  │
│   │   - Page Comments List    │                     ▼                  │
│   └───────────────────────────┘       ┌────────────────────────────┐   │
│                                       │   chrome.storage.local     │   │
│                                       │   (Instant Local Cache)    │   │
│                                       └─────────────┬──────────────┘   │
└─────────────────────────────────────────────────────┼──────────────────┘
                                                      │
                                                      ▼
                              ┌──────────────────────────────────────────┐
                              │     Zero-DB Collaborative Backend        │
                              │       GitHub REST / Issues API           │
                              │      (1 URL = 1 Issue / Thread)          │
                              └──────────────────────────────────────────┘
```

---

## 1. 🎯 Spatial DOM Anchoring Engine

Unlike Figma where coordinates $(X, Y)$ exist on a static 2D vector canvas, the web is responsive, scrollable, and dynamic across varying screen sizes.

### How Anchoring Works
1. **Target Element Identification:** When a user clicks, Commyweb traverses the DOM upwards to compute a resilient CSS selector (`#id`, unique class chains, or `:nth-of-type(...)`) and fallback XPath.
2. **Relative Offset Calculation:** Rather than storing absolute window pixels, the anchor stores proportional coordinates $(X\%, Y\%)$:
   $$X\% = \frac{X_{\text{click}} - X_{\text{element}}}{\text{Width}_{\text{element}}}$$
   $$Y\% = \frac{Y_{\text{click}} - Y_{\text{element}}}{\text{Height}_{\text{element}}}$$
3. **Dynamic Layout Tracking:**
   - Active pins listen to `window.scroll` and `window.resize`.
   - Coordinates are dynamically recalculated: $X_{\text{pin}} = X_{\text{elem}} + (X\% \times W_{\text{elem}})$.
   - Even if the window shrinks or elements move, pins stay attached to the exact visual target.

---

## 2. 🛡️ Shadow DOM Isolation

Chrome extensions that inject UI into arbitrary web pages often suffer from CSS pollution:
- The website's CSS can break the extension's buttons, typography, or modal layout.
- The extension's CSS can unintentionally leak and alter styles on the host page.

**Solution:** Commyweb injects all pins, popovers, and badges inside an isolated `ShadowRoot` (`attachShadow({ mode: 'open' })`). This guarantees 100% style encapsulation and identical visual fidelity on every website.

---

## 3. ⚡ Zero-Database Collaborative Backend (No-DB)

Instead of hosting, maintaining, and paying for a traditional database:
- **Storage Layer:** GitHub Issues in a designated repository (public or private).
- **Page Association:** The normalized URL is hashed (e.g. `cw_9x7z...`).
- **Data Encapsulation:** Commyweb stores serialized comment metadata inside hidden issue body tags `<!-- COMMYWEB_DATA ... -->`.
- **Offline / Local First:** If no GitHub token is provided, Commyweb operates flawlessly with zero setup via `chrome.storage.local`.
- **Security:**
  - Token is stored strictly inside extension sandbox storage.
  - Strict HTML escaping prevents Cross-Site Scripting (XSS).
  - Tracking query parameters (`utm_*`, `fbclid`) are stripped to prevent thread fragmentation.

---

## 4. 🌍 Internationalization (i18n)

Commyweb is designed for global teams:
- Localization keys handled via `chrome.i18n`.
- Dynamic timestamps use the browser's native `Intl.RelativeTimeFormat` matching the user's system locale.
