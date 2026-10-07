import { WebComment, UserSettings } from '../types';

/**
 * Local cache manager using chrome.storage.local
 */
export class CacheManager {
  private static readonly SETTINGS_KEY = 'commyweb_settings';
  private static readonly COMMENTS_PREFIX = 'commyweb_comments_';

  static async getSettings(): Promise<UserSettings> {
    try {
      const res = await chrome.storage.local.get(this.SETTINGS_KEY);
      return res[this.SETTINGS_KEY] || {
        filterStatus: 'all',
        isCommentModeActive: false
      };
    } catch {
      return { filterStatus: 'all', isCommentModeActive: false };
    }
  }

  static async saveSettings(settings: Partial<UserSettings>): Promise<void> {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    await chrome.storage.local.set({ [this.SETTINGS_KEY]: updated });
  }

  static async getCommentsForUrl(urlHash: string): Promise<WebComment[]> {
    try {
      const key = `${this.COMMENTS_PREFIX}${urlHash}`;
      const res = await chrome.storage.local.get(key);
      return res[key] || [];
    } catch {
      return [];
    }
  }

  static async saveCommentsForUrl(urlHash: string, comments: WebComment[]): Promise<void> {
    const key = `${this.COMMENTS_PREFIX}${urlHash}`;
    await chrome.storage.local.set({ [key]: comments });
  }

  static async addComment(comment: WebComment): Promise<void> {
    const comments = await this.getCommentsForUrl(comment.urlHash);
    const existingIndex = comments.findIndex(c => c.id === comment.id);
    if (existingIndex >= 0) {
      comments[existingIndex] = comment;
    } else {
      comments.push(comment);
    }
    await this.saveCommentsForUrl(comment.urlHash, comments);
  }
}
