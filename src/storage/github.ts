import { WebComment, Author, UserSettings, CommentReply } from '../types';
import { CacheManager } from './cache';
import { parseGitHubRepo } from '../utils/github-parser';
import { collaborationRequest, hasProjectAccess } from './collaboration';

type SaveResult = { success: boolean; synced: boolean; error?: string; issueNumber?: number };

/** Local mutations remain pending until GitHub acknowledges them. */
export class GitHubBackend {
  static onSynced?: (settings: UserSettings) => void;
  static onSyncError?: (settings: UserSettings) => void;
  private static writes = new Map<string, Promise<SaveResult>>();
  private static reads = new Map<string, Promise<WebComment[]>>();
  private static errors = new Map<string, string>();
  private static pages = new Map<string, { etag: string; issues: any[]; link: string | null }>();

  private static repo(settings: UserSettings): string {
    return parseGitHubRepo(settings.storageRepo)?.fullName || '';
  }

  private static async request(settings: UserSettings, path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    if (settings.collaboration?.role === 'collaborator') return collaborationRequest('github', settings.collaboration, { path, method, body });
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${settings.githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...headers
      },
      signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (!response.ok && response.status !== 304) {
      const advice = response.status === 401 ? 'Vérifiez votre jeton GitHub.'
        : response.status === 403 || response.status === 429 ? 'Accès refusé ou limite GitHub atteinte. Réessayez plus tard.'
        : response.status === 404 ? 'Vérifiez le dépôt et les droits de votre jeton.' : 'Réessayez dans quelques instants.';
      throw new Error(`GitHub (${response.status}) : ${advice}`);
    }
    return response;
  }

  static getSyncError(settings: UserSettings): string | undefined { return this.errors.get(this.repo(settings)); }

  static async listRepositories(token: string): Promise<{ fullName: string; private: boolean }[]> {
    if (!token.trim()) throw new Error('Collez d’abord votre jeton GitHub.');
    const repositories: { fullName: string; private: boolean }[] = [];
    for (let page = 1; ; page++) {
      const response = await this.request({ githubToken: token }, `/user/repos?per_page=100&sort=pushed&page=${page}`);
      const data = await response.json();
      for (const repo of data) {
        if (repo.has_issues && !repo.archived && !repo.disabled && parseGitHubRepo(repo.full_name)) {
          repositories.push({ fullName: repo.full_name, private: !!repo.private });
        }
      }
      if (!response.headers.get('Link')?.includes('rel="next"')) break;
    }
    return repositories;
  }

  static async verifyProject(settings: UserSettings): Promise<void> {
    const repo = this.repo(settings);
    if (!repo || !settings.githubToken) throw new Error('Indiquez votre projet et votre jeton GitHub.');
    const metadata = await (await this.request(settings, `/repos/${repo}`)).json();
    if (!metadata.has_issues || metadata.archived || metadata.disabled) throw new Error('Ce dépôt doit être actif et avoir les Issues activées.');
    await this.request(settings, `/repos/${repo}/issues?per_page=1&state=all`);
  }

  static async getCurrentUser(token: string): Promise<Author | null> {
    try {
      const data = await (await this.request({ githubToken: token }, '/user')).json();
      return { id: String(data.id), username: data.login, name: data.name || data.login, avatarUrl: data.avatar_url };
    } catch { return null; }
  }

  private static parseIssue(item: any): WebComment | null {
    try {
      const match = item.body?.match(/<!-- COMMYWEB_DATA\s*([\s\S]*?)\s*-->/);
      if (!match) return null;
      const comment = JSON.parse(match[1]);
      if (!comment || typeof comment.id !== 'string' || typeof comment.url !== 'string'
        || typeof comment.urlHash !== 'string' || typeof comment.content !== 'string'
        || !comment.anchor || typeof comment.anchor.selector !== 'string'
        || !Number.isFinite(comment.anchor.xPercent) || !Number.isFinite(comment.anchor.yPercent)
        || !comment.author || typeof comment.author.username !== 'string'
        || (comment.author.name !== undefined && typeof comment.author.name !== 'string')
        || !Array.isArray(comment.replies) || !Number.isFinite(Date.parse(comment.createdAt))) return null;
      if (comment.replies.some((r: CommentReply) => !r || typeof r.id !== 'string'
        || typeof r.content !== 'string' || !r.author || typeof r.author.username !== 'string'
        || (r.author.name !== undefined && typeof r.author.name !== 'string'))) return null;
      return { ...comment, status: item.state === 'closed' ? 'resolved' : 'open',
        issueNumber: item.number, issueUrl: item.html_url, pendingChanges: [] };
    } catch { return null; }
  }

  static async fetchComments(settings: UserSettings, urlHash?: string, retryPending = true): Promise<WebComment[]> {
    const key = `${this.repo(settings)}:${urlHash || 'all'}:${retryPending}`;
    const existing = this.reads.get(key);
    if (existing) return existing;
    const pending = this.fetchProject(settings, urlHash, retryPending);
    this.reads.set(key, pending);
    try { return await pending; } finally { this.reads.delete(key); }
  }

  private static async fetchProject(settings: UserSettings, urlHash?: string, retryPending = true): Promise<WebComment[]> {
    const repo = this.repo(settings);
    const allPages = !urlHash || urlHash === 'all';
    const readCache = async () => (allPages ? await CacheManager.getAllComments()
      : await CacheManager.getCommentsForUrl(urlHash!)).filter(c => CacheManager.belongsToProject(c, repo));
    if (!hasProjectAccess(settings) || !repo) return readCache();
    const baseline = await readCache();
    try {
      const remote: WebComment[] = [];
      const labels = allPages ? 'commyweb' : `commyweb,${urlHash}`;
      for (let page = 1; ; page++) {
        const path = `/repos/${repo}/issues?labels=${encodeURIComponent(labels)}&state=all&per_page=100&page=${page}`;
        const cached = this.pages.get(path);
        const response = await this.request(settings, path, 'GET', undefined,
          cached ? { 'If-None-Match': cached.etag } : {});
        const issues = response.status === 304 && cached ? cached.issues : await response.json();
        const link = response.status === 304 && cached ? cached.link : response.headers.get('Link');
        const etag = response.headers.get('ETag');
        if (response.status !== 304 && etag) this.pages.set(path, { etag, issues, link });
        for (const issue of issues) {
          const comment = this.parseIssue(issue);
          if (comment && (allPages || comment.urlHash === urlHash)) remote.push({ ...comment, storageRepo: repo });
        }
        if (!link?.includes('rel="next"')) break;
      }
      const hashes = new Set([...remote.map(c => c.urlHash), ...(await readCache()).map(c => c.urlHash)]);
      for (const hash of hashes) await CacheManager.mergeRemoteComments(hash, repo, remote.filter(c => c.urlHash === hash), baseline.filter(c => c.urlHash === hash));
      this.errors.delete(repo);
    } catch (error) {
      this.errors.set(repo, error instanceof Error ? error.message : 'Connexion indisponible. Vos messages restent sur cet appareil.');
    }
    const comments = await readCache();
    for (const comment of retryPending ? comments : []) {
      if (!comment.issueNumber || comment.pendingChanges?.length) {
        void this.queue(settings, comment.id, comment.urlHash, () => this.syncComment(settings, comment.id, comment.urlHash));
      }
    }
    return comments.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  private static queue(settings: UserSettings, id: string, hash: string, operation: () => Promise<SaveResult>) {
    const key = `${this.repo(settings)}:${hash}:${id}`;
    const next = (this.writes.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    this.writes.set(key, next);
    void next.finally(() => { if (this.writes.get(key) === next) this.writes.delete(key); }).catch(() => {});
    return next;
  }

  private static issueBody(comment: WebComment): string {
    const { pendingChanges: _pending, createAttemptedAt: _attempt, ...shared } = comment;
    const payload = JSON.stringify(shared).replace(/-->/g, '\\u002d\\u002d>');
    return `### Commyweb Comment on ${comment.url}\n\n**Author:** ${comment.author.name || comment.author.username}\n\n${comment.content}\n\n<!-- COMMYWEB_DATA\n${payload}\n-->`;
  }

  private static async syncComment(settings: UserSettings, id: string, hash: string): Promise<SaveResult> {
    const repo = this.repo(settings);
    const comment = (await CacheManager.getCommentsForUrl(hash)).find(c => c.id === id && CacheManager.belongsToProject(c, repo));
    if (!comment) return { success: false, synced: false, error: 'Discussion introuvable.' };
    if (!hasProjectAccess(settings) || !repo) return { success: true, synced: false };
    if (comment.issueNumber && !comment.pendingChanges?.length) return { success: true, synced: true, issueNumber: comment.issueNumber };
    try {
      if (!comment.issueNumber && comment.createAttemptedAt) {
        // A timeout may occur after GitHub accepted the POST. Reconcile before retrying.
        await this.fetchProject(settings, hash, false);
        const recovered = (await CacheManager.getCommentsForUrl(hash)).find(c => c.id === id && CacheManager.belongsToProject(c, repo));
        if (recovered?.issueNumber) return this.syncComment(settings, id, hash);
        if (Date.now() - comment.createAttemptedAt < 30000) return { success: true, synced: false };
      }
      let shared = { ...comment };
      if (comment.issueNumber) {
        const remote = this.parseIssue(await (await this.request(settings, `/repos/${repo}/issues/${comment.issueNumber}`)).json());
        if (!remote) throw new Error('La discussion GitHub ne contient plus de données Commyweb valides.');
        const pending = new Set(comment.pendingChanges);
        shared = { ...remote, storageRepo: repo,
          ...(pending.has('anchor') ? { anchor: comment.anchor } : {}),
          ...(pending.has('status') ? { status: comment.status } : {}), updatedAt: comment.updatedAt,
          replies: [...new Map([...remote.replies, ...comment.replies].map(r => [r.id, r])).values()] };
      }
      if (!comment.issueNumber) {
        const attemptedAt = Date.now();
        await CacheManager.mutateComment(hash, id, repo, stored => { stored.createAttemptedAt = attemptedAt; });
      }
      const response = await this.request(settings,
        `/repos/${repo}/issues${comment.issueNumber ? `/${comment.issueNumber}` : ''}`, comment.issueNumber ? 'PATCH' : 'POST', {
          ...(comment.issueNumber ? { state: shared.status === 'resolved' ? 'closed' : 'open' } : {
            title: `[Commyweb] ${shared.anchor.textSnippet || shared.url}`.slice(0, 200), labels: ['commyweb', shared.urlHash]
          }), body: this.issueBody(shared)
        });
      const issue = await response.json();
      const acknowledged = await CacheManager.acknowledgeSync(comment, { ...shared, issueNumber: issue.number, issueUrl: issue.html_url });
      if (acknowledged.pendingChanges?.length) return this.syncComment(settings, id, hash);
      this.errors.delete(repo);
      try { this.onSynced?.(settings); } catch { /* A relay failure must not undo a GitHub save. */ }
      return { success: true, synced: true, issueNumber: issue.number };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Synchronisation indisponible.';
      this.errors.set(repo, message);
      this.onSyncError?.(settings);
      return { success: true, synced: false, error: message };
    }
  }

  static async saveComment(settings: UserSettings, comment: WebComment, waitForSync = true): Promise<SaveResult> {
    await CacheManager.addCommentIfMissing({ ...comment, storageRepo: this.repo(settings), pendingChanges: ['content'] });
    return this.scheduleSync(settings, comment.id, comment.urlHash, waitForSync);
  }

  private static scheduleSync(settings: UserSettings, id: string, hash: string, waitForSync: boolean) {
    const syncing = this.queue(settings, id, hash, () => this.syncComment(settings, id, hash));
    return waitForSync ? syncing : Promise.resolve({ success: true, synced: false });
  }

  private static mutate(settings: UserSettings, id: string, hash: string,
    field: NonNullable<WebComment['pendingChanges']>[number], change: (comment: WebComment) => void, waitForSync: boolean) {
    return CacheManager.mutateComment(hash, id, this.repo(settings), comment => {
      change(comment);
      comment.updatedAt = new Date().toISOString();
      comment.pendingChanges = [...new Set([...(comment.pendingChanges || []), field])];
    }).then(() => this.scheduleSync(settings, id, hash, waitForSync));
  }

  static updateCommentAnchor(settings: UserSettings, comment: WebComment, waitForSync = true) {
    return this.mutate(settings, comment.id, comment.urlHash, 'anchor', stored => { stored.anchor = comment.anchor; }, waitForSync);
  }

  static addReply(settings: UserSettings, id: string, hash: string, reply: CommentReply, waitForSync = true) {
    return this.mutate(settings, id, hash, 'replies', comment => {
      if (!comment.replies.some(r => r.id === reply.id)) comment.replies.push(reply);
    }, waitForSync);
  }

  static async toggleResolve(settings: UserSettings, id: string, hash: string, waitForSync = true) {
    let isResolved = false;
    const result = await this.mutate(settings, id, hash, 'status', comment => {
      comment.status = comment.status === 'resolved' ? 'open' : 'resolved';
      isResolved = comment.status === 'resolved';
    }, waitForSync);
    return { ...result, isResolved };
  }
}
