# Commyweb

Pin feedback directly to web pages. An open-source Chrome / Edge / Brave extension with local storage, optional GitHub collaboration and an optional standalone realtime relay.

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
- Receive cross-browser changes through a WebSocket relay, with a 15-second GitHub polling fallback.
- Detect single-page application pathname/query navigation within about a second.

## GitHub collaboration

1. Create a private GitHub repository and grant collaborators appropriate access in GitHub.
2. Open Commyweb settings. Choose **Garder la configuration ouverte** to keep the extension in the browser's side panel while visiting GitHub. It stays associated with the original website when switching tabs. Inputs and the current settings/invitation view are saved locally as you type, including unfinished setup; connection still requires **Vérifier et connecter**.
3. Enter the repository URL and choose **Créer mon jeton GitHub**. The owner and Issues permissions are prefilled; select **Only select repositories**, choose the named project and generate your personal token.
4. Paste the token. The picker lists projects accessible with that token. Choose **Vérifier et connecter** to verify repository and Issues read access without creating test data. Commenting also requires write access.
5. Choose **✉ Inviter**, enter the recipient's email address and prepare the invitation. It opens an email draft: **review it and press Send in your email client**. If no mail client opens, copy the full email instead. Commyweb does not send email automatically.

Access and revocation are managed in GitHub. A link does not grant access. Repository permissions do not enforce access to a single page. Old invitation tokens are ignored. Tokens remain in extension local storage and are removed from Chrome-synchronized preferences.

Local-only comments are not automatically uploaded when a repository is connected. Selecting local mode preserves both local and team data and changes which set is shown.

## Realtime collaboration

Deploy the standalone relay using its [deployment guide](relay/README.md). It supports Node.js or Docker on an always-running host accepting WebSocket connections. The project owner enters its `wss://…/sync` address once; new invitation links include the relay and channel automatically. Short-lived Netlify functions do not host this standalone server.

After a GitHub write succeeds, the extension signals other clients through the relay and they fetch the latest discussions. Replies and resolution changes update open dialogs. Connections recover after interruptions and refetch missed changes. **Temps réel actif** appears only after the relay confirms a subscription.

The relay receives no GitHub tokens or comment bodies and stores no discussion data. It is not an authorization service. Display latency still depends on GitHub. Periodic refresh remains as fallback and picks up edits made directly in GitHub. Without a deployed relay, collaboration remains periodic.

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

`dev` watches both extension builds. Reload the extension and target pages after rebuilding. `test:browser` uses isolated temporary Chromium profiles with the real extension loaded, including a two-profile realtime test through the actual relay. Storage and synchronization tests mock GitHub; no live GitHub account is used.

`release/` contains extension, source and standalone relay archives. There is one edition; previous Admin/User archive names remain as aliases for compatibility.

## Practical limits

Browser internal pages and sites which disallow extensions cannot be annotated. URL fragments and tracking parameters are excluded from the canonical page URL, so hash-only routes currently share discussions. The popup is French; on-page dialogs use Chrome's French/English localization.

Threads are serialized into GitHub Issue bodies. The extension rereads before writing and merges reply IDs, but edits to the same issue from different computers at exactly the same time are not atomic. Page-level access control or account-free invitations require a separate authentication service.

MIT license.
