# Commyweb architecture

## Entry points

- `popup.html` is the sole popup markup source. `src/popup/popup.ts` handles page context, filtering, author identity, site settings and token-free sharing.
- `src/content/index.ts` owns page interaction, navigation detection, pins and the thread dialog inside a Shadow DOM. Reinjection is guarded so it cannot add duplicate listeners.
- `src/background/index.ts` brokers messages, talks to GitHub and broadcasts changes. It owns the context menu and the sole Alt+C command handler.
- Vite builds the popup/service worker as modules and the content script separately as an IIFE. Both watchers preserve the other's output.

## Interaction model

Pins remain visible during normal browsing. Placement is opt-in and ends after a locally persisted comment. Escape cancels placement. Dialog submissions are guarded against duplicate requests, retain input on failure, support multiline and composition input, and expose accessible names and focus states.

Scroll and resize events share one animation-frame position update. Scroll capture also handles nested containers. Anchors use escaped CSS selectors, XPath, relative coordinates and an absolute fallback. A lightweight URL check catches navigation originating in the page's separate JavaScript world.

## Storage boundaries

Existing `commyweb_comments_<urlHash>` arrays are preserved. `storageRepo` distinguishes projects inside each array; legacy GitHub-backed comments infer it from their `issueUrl`. Unassigned legacy comments belong to local mode. Project changes do not automatically export local comments.

Site settings override legacy global defaults without mutating them during reads. An explicit empty site repository selects local mode. Tokens are stored locally only; synchronized settings exclude both global and per-site tokens. On installation/update, old local settings are retained while synchronized preferences are sanitized.

Writes within a storage manager are serialized by settings key or URL. The background also serializes mutations per repository/thread. Cache merges retain unrelated repositories and local changes made while a fetch was in flight.

## GitHub protocol

One thread maps to one Issue labeled `commyweb` and its URL hash. The body contains `<!-- COMMYWEB_DATA ... -->` JSON. Closing/reopening an Issue represents resolution state. Replies remain embedded in the thread payload for compatibility with existing installations.

`pendingChanges` records locally saved fields that GitHub has not acknowledged. Requests check HTTP status and have a timeout. On retry, the backend reads the current Issue, merges reply IDs, applies pending fields, and writes the result. Failed writes retain pending data. Fetches are deduplicated while in flight and follow all result pages.

The model does not offer atomic edits across clients. Two simultaneous read/modify/write operations can race. A future protocol using independently persisted reply records would improve concurrent collaboration. GitHub-side access permissions apply to the repository; local policy records and URL hashes are not an authorization boundary.

## Sharing and compatibility

Share links contain only a validated repository and canonical HTTP(S) page URL. Old payloads are decoded but token, email and authorization fields are ignored. The content script removes the extension fragment before async configuration and refuses a project link for a different page.

Since 1.7.0, links can also carry a validated realtime endpoint and a random project notification channel. They still contain no GitHub credentials. The popup provides a visible email invitation form that opens a mailto draft, with copy fallback and explicit instructions to press Send in the email client. No email is sent by the extension itself.

The GitHub guide runs in a persistent extension tab. Its token creation link uses GitHub's documented `target_name`, `issues=write`, `metadata=read`, name and expiration parameters. Exact repository selection still happens in GitHub. An authenticated picker pages through `/user/repos` and only lists active repositories with Issues enabled. Connection checks read repository metadata and Issues without creating a test Issue; they do not assert that write permission has been proved.

There is one extension edition. Packaging preserves the legacy Admin/User archive aliases without stripping settings from anyone's UI. Existing legacy member policy data is left untouched, but the interface no longer presents local revocation as remote access control.

## Realtime relay (1.7.0)

`src/background/realtime.ts` manages one browser WebSocket per endpoint/channel. `relay/server.mjs` is a standalone Node.js invalidation relay. Once GitHub acknowledges an extension mutation, the backend publishes `changed`. Subscribers refetch GitHub; no comment body, repository name or GitHub token is sent to the relay. Subscription channels are random capabilities included in invitations, not an authorization boundary for GitHub data.

Readiness is acknowledged before the UI reports a live connection. Twenty-second heartbeat exchanges keep Chrome 116+ workers active and detect silent connections; reconnect attempts use bounded exponential backoff. A successful reconnect triggers a refetch. Idle project subscriptions expire after 90 seconds without a page read. Polling remains at 15 seconds as fallback and for edits made outside Commyweb. The relay does not make issue-body updates atomic across clients.

Use one always-running relay instance with TLS terminated by its host or reverse proxy. Independent replicas need an external shared bus; this implementation does not provide one. Netlify's short-lived functions do not run this standalone WebSocket process. The repository ships a separate relay package, dependency lockfile, Dockerfile, health check and deployment guide. No production relay URL is built in.

## Netlify invitation guide

`site/` and `src/site/join.ts` provide public installation and invitation pages without Chrome APIs or a token input. The invitation configuration stays in the URL fragment; decoded fields are rendered using text content and validated links. Legacy credentials are stripped from the fragment, and hash changes rerender the guide. Email invitations link to the deployed guide, with a direct page link as fallback.

`npm run build:site` builds the extension, bundles the guide into `site-dist/` and adds an installable extension zip under `downloads/`. `netlify.toml` selects that output instead of the browser extension's `dist/`. A separate browser check verifies downloads, link validation, project/channel preservation and mobile bounds. A static guide deployment does not start the standalone relay.

## Verification

- `npm test`: storage, project isolation, synchronization, pagination, offline recovery, escaping, URL validation and sharing regression tests.
- `npm run test:browser`: actual Chromium extension profile covering placement, replies, drafts, resolution, reopening, dragging, viewport bounds, invitation compatibility, SPA navigation and nested scrolling.
- `npm run build`: strict TypeScript and both production bundles.
- `npm run package`: installable zip, legacy aliases, source archive and manifest version check.

Browser tests open the popup as an extension tab, which does not receive the toolbar's `activeTab` grant. They supply the target tab's URL metadata to that popup only; extension storage, background messaging and content scripts are real. GitHub regression tests use simulated API responses and do not prove live account permissions.
