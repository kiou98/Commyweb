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

      // Query issues with label "commyweb" and urlHash
      const query = `repo:${owner}/${repo} label:commyweb "${urlHash}"`;
      const res = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=100`, {
        headers: await this.getHeaders(settings.githubToken)
      });

      if (!res.ok) {
        return CacheManager.getCommentsForUrl(urlHash);
      }

      const data = await res.json();
      const comments: WebComment[] = [];

      for (const item of data.items || []) {
        try {
          // Commyweb embeds comment JSON inside issue body enclosed in <!-- COMMYWEB_DATA ... -->
          const match = item.body.match(/<!-- COMMYWEB_DATA\s*([\s\S]*?)\s*-->/);
          if (match && match[1]) {
            const parsed: WebComment = JSON.parse(match[1]);
            // Status aligned with issue state
            parsed.status = item.state === 'closed' ? 'resolved' : 'open';
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

      const title = `[Commyweb] ${comment.urlHash} - ${comment.author.username} commented on ${comment.anchor.textSnippet || comment.url}`;
      const payload = JSON.stringify(comment, null, 2);
      const body = `### Commyweb Comment on ${comment.url}\n\n` +
        `**Author:** @${comment.author.username}\n\n` +
        `> ${comment.content}\n\n` +
        `<!-- COMMYWEB_DATA\n${payload}\n-->`;

      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: await this.getHeaders(settings.githubToken),
        body: JSON.stringify({
          title,
          body,
          labels: ['commyweb', comment.urlHash]
        })
      });
    } catch (e) {
      console.error('[Commyweb] Error syncing comment with GitHub:', e);
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

    if (!settings.githubToken || !settings.storageRepo) return;

    // Optional: could push reply comment to GitHub issue if issue number stored
  }

  /**
   * Toggle resolve state
   */
  static async toggleResolve(_settings: UserSettings, commentId: string, urlHash: string): Promise<boolean> {
    const comments = await CacheManager.getCommentsForUrl(urlHash);
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return false;

    comment.status = comment.status === 'resolved' ? 'open' : 'resolved';
    await CacheManager.saveCommentsForUrl(urlHash, comments);
    return comment.status === 'resolved';
  }
}
