<p align="center">
  <img src="icons/logotype.png" alt="Commyweb" width="360" />
</p>

<p align="center">
  <strong>Collaborative, open-source Figma-like website commenting Chrome extension (Zero Database Required).</strong>
</p>

<p align="center">
  <a href="https://github.com/kiou98/Commyweb/releases"><img src="https://img.shields.io/github/v/release/kiou98/Commyweb?color=000000&label=Release" alt="Latest Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-000000.svg" alt="License MIT"></a>
  <a href="https://github.com/kiou98/Commyweb/stargazers"><img src="https://img.shields.io/github/stars/kiou98/Commyweb?color=000000" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="README.fr.md">🇫🇷 Lire en français</a>
</p>

---

Commyweb transforms any webpage on the internet into a collaborative canvas. Right-click anywhere on any web element to leave a pinned comment. Collaborate with teammates, reply in threaded conversations, and resolve comments once done—just like in **Figma**.

---

## ✨ Features

- 🖱️ **Right-Click Commenting:** Right-click on any element on the page and select *"💬 Ajouter un commentaire Commyweb"* to place a sleek black comment pin.
- 🎯 **Figma-style Spatial Pinning:** Pins stay perfectly anchored to specific DOM elements, maintaining their exact relative position even during page resizing and scrolling.
- 💬 **Threaded Conversations:** Reply to comments in chronological order with author avatars and timestamps.
- ✅ **Resolve & Archive:** Clean up the view by marking discussions as resolved. Toggle between active and archived threads at any time.
- ✉️ **Email Invites & Magic Links:** Invite team members by email. A single click on the magic link in the invitation email automatically authorizes access for that project.
- 🚫 **Member Revocation:** Any authorized project member can revoke any other collaborator directly from the popup.
- ⚡ **Zero Database Required (No-DB):** Powered by GitHub's API (Issues/Discussions). Zero database servers to configure, maintain, or pay for. Works 100% offline/locally if no GitHub account is connected.
- 🎨 **Art Direction Noir & Blanc:** Sleek, high-contrast monochrome design with **Satoshi** typography.
- 🌍 **International & Multi-language (i18n):** Native support for English, French, and easily extensible to any language via Chrome's i18n standard.
- 🛡️ **Built for Security:** Complete CSS isolation using **Shadow DOM** (your UI never conflicts with host websites), strict XSS sanitization, and sandboxed storage.
- 💸 **100% Free & Open Source:** MIT Licensed.

---

## 🚀 Quick Install (30 Seconds, No Coding Needed)

1. Download the latest [**commyweb-extension.zip**](https://github.com/kiou98/Commyweb/releases/latest/download/commyweb-extension.zip) (direct download link, or visit [Releases](https://github.com/kiou98/Commyweb/releases)).
2. Unzip the file on your computer.
3. Open Google Chrome (or Brave, Edge, Opera) and navigate to `chrome://extensions/`.
4. Turn **ON** the **Developer mode** toggle in the top-right corner.
5. Click the **Load unpacked** button in the top-left corner and select the unzipped `commyweb-extension` (or `dist`) folder.

*Done! The Commyweb black comment bubble icon will appear next to your address bar.*

---

## ⌨️ How to Use

1. Navigate to any website.
2. **Right-click** on any element and click **"💬 Ajouter un commentaire Commyweb"** (or press <kbd>Alt</kbd> + <kbd>C</kbd>).
3. Type your comment and hit **Send** (or <kbd>Enter</kbd>). A black Commyweb pin appears at that exact spot!
4. Click on any pin to view the conversation, reply, or click **Resolve** once addressed.

## 💾 Where Are Your Messages & Comments Stored?

Commyweb uses a **Zero-Database (No-DB)** architecture designed for complete privacy and data ownership:

1. **Locally in your browser (`chrome.storage.local`):**
   - All comments are first saved directly on your local machine.
   - They load with zero latency, work offline, and are **never lost** when restarting your browser or updating the extension.

2. **In your private GitHub repository (Collaborative Team Mode):**
   - When you link your private repository (e.g. `your-team/private-project`), every page thread is synchronized as a secure **GitHub Issue**.
   - Pin coordinates, discussions, authors, and replies are safely preserved.
   - Resolving a comment in the extension automatically closes the corresponding issue on GitHub.

> 🔒 **Privacy Guarantee:** No third-party database, middleman server, or external SaaS ever holds your data. You retain 100% ownership of your discussions.

---

## 👥 Who Needs An Account? (Zero-Friction for Collaborators)

| Role | Needs GitHub Account? | Needs Resend Account? | Responsibility |
| :--- | :---: | :---: | :--- |
| **👑 You (Project Admin)** | **Yes** (1 token to link your private repository) | **Optional** (only if you want 100% automated invite emails) | Hosts collaborative threads safely in a free private repo. |
| **🚀 Your Collaborators / Clients** | ❌ **NONE** | ❌ **NONE** | They click your invite, install the extension, and comment directly like in Figma! |

> 🔒 **Zero setup for your team:** Collaborators never need to create an account, password, or sign up for anything.

---

## 🤝 Collaborative Setup (GitHub No-DB Backend)

To share comments across your team without hosting a database:

1. Create a GitHub repository (e.g. `your-team/your-private-repo`). It can be **private**.
2. Generate a [GitHub Personal Access Token (Fine-grained)](https://github.com/settings/tokens) with `Issues: Read & Write` permission for that repository.
3. Open the Commyweb extension popup, click the **Settings ⚙️** icon, and enter:
   - **GitHub Token:** your PAT
   - **Storage Repository:** `your-team/your-private-repo`
   - *(Optional)* **Resend API Key:** your free key `re_...` from [resend.com](https://resend.com) for automated invite emails.
4. Click **Save Settings**. All comments and replies on any page will now automatically sync collaboratively across your team!

---

## 🛠️ Local Development

```bash
# Clone the repository
git clone https://github.com/kiou98/Commyweb.git
cd Commyweb

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
