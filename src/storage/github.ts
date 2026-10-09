import { WebComment, Author, UserSettings, CommentReply } from '../types';
import { CacheManager } from './cache';

/**
 * GitHub API client providing a zero-database backend
 * Uses GitHub Issues as collaborative thread storage
 */
export class GitHubBackend {
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
   * Fetch all comments for a given URL hash from GitHub repository
   * Uses direct issues endpoint with labels for zero search indexing latency
   */
  static async fetchComments(settings: UserSettings, urlHash: string): Promise<WebComment[]> {
    if (!settings.githubToken || !settings.storageRepo) {
      return CacheManager.getCommentsForUrl(urlHash);
    }

    try {
      const [owner, repo] = settings.storageRepo.split('/');
      if (!owner || !repo) {
        return CacheManager.getCommentsForUrl(urlHash);
      }

      // Query direct issues API by labels (commyweb + urlHash)
      // This is instant and does NOT suffer from search indexing delay
      let rawIssues: any[] = [];
      const directUrl = `https://api.github.com/repos/${owner}/${repo}/issues?labels=commyweb,${encodeURIComponent(urlHash)}&state=all&per_page=100`;
      const directRes = await fetch(directUrl, {
        headers: await this.getHeaders(settings.githubToken)
      });

      if (directRes.ok) {
        rawIssues = await directRes.json();
      } else {
        // Fallback to Search API if direct query fails
        const query = `repo:${owner}/${repo} label:commyweb "${urlHash}"`;
        const searchRes = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=100`, {
          headers: await this.getHeaders(settings.githubToken)
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          rawIssues = searchData.items || [];
        }
      }

      const comments: WebComment[] = [];

      for (const item of rawIssues) {
        try {
          // Commyweb embeds comment JSON inside issue body enclosed in <!-- COMMYWEB_DATA ... -->
          const match = item.body?.match(/<!-- COMMYWEB_DATA\s*([\s\S]*?)\s*-->/);
          if (match && match[1]) {
            const parsed: WebComment = JSON.parse(match[1]);
            // Status aligned with issue state
            parsed.status = item.state === 'closed' ? 'resolved' : 'open';
            parsed.issueNumber = item.number;
            parsed.issueUrl = item.html_url;
            comments.push(parsed);
          }
        } catch {
          // ignore corrupted items
        }
      }

      // Update local cache
      await CacheManager.saveCommentsForUrl(urlHash, comments);
      return comments;
    } catch (e) {
      console.warn('[Commyweb] Failed to fetch comments from GitHub, using cache:', e);
      return CacheManager.getCommentsForUrl(urlHash);
    }
  }

  /**
   * Save a new comment to GitHub and local cache
   */
  static async saveComment(settings: UserSettings, comment: WebComment): Promise<void> {
    // Save to local cache first for instant feedback
    await CacheManager.addComment(comment);

    if (!settings.githubToken || !settings.storageRepo) {
      return;
    }

    try {
      const [owner, repo] = settings.storageRepo.split('/');
      if (!owner || !repo) return;

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

        // Update cache with issue info
        const cachedList = await CacheManager.getCommentsForUrl(comment.urlHash);
        const idx = cachedList.findIndex(c => c.id === comment.id);
        if (idx >= 0) {
          cachedList[idx] = comment;
          await CacheManager.saveCommentsForUrl(comment.urlHash, cachedList);
        }
      }
    } catch (e) {
      console.error('[Commyweb] Error syncing comment with GitHub:', e);
    }
  }

  /**
   * Update existing comment on GitHub (e.g. anchor repositioning)
   */
  static async updateCommentAnchor(settings: UserSettings, comment: WebComment): Promise<void> {
    if (!settings.githubToken || !settings.storageRepo || !comment.issueNumber) return;

    try {
      const [owner, repo] = settings.storageRepo.split('/');
      if (!owner || !repo) return;

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

    if (!settings.githubToken || !settings.storageRepo || !comment.issueNumber) return;

    try {
      const [owner, repo] = settings.storageRepo.split('/');
      if (!owner || !repo) return;

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

    if (settings.githubToken && settings.storageRepo && comment.issueNumber) {
      try {
        const [owner, repo] = settings.storageRepo.split('/');
        if (owner && repo) {
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
