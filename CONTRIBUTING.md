# Contributing to Commyweb 🤝

Thank you for your interest in contributing to Commyweb! We welcome all contributions from bug reports to new feature implementations and translations.

---

## 🛠️ Development Setup

1. **Prerequisites:**
   - Node.js (v18+)
   - npm (v9+)
   - Google Chrome or Chromium-based browser (Brave, Edge, Arc)

2. **Clone & Install:**
   ```bash
   git clone https://github.com/kiou98/Commyweb.git
   cd Commyweb
   npm install
   ```

3. **Development Build:**
   ```bash
   npm run dev
   ```
   This will watch for code changes in `src/` and automatically rebuild to the `dist/` folder.

4. **Load Extension in Chrome:**
   - Visit `chrome://extensions/`
   - Enable **Developer mode** (top-right)
   - Click **Load unpacked** and select the `dist/` directory.

---

## 🌍 Adding a New Language (i18n)

Commyweb uses the Chrome Extension i18n standard:
1. Duplicate `_locales/en/messages.json` into `_locales/<your_language_code>/messages.json` (e.g. `_locales/es/messages.json` for Spanish).
2. Translate the values while preserving key names.
3. Submit a Pull Request!

---

## 📋 Pull Request Guidelines

1. Fork the repository and create your feature branch: `git checkout -b feature/amazing-feature`.
2. Ensure TypeScript compiles without errors: `npm run build`.
3. Commit your changes with conventional commit messages: `git commit -m 'feat: add emoji reactions'`.
4. Push to your branch and open a Pull Request.

---

## 🛡️ Code of Conduct

Please be respectful, collaborative, and constructive when participating in discussions and reviews.
