# Commyweb

Pin feedback directly to web pages. An open-source Chrome / Edge / Brave extension with local storage and optional GitHub collaboration. No server to host.

[Documentation française](README.fr.md) · [Architecture](ARCHITECTURE.md) · [Change assessment](AUDIT.md)

## Quick start

1. Download and extract `commyweb-extension.zip` from the project's published releases.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted folder.
3. Open a web page, open Commyweb, enter your display name and choose **Ajouter un commentaire**.
4. Click a location, write a comment and send it. Normal browsing resumes automatically; pins stay visible.

Local mode works without an account or setup. To load a development build, select `dist`. When updating an existing installation, replace files in the **same folder** and reload the extension. A different installation folder can receive a different extension ID and therefore different local storage.

## Features

- Add a comment from the popup, page context menu or `Alt+C`.
- Enter sends; Shift+Enter inserts a line break; Escape closes the composer and cancels placement.
- Drafts survive closing a composer while the page remains loaded.
- Open pins using the mouse or Tab + Enter / Space.
- Reply, resolve, reopen and browse resolved discussions.
- Drag pins to another element; anchors follow page and nested-container scrolling.
- Filter discussions by all, open or resolved status.
- Cache-first display, explicit local/synchronized feedback and retry of pending changes.
- Separate projects by website and cached discussions by repository.
- Poll visible pages every 15 seconds; no periodic network polling for hidden pages.
- Detect single-page application pathname/query navigation within about a second.

## GitHub collaboration

1. Create a private GitHub repository and grant collaborators appropriate access in GitHub.
2. Each person creates their **own** fine-grained token limited to this repository with **Issues: Read and write**.
3. On the target website, open Commyweb settings, enter the repository and personal token, then save.
4. Share the project link. It contains the page and repository, **never the token**. Recipients configure their own GitHub access.

Access and revocation are managed in GitHub. A link does not grant access. Repository permissions do not enforce access to a single page. Old invitation tokens are ignored. Tokens remain in extension local storage and are removed from Chrome-synchronized preferences.

Local-only comments are not automatically uploaded when a repository is connected. Selecting local mode preserves both local and team data and changes which set is shown.

## Development and verification

Requires Node.js 20+ and npm.

```bash
npm ci
npm run build
npm run dev
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

`dev` watches both extension builds. Reload the extension and target pages after rebuilding. `test:browser` uses an isolated temporary Chromium profile with the real extension loaded. Storage and synchronization tests mock GitHub; no live GitHub account is used.

`release/` contains the extension and source archives. There is one edition; previous Admin/User archive names remain as aliases for compatibility.

## Practical limits

Browser internal pages and sites which disallow extensions cannot be annotated. URL fragments and tracking parameters are excluded from the canonical page URL, so hash-only routes currently share discussions. The popup is French; on-page dialogs use Chrome's French/English localization.

Threads are serialized into GitHub Issue bodies. The extension rereads before writing and merges reply IDs, but edits to the same issue from different computers at exactly the same time are not atomic. Page-level access control or account-free invitations require a separate authentication service.

MIT license.
