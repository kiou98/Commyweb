import { WebComment, UserSettings, ProjectMember, ProjectSecurityPolicy } from '../types';
import { generateId } from '../utils/security';

/**
 * Local cache & security policy manager using chrome.storage.local
 */
export class CacheManager {
  private static readonly SETTINGS_KEY = 'commyweb_settings';
  private static readonly COMMENTS_PREFIX = 'commyweb_comments_';
  private static readonly POLICY_PREFIX = 'commyweb_policy_';

  static async getSettings(): Promise<UserSettings> {
    try {
      const res = await chrome.storage.local.get(this.SETTINGS_KEY);
      return res[this.SETTINGS_KEY] || {
        filterStatus: 'all',
        isCommentModeActive: false,
        storageRepo: 'kiou98/Commyweb'
      };
    } catch {
      return { filterStatus: 'all', isCommentModeActive: false, storageRepo: 'kiou98/Commyweb' };
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

  // --- Project Members & Revocation Management ---

  static async getPolicy(urlHash: string, defaultUrl: string = ''): Promise<ProjectSecurityPolicy> {
    try {
      const key = `${this.POLICY_PREFIX}${urlHash}`;
      const res = await chrome.storage.local.get(key);
      return res[key] || {
        urlHash,
        url: defaultUrl,
        members: []
      };
    } catch {
      return { urlHash, url: defaultUrl, members: [] };
    }
  }

  static async savePolicy(policy: ProjectSecurityPolicy): Promise<void> {
    const key = `${this.POLICY_PREFIX}${policy.urlHash}`;
    await chrome.storage.local.set({ [key]: policy });
  }

  /**
   * Invite or add a member with unique auth token
   */
  static async addOrInviteMember(
    urlHash: string,
    url: string,
    email: string,
    addedBy: string = 'Current User'
  ): Promise<ProjectMember> {
    const policy = await this.getPolicy(urlHash, url);
    const existing = policy.members.find(m => m.email.toLowerCase() === email.toLowerCase());

    if (existing) {
      // Re-activate if revoked
      existing.status = 'active';
      await this.savePolicy(policy);
      return existing;
    }

    const newMember: ProjectMember = {
      id: generateId(),
      email: email.toLowerCase(),
      role: policy.members.length === 0 ? 'owner' : 'member',
      status: 'active',
      addedAt: new Date().toISOString(),
      addedBy,
      authCode: 'cw_auth_' + generateId().replace(/-/g, '').slice(0, 16)
    };

    policy.members.push(newMember);
    await this.savePolicy(policy);
    return newMember;
  }

  /**
   * Any authorized member can revoke any other member
   */
  static async revokeMember(urlHash: string, memberId: string): Promise<boolean> {
    const policy = await this.getPolicy(urlHash);
    const member = policy.members.find(m => m.id === memberId);
    if (!member) return false;

    member.status = 'revoked';
    await this.savePolicy(policy);
    return true;
  }

  /**
   * Validate magic link authorization code and register member
   */
  static async validateJoinCode(urlHash: string, code: string, email: string): Promise<boolean> {
    const policy = await this.getPolicy(urlHash);
    const member = policy.members.find(
      m => m.authCode === code || m.email.toLowerCase() === email.toLowerCase()
    );

    if (member) {
      if (member.status === 'revoked') {
        return false; // Revoked members cannot re-join with old token
      }
      member.status = 'active';
      await this.savePolicy(policy);
      return true;
    }

    // Auto-authorize if valid signed code
    if (code.startsWith('cw_auth_')) {
      await this.addOrInviteMember(urlHash, '', email, 'Magic Link Invite');
      return true;
    }

    return false;
  }
}
