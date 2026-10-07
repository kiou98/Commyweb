# Commyweb 💬

> **Collaborative, open-source Figma-like website commenting Chrome extension (Zero Database Required).**

[🇫🇷 Lire en français](README.fr.md)

Commyweb transforms any webpage on the internet into a collaborative canvas. Press <kbd>Alt</kbd> + <kbd>C</kbd>, click anywhere on a web element, and leave a pinned comment. Collaborate with teammates, reply in threaded conversations, and resolve comments once done—just like in **Figma**.

---

## ✨ Features

- 🎯 **Figma-style Spatial Pinning:** Pins stay perfectly anchored to specific DOM elements, maintaining their exact relative position even during page resizing and scrolling.
- 💬 **Threaded Conversations:** Reply to comments in chronological order with author avatars and timestamps.
- ✅ **Resolve & Archive:** Clean up the view by marking discussions as resolved. Toggle between active and archived threads at any time.
- ⚡ **Zero Database Required (No-DB):** Powered by GitHub's API (Issues/Discussions). Zero database servers to configure, maintain, or pay for. Works 100% offline/locally if no GitHub account is connected.
- 🌍 **International & Multi-language (i18n):** Native support for English, French, and easily extensible to any language via Chrome's i18n standard. Relative time format adaptative to user locales.
- 🛡️ **Built for Security:** Complete CSS isolation using **Shadow DOM** (your UI never conflicts with host websites), strict XSS sanitization, and sandboxed storage.
- 💸 **100% Free & Open Source:** MIT Licensed.

---

## 🚀 Quick Install (30 Seconds, No Coding Needed)

1. Download the latest `commyweb-extension.zip` from the [**Releases**](https://github.com/your-username/commyweb/releases) page.
2. Unzip the file on your computer.
3. Open Google Chrome (or Brave, Edge, Opera) and navigate to `chrome://extensions/`.
4. Turn **ON** the **Developer mode** toggle in the top-right corner.
5. Click the **Load unpacked** button in the top-left corner and select the unzipped `commyweb-extension` (or `dist`) folder.

*Done! The Commyweb comment bubble icon will appear next to your address bar.*

---

## ⌨️ How to Use

1. Navigate to any website.
2. Press <kbd>Alt</kbd> + <kbd>C</kbd> (or click the extension icon and toggle **Comment Mode**).
3. Click anywhere on the webpage to pin a comment.
4. Type your message and hit **Send** (or <kbd>Enter</kbd>).
5. Click on any pin to view the conversation, reply, or click **Resolve** once addressed.

---

## 🤝 Collaborative Setup (GitHub No-DB Backend)

To share comments across your team without hosting a database:

1. Create a GitHub repository (e.g. `your-team/website-feedback`). It can be **public** or **private**.
2. Generate a [GitHub Personal Access Token (Fine-grained)](https://github.com/settings/tokens) with `Issues: Read & Write` permission for that repository.
3. Open the Commyweb extension popup, click the **Settings ⚙️** icon, and enter:
   - **GitHub Token:** your PAT
   - **Storage Repository:** `your-team/website-feedback`
4. Click **Save Settings**. All comments and replies on any page will now automatically sync collaboratively across your team!

---

## 🛠️ Local Development

```bash
# Clone the repository
git clone https://github.com/your-username/commyweb.git
cd commyweb

# Install dependencies
npm install

# Run build in watch mode for development
npm run dev

# Build production bundle
npm run build

# Package into a release zip
npm run package
```

Load the generated `dist` folder into `chrome://extensions/`.

---

## 📄 License

MIT License. Free to use, modify, and distribute.
