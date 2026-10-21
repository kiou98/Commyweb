import { WebComment, Author, UserSettings, CommentReply } from '../types';
import { CacheManager } from './cache';
import { parseGitHubRepo } from '../utils/github-parser';

/**
 * GitHub API client providing a zero-database backend
 * Uses GitHub Issues as collaborative thread storage
 */
export class GitHubBackend {
  private static savingCommentIds = new Set<string>();
  private static etagByUrlHash = new Map<string, string>();

  private static async getHeaders(token: string) {
    return {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Verify token and fetch current authenticated user profile
   */
  static async getCurrentUser(token: string): Promise<Author | null> {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: await this.getHeaders(token)
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        id: String(data.id),
        username: data.login,
        name: data.name || data.login,
        avatarUrl: data.avatar_url
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch all comments for a given URL hash (or all pages if urlHash is omitted or 'all')
   * Uses direct issues endpoint with labels and ETag conditional GET
   * Sorts newest comments first (Derniers commentaires en priorité)
   */
  static async fetchComments(settings: UserSettings, urlHash?: string, syncPending = true): Promise<WebComment[]> {
    const isAllPages = !urlHash || urlHash === 'all';
    const cached = isAllPages ? await CacheManager.getAllComments() : await CacheManager.getCommentsForUrl(urlHash!);

    if (!settings.githubToken || !settings.storageRepo) {
      return cached;
    }

    try {
      const repoInfo = parseGitHubRepo(settings.storageRepo);
      if (!repoInfo) {
        return cached;
      }
      const { owner, repo } = repoInfo;

      // 1. Recover and push any unsynced local comments in background (non-blocking)
      const unsynced = syncPending ? cached.filter(c => !c.issueNumber && c.status !== 'resolved' && !this.savingCommentIds.has(c.id)) : [];
      for (const pendingComment of unsynced) {
        this.saveComment(settings, pendingComment).catch(() => {});
      }

      // 2. Query direct issues API by labels (commyweb or commyweb + urlHash)
      // Uses ETag for conditional GET: returns 304 in ~100ms with 0 rate limit cost when unchanged!
      const labelQuery = isAllPages ? 'commyweb' : `commyweb,${encodeURIComponent(urlHash!)}`;
      const directUrl = `https://api.github.com/repos/${owner}/${repo}/issues?labels=${labelQuery}&state=all&per_page=100`;

      const headers: Record<string, string> = await this.getHeaders(settings.githubToken);
      const cacheKey = settings.storageRepo + ':' + (urlHash || 'all');
      const lastEtag = this.etagByUrlHash.get(cacheKey);
      if (lastEtag) {
        headers['If-None-Match'] = lastEtag;
      }

      const directRes = await fetch(directUrl, { headers });

      if (directRes.status === 304) {
        // 304 Not Modified: cache is 100% up to date, return immediately
        return cached;
      }

      let rawIssues: any[] = [];
      if (directRes.ok) {
        const newEtag = directRes.headers.get('ETag');
        if (newEtag) {
          this.etagByUrlHash.set(cacheKey, newEtag);
        }
        rawIssues = await directRes.json();
      } else {
        // Fallback to Search API if direct query fails
        const searchQuery = isAllPages ? `repo:${owner}/${repo} label:commyweb` : `repo:${owner}/${repo} label:commyweb "${urlHash}"`;
        const searchRes = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`, {
          headers: await this.getHeaders(settings.githubToken)
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          rawIssues = searchData.items || [];
        }
      }

      const remoteComments: WebComment[] = [];

      for (const item of rawIssues) {
        try {
          const match = item.body?.match(/<!-- COMMYWEB_DATA\s*([\s\S]*?)\s*-->/);
          if (match && match[1]) {
            const parsed: WebComment = JSON.parse(match[1]);
            parsed.status = item.state === 'closed' ? 'resolved' : 'open';
            parsed.issueNumber = item.number;
            parsed.issueUrl = item.html_url;
            remoteComments.push(parsed);
          }
        } catch {
          // ignore corrupted items
        }
      }

      // Preserve local resolved state to prevent GitHub slow replication from un-resolving
      const cachedMap = new Map(cached.map(c => [c.id, c]));
      for (const r of remoteComments) {
        const local = cachedMap.get(r.id);
        if (local && local.status === 'resolved' && r.status === 'open') {
          r.status = 'resolved';
        }
      }

      // Merge remote comments with any locally pending comments
      const merged: WebComment[] = [...remoteComments];
      for (const c of cached) {
        if (!merged.some(r => r.id === c.id)) {
          merged.push(c);
        }
      }

      // Sort comments chronologically: NEWEST FIRST (Derniers commentaires en priorité)
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Update local cache per urlHash
      if (isAllPages) {
        const byUrl = new Map<string, WebComment[]>();
        for (const c of merged) {
          if (!byUrl.has(c.urlHash)) byUrl.set(c.urlHash, []);
          byUrl.get(c.urlHash)!.push(c);
        }
        for (const [hash, list] of byUrl.entries()) {
          await CacheManager.saveCommentsForUrl(hash, list);
        }
      } else {
        await CacheManager.saveCommentsForUrl(urlHash!, merged);
      }

      return merged;
    } catch (e) {
      console.warn('[Commyweb] Failed to fetch comments from GitHub, using cache:', e);
      return cached;
    }
  }

  /**
   * Save a new comment to GitHub and local cache
   */
  static async saveComment(settings: UserSettings, comment: WebComment): Promise<{ success: boolean; error?: string; issueNumber?: number }> {
    if (this.savingCommentIds.has(comment.id)) {
      return { success: true };
    }
    this.savingCommentIds.add(comment.id);

    // Save to local cache first for instant local feedback
    await CacheManager.addComment(comment);

    if (!settings.githubToken || !settings.storageRepo) {
      this.savingCommentIds.delete(comment.id);
      return {
        success: false,
        error: 'Projet GitHub non configuré : le commentaire est enregistré uniquement en local.'
      };
    }

    try {
      const repoInfo = parseGitHubRepo(settings.storageRepo);
      if (!repoInfo) {
        return {
          success: false,
          error: `Format de dépôt GitHub invalide : "${settings.storageRepo}". Attendu: owner/repo ou URL GitHub (ex: kiou98/Commyweb).`
        };
      }
      const { owner, repo } = repoInfo;

      const title = `[Commyweb] ${comment.urlHash} - ${comment.author.name || comment.author.username} commented on ${comment.anchor.textSnippet || comment.url}`;
      const payload = JSON.stringify(comment, null, 2);
      const body = `### Commyweb Comment on ${comment.url}\n\n` +
        `**Author:** @${comment.author.name || comment.author.username}\n\n` +
        `> ${comment.content}\n\n` +
        `<!-- COMMYWEB_DATA\n${payload}\n-->`;

      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: await this.getHeaders(settings.githubToken),
        body: JSON.stringify({
          title,
          body,
          labels: ['commyweb', comment.urlHash]
        })
      });

      if (res.ok) {
        const issue = await res.json();
        comment.issueNumber = issue.number;
        comment.issueUrl = issue.html_url;

        // Invalidate ETag so next poll fetches fresh state immediately
        this.etagByUrlHash.delete(settings.storageRepo + ':' + comment.urlHash);
        this.etagByUrlHash.delete(settings.storageRepo + ':all');

        // Update cache with issue info
        const cachedList = await CacheManager.getCommentsForUrl(comment.urlHash);
        const idx = cachedList.findIndex(c => c.id === comment.id);
        if (idx >= 0) {
          cachedList[idx] = comment;
          await CacheManager.saveCommentsForUrl(comment.urlHash, cachedList);
        }
        return { success: true, issueNumber: issue.number };
      } else {
        const errText = await res.text();
        console.error('[Commyweb] GitHub API error creating issue:', res.status, errText);
        return {
          success: false,
          error: `Erreur GitHub (${res.status}) lors de l'enregistrement sur ${owner}/${repo}`
        };
      }
    } catch (e: any) {
      console.error('[Commyweb] Error syncing comment with GitHub:', e);
      return {
        success: false,
        error: e.message || 'Erreur réseau lors de la synchronisation avec GitHub'
      };
    } finally {
      this.savingCommentIds.delete(comment.id);
    }
  }

  /**
   * Update existing comment on GitHub (e.g. anchor repositioning)
   */
  static async updateCommentAnchor(settings: UserSettings, comment: WebComment): Promise<void> {
    if (!settings.githubToken || !settings.storageRepo || !comment.issueNumber) return;

    try {
      const repoInfo = parseGitHubRepo(settings.storageRepo);
      if (!repoInfo) return;
      const { owner, repo } = repoInfo;

      const payload = JSON.stringify(comment, null, 2);
      const body = `### Commyweb Comment on ${comment.url}\n\n` +
        `**Author:** @${comment.author.name || comment.author.username}\n\n` +
        `> ${comment.content}\n\n` +
        `<!-- COMMYWEB_DATA\n${payload}\n-->`;

      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${comment.issueNumber}`, {
        method: 'PATCH',
        headers: await this.getHeaders(settings.githubToken),
        body: JSON.stringify({ body })
      });
    } catch (e) {
      console.error('[Commyweb] Error updating issue anchor on GitHub:', e);
    }
  }

  /**
   * Add a reply to an existing comment
   */
  static async addReply(settings: UserSettings, commentId: string, urlHash: string, reply: CommentReply): Promise<void> {
    const comments = await CacheManager.getCommentsForUrl(urlHash);
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return;

    if (!comment.replies) comment.replies = [];
    comment.replies.push(reply);
    await CacheManager.saveCommentsForUrl(urlHash, comments);

    this.etagByUrlHash.delete(settings.storageRepo + ':' + urlHash);
    this.etagByUrlHash.delete(settings.storageRepo + ':all');

    if (!settings.githubToken || !settings.storageRepo || !comment.issueNumber) return;

    try {
      const repoInfo = parseGitHubRepo(settings.storageRepo);
      if (!repoInfo) return;
      const { owner, repo } = repoInfo;

      // 1. Post comment reply to GitHub issue discussion
      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${comment.issueNumber}/comments`, {
        method: 'POST',
        headers: await this.getHeaders(settings.githubToken),
        body: JSON.stringify({
          body: `**@${reply.author.name || reply.author.username}** replied:\n\n> ${reply.content}`
        })
      });

      // 2. Update issue body with new serialized comment state (including all replies)
      const payload = JSON.stringify(comment, null, 2);
      const body = `### Commyweb Comment on ${comment.url}\n\n` +
        `**Author:** @${comment.author.name || comment.author.username}\n\n` +
        `> ${comment.content}\n\n` +
        `<!-- COMMYWEB_DATA\n${payload}\n-->`;

      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${comment.issueNumber}`, {
        method: 'PATCH',
        headers: await this.getHeaders(settings.githubToken),
        body: JSON.stringify({ body })
      });
    } catch (e) {
      console.error('[Commyweb] Error syncing reply with GitHub:', e);
    }
  }

  /**
   * Toggle resolve state
   */
  static async toggleResolve(settings: UserSettings, commentId: string, urlHash: string): Promise<boolean> {
    const comments = await CacheManager.getCommentsForUrl(urlHash);
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return false;

    comment.status = comment.status === 'resolved' ? 'open' : 'resolved';
    await CacheManager.saveCommentsForUrl(urlHash, comments);

    this.etagByUrlHash.delete(settings.storageRepo + ':' + urlHash);
    this.etagByUrlHash.delete(settings.storageRepo + ':all');

    if (settings.githubToken && settings.storageRepo && comment.issueNumber) {
      try {
        const repoInfo = parseGitHubRepo(settings.storageRepo);
        if (repoInfo) {
          const { owner, repo } = repoInfo;
          const state = comment.status === 'resolved' ? 'closed' : 'open';
          await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${comment.issueNumber}`, {
            method: 'PATCH',
            headers: await this.getHeaders(settings.githubToken),
            body: JSON.stringify({ state })
          });
        }
      } catch (e) {
        console.error('[Commyweb] Error updating issue state on GitHub:', e);
      }
    }

    return comment.status === 'resolved';
  }
}
