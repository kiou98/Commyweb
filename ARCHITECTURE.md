# Commyweb architecture

## Entry points

- `popup.html` is the shared popup source. `src/popup/popup.ts` handles page context, filtering, identity, settings and magic invitations. Packaging creates Admin and Utilisateur manifests; the latter hides management controls and has no direct GitHub API host permission.
- `src/content/index.ts` owns page interaction, navigation detection, pins and the thread dialog inside a Shadow DOM. Reinjection is guarded so it cannot add duplicate listeners.
- `src/background/index.ts` brokers messages, talks to GitHub and broadcasts changes. It owns the context menu and the sole Alt+C command handler.
- Vite builds the popup/service worker as modules and the content script separately as an IIFE. Both watchers preserve the other's output.

## Interaction model

Pins remain visible during normal browsing unless the persisted **Activer les commentaires** switch is off. Placement is opt-in and ends after a locally persisted comment. Escape cancels placement. Dialog submissions are guarded against duplicate requests, retain input on failure, support multiline and composition input, and expose accessible names and focus states.

Scroll and resize events share one animation-frame position update. Scroll capture also handles nested containers. Anchors use escaped CSS selectors, XPath, relative coordinates and an absolute fallback. A lightweight URL check catches navigation originating in the page's separate JavaScript world.

## Storage boundaries

Existing `commyweb_comments_<urlHash>` arrays are preserved. `storageRepo` distinguishes projects inside each array; legacy GitHub-backed comments infer it from their `issueUrl`. Unassigned legacy comments belong to local mode. Project changes do not automatically export local comments.

Site settings override legacy global defaults without mutating them during reads. An explicit empty site repository selects local mode. GitHub tokens and collaboration capabilities are excluded from Chrome sync. Admin stores its GitHub token locally and sends it to the Netlify service when issuing invitations. User stores only its scoped capability locally. On installation/update, old local settings are retained while synchronized preferences are sanitized.

Local mutations are serialized by settings key or URL and acknowledged without waiting for network writes. Background network work is separately serialized per repository/thread. Acknowledgements preserve replies, status and anchors edited during an in-flight write. Cache-only broadcasts update open interfaces even while a remote fetch is pending.

## GitHub protocol

One thread maps to one Issue labeled `commyweb` and its URL hash. The body contains `<!-- COMMYWEB_DATA ... -->` JSON. Closing/reopening an Issue represents resolution state. Replies remain embedded in the thread payload for compatibility with existing installations.

`pendingChanges` records locally saved fields that GitHub has not acknowledged. Requests check HTTP status and have a timeout. On retry, the backend reads the current Issue, merges reply IDs, applies pending fields, and writes the result. An uncertain create is reconciled by comment ID before another POST, with a 30-second retry delay if still absent. `createAttemptedAt` is local bookkeeping, excluded from Issue bodies. Failed writes retain pending data. Fetches are deduplicated while in flight and follow all result pages.

The model does not offer atomic edits across clients. Two simultaneous read/modify/write operations can race. A future protocol using independently persisted reply records would improve concurrent collaboration. GitHub-side access permissions apply to the repository; local policy records and URL hashes are not an authorization boundary.

## Sharing and compatibility

Share links contain a validated repository, canonical HTTP(S) page URL and optionally a scoped invitation capability. Old GitHub tokens, emails and fake authorization fields are ignored. `invitation.js` removes the fragment at document start, before website scripts, and keeps it temporarily in the extension's isolated world. The main content script consumes it before async configuration and refuses links for a different page. Pasting a link in the popup configures directly through the background before navigating to a clean URL. New links are bearer credentials: an email label does not verify the holder's identity.

Since 1.7.0, links can also carry a validated realtime endpoint and a random project notification channel. They still contain no GitHub credentials. The popup provides a visible email invitation form that opens a mailto draft, with copy fallback and explicit instructions to press Send in the email client. No email is sent by the extension itself.

Setup remains inside the extension and can stay open in a global native side panel, fixed to its original website during tab switching. All inputs and drawer state persist locally. The token link uses GitHub's documented `target_name`, `issues=write`, `metadata=read`, name and expiration parameters. Exact repository selection still happens in GitHub. The picker pages through `/user/repos`; connection checks read metadata and Issues without creating a test Issue or claiming proven write permission.

`netlify/functions/collaboration.mjs` uses `netlify/lib/collaboration.mjs` and a site-wide, strongly consistent Netlify Blobs store. A project record holds the GitHub token, repository, exact website origin and hash of a random admin capability. Invitation records are keyed by a hash of a separate random 256-bit secret, expire after 30 days and are deleted to revoke. Raw invitation/admin capabilities and GitHub tokens are never returned by member lists or join responses. Netlify encrypts Blobs in transit and at rest; no arbitrary blob key or outbound host is exposed.

Only Admin can create/list/revoke invitations in the extension UI. The server independently requires the owner's capability for management. User requests may only read/create/update Commyweb Issues in that repository and website origin. The proxy filters unrelated Issues, checks a thread before PATCH, preserves existing reply contents and disallows replacing the initial text. GitHub credentials remain server-side; requests have body-size limits and timeouts. Revocation blocks subsequent network access, not previously cached data. Legacy local member policies are not used as server authorization.

## Realtime relay (1.7.0)

`src/background/realtime.ts` manages one browser WebSocket per endpoint/channel. `relay/server.mjs` is a standalone Node.js invalidation relay. Once GitHub acknowledges an extension mutation, the backend publishes `changed`. Subscribers refetch GitHub; no comment body, repository name or GitHub token is sent to the relay. Subscription channels are random capabilities included in invitations, not an authorization boundary for GitHub data.

Readiness is acknowledged before the UI reports a live connection. Twenty-second heartbeat exchanges keep Chrome 116+ workers active and detect silent connections; reconnect attempts use bounded exponential backoff. A successful reconnect triggers a refetch. Idle project subscriptions expire after 90 seconds without a page read. Polling remains at 15 seconds as fallback and for edits made outside Commyweb. The relay does not make issue-body updates atomic across clients.

Use one always-running relay instance with TLS terminated by its host or reverse proxy. Independent replicas need an external shared bus; this implementation does not provide one. Netlify's short-lived functions do not run this standalone WebSocket process. The repository ships a separate relay package, dependency lockfile, Dockerfile, health check and deployment guide. No production relay URL is built in.

## Netlify invitation guide

`site/` and `src/site/join.ts` provide public installation and legacy invitation guides without Chrome APIs or a token input. Configuration stays in the extension. Email invitations open the page to comment directly. The legacy guide preserves validated new invitations and strips old GitHub credentials; hash changes rerender it.

`npm run build:site` builds both editions, bundles the guide into `site-dist/` and adds Admin/User installable archives under `downloads/`. `netlify.toml` also deploys the invitation function using esbuild. A separate browser check verifies downloads, links, preservation of capabilities and mobile bounds. Deploying Netlify Functions does not start the standalone WebSocket relay.

## Verification

- `npm test`: storage, project isolation, synchronization, pagination, offline recovery, escaping, URL validation and sharing regression tests.
- `npm run test:browser`: actual Chromium extension profile covering placement, replies, drafts, resolution, reopening, dragging, viewport bounds, invitation compatibility, SPA navigation and nested scrolling.
- `npm run build`: strict TypeScript and both production bundles.
- `npm run package`: installable zip, legacy aliases, source archive and manifest version check.

Browser tests open the popup as an extension tab, which does not receive the toolbar's `activeTab` grant. They supply the target tab's URL metadata to that popup only; extension storage, background messaging and content scripts are real. GitHub regression tests use simulated API responses and do not prove live account permissions.
