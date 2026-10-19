import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeUrl, hashUrl } from '../../src/utils/security.ts';
import { parseGitHubRepo } from '../../src/utils/github-parser.ts';

const digest = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const validSecret = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET', 'Access-Control-Expose-Headers': 'Link', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

export function createCollaborationHandler({ store, githubFetch = fetch, now = Date.now }) {
  const read = key => store.get(key, { type: 'json' });
  async function github(token, path, method = 'GET', body) {
    const response = await githubFetch(`https://api.github.com${path}`, { method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) fail(`GitHub (${response.status}) : le responsable doit vérifier l’accès du projet.`, response.status === 401 || response.status === 403 ? 403 : 502);
    return response;
  }
  const parseComment = issue => {
    try { return JSON.parse(issue.body.match(/<!-- COMMYWEB_DATA\s*([\s\S]*?)\s*-->/)[1]); } catch { return null; }
  };
  const allowedComment = (comment, project) => comment && typeof comment.id === 'string' && typeof comment.url === 'string'
    && new URL(comment.url).origin === project.origin && comment.urlHash === hashUrl(normalizeUrl(comment.url));
  const publicIssue = issue => ({ number: issue.number, html_url: issue.html_url, state: issue.state, body: issue.body });
  async function owner(projectId, secret) {
    const project = await read(`projects/${projectId}`);
    if (!project || !safeEqual(project.ownerHash, digest(secret))) fail('Accès administrateur invalide.', 403);
    return project;
  }
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method === 'GET') return json({ success: true, service: 'Commyweb invitations', version: '1.8.0' });
    if (request.method !== 'POST') return json({ success: false, error: 'Méthode non autorisée.' }, 405);
    try {
      const raw = await request.text();
      if (raw.length > 160000) fail('Requête trop volumineuse.', 413);
      let body;
      try { body = JSON.parse(raw); } catch { fail('Requête invalide.'); }
      const { action, projectId } = body;
      const secret = request.headers.get('Authorization')?.replace(/^Bearer /, '');
      if (!validId(projectId) || !validSecret(secret)) fail('Lien invalide ou expiré. Demandez une nouvelle invitation.', 403);
      if (action === 'invite') {
        const repo = parseGitHubRepo(body.repo)?.fullName;
        if (!repo || typeof body.token !== 'string' || !body.token.trim() || body.token.length > 1024) fail('Connectez d’abord le projet GitHub.');
        if (typeof body.url !== 'string' || !/^https?:\/\//.test(body.url)) fail('Page invalide.');
        const url = normalizeUrl(body.url);
        const origin = new URL(url).origin;
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (email.length > 254 || !/^[^\s@,;?]+@[^\s@,;?]+\.[^\s@,;?]+$/.test(email)) fail('Saisissez une adresse email valide.');
        let project = await read(`projects/${projectId}`);
        if (project && (!safeEqual(project.ownerHash, digest(secret)) || project.repo.toLowerCase() !== repo.toLowerCase() || project.origin !== origin)) fail('Ce projet appartient à un autre accès administrateur.', 403);
        const metadata = await (await github(body.token, `/repos/${repo}`)).json();
        if (!metadata.has_issues || metadata.archived || metadata.disabled) fail('Le projet doit être actif et autoriser les Issues.');
        await github(body.token, `/repos/${repo}/issues?per_page=1&state=all`);
        if (!project) {
          const created = await store.setJSON(`projects/${projectId}`, { repo, origin, ownerHash: digest(secret), githubToken: body.token }, { onlyIfNew: true });
          if (!created.modified) project = await owner(projectId, secret);
        }
        // A refreshed admin token also renews access for existing, non-revoked invitations.
        if (project) await store.setJSON(`projects/${projectId}`, { ...project, githubToken: body.token });
        const invitationSecret = randomBytes(32).toString('hex');
        const id = digest(invitationSecret);
        const member = { id, email, createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 30 * 86400000).toISOString() };
        await store.setJSON(`invitations/${projectId}/${id}`, member);
        return json({ success: true, invitation: { projectId, secret: invitationSecret }, member, repo, url });
      }
      if (action === 'members' || action === 'revoke') {
        await owner(projectId, secret);
        if (action === 'revoke') {
          if (!validSecret(body.memberId)) fail('Invitation invalide.');
          await store.delete(`invitations/${projectId}/${body.memberId}`);
          return json({ success: true });
        }
        const { blobs } = await store.list({ prefix: `invitations/${projectId}/` });
        const members = (await Promise.all(blobs.map(blob => read(blob.key)))).filter(Boolean);
        return json({ success: true, members });
      }
      const member = await read(`invitations/${projectId}/${digest(secret)}`);
      const project = await read(`projects/${projectId}`);
      if (!member || !project || Date.parse(member.expiresAt) <= now()) fail('Invitation expirée ou révoquée. Demandez un nouveau lien au responsable.', 403);
      if (action === 'join') return json({ success: true, repo: project.repo, origin: project.origin, member });
      if (action !== 'github') fail('Action inconnue.');
      // The invitation grants only Commyweb Issues on the selected website and repository.
      const method = body.method || 'GET';
      const prefix = `/repos/${project.repo}/issues`;
      const path = typeof body.path === 'string' ? body.path : '';
      const match = path.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/(\\d+))?(?:\\?[^#]*)?$`, 'i'));
      if (!match || !['GET', 'POST', 'PATCH'].includes(method) || (method === 'POST' && match[1]) || (method === 'PATCH' && !match[1])) fail('Action non autorisée pour cette invitation.', 403);
      if (method === 'GET') {
        if (!match[1]) {
          const query = new URL(path, 'https://api.github.com').searchParams;
          const page = Math.max(1, Math.min(1000, Number(query.get('page')) || 1));
          const urlHash = query.get('labels')?.split(',').find(label => /^cw_/.test(label));
          const response = await github(project.githubToken, `${prefix}?state=all&per_page=100&page=${page}&labels=${encodeURIComponent(`commyweb${urlHash ? `,${urlHash}` : ''}`)}`);
          const issues = await response.json();
          return json(issues.filter(issue => { try { return allowedComment(parseComment(issue), project); } catch { return false; } }).map(publicIssue), 200,
            response.headers.get('Link') ? { Link: response.headers.get('Link') } : {});
        }
        const issue = await (await github(project.githubToken, `${prefix}/${match[1]}`)).json();
        if (!allowedComment(parseComment(issue), project)) fail('Discussion inaccessible.', 403);
        return json(publicIssue(issue));
      }
      const comment = parseComment(body.body || {});
      if (!allowedComment(comment, project) || typeof comment.content !== 'string' || comment.content.length > 20000 || !Array.isArray(comment.replies)) fail('Commentaire invalide.');
      if (method === 'PATCH') {
        const previous = parseComment(await (await github(project.githubToken, `${prefix}/${match[1]}`)).json());
        if (!allowedComment(previous, project) || previous.id !== comment.id || normalizeUrl(previous.url) !== normalizeUrl(comment.url)) fail('Discussion inaccessible.', 403);
        if (previous.content !== comment.content) fail('Le texte initial ne peut pas être remplacé par une invitation.', 403);
        const previousReplies = new Map((previous.replies || []).map(reply => [reply.id, reply]));
        for (const reply of comment.replies) {
          if (previousReplies.has(reply.id)) {
            if (JSON.stringify(previousReplies.get(reply.id)) !== JSON.stringify(reply)) fail('Une réponse existante ne peut pas être modifiée.', 403);
            previousReplies.delete(reply.id);
          } else reply.author = { ...reply.author, id: member.id, email: member.email };
        }
        if (previousReplies.size) fail('Une réponse existante ne peut pas être supprimée.', 403);
      } else comment.author = { ...comment.author, id: member.id, email: member.email };
      comment.storageRepo = project.repo;
      const payload = { body: `<!-- COMMYWEB_DATA\n${JSON.stringify(comment).replace(/-->/g, '\\u002d\\u002d>')}\n-->`,
        ...(method === 'POST' ? { title: `[Commyweb] ${comment.anchor?.textSnippet || comment.url}`.slice(0, 200), labels: ['commyweb', comment.urlHash] }
          : { state: comment.status === 'resolved' ? 'closed' : 'open' }) };
      const result = await (await github(project.githubToken, `${prefix}${match[1] ? `/${match[1]}` : ''}`, method, payload)).json();
      return json(publicIssue(result));
    } catch (error) {
      return json({ success: false, error: error.status ? error.message : 'Service indisponible. Vos commentaires restent conservés sur cet appareil.' }, error.status || 503);
    }
  };
}
