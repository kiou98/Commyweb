import { WebComment, UserSettings, ProjectMember, ProjectSecurityPolicy, SiteProject } from '../types';
import { generateId, extractDomain } from '../utils/security';
import { parseGitHubRepo } from '../utils/github-parser';
import { normalizeRealtime } from '../utils/realtime';

/**
 * Local cache & security policy manager using chrome.storage.local
 */
export class CacheManager {
  private static readonly SETTINGS_KEY = 'commyweb_settings';
  private static readonly COMMENTS_PREFIX = 'commyweb_comments_';
  private static readonly POLICY_PREFIX = 'commyweb_policy_';
  private static writes = new Map<string, Promise<unknown>>();

  private static serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.writes.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    this.writes.set(key, next);
    void next.finally(() => {
      if (this.writes.get(key) === next) this.writes.delete(key);
    }).catch(() => {});
    return next;
  }

  static async getSettings(urlOrDomain?: string): Promise<UserSettings> {
    try {
      const res = await chrome.storage.local.get(this.SETTINGS_KEY);
      let settings: UserSettings = res[this.SETTINGS_KEY];

      // If local storage is empty or missing storageRepo/token, try to restore from chrome.storage.sync
      if (!settings) {
        try {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            const syncRes = await chrome.storage.sync.get(this.SETTINGS_KEY);
            if (syncRes && syncRes[this.SETTINGS_KEY]) {
              const syncSettings = syncRes[this.SETTINGS_KEY];
              settings = { ...syncSettings };
              await chrome.storage.local.set({ [this.SETTINGS_KEY]: settings });
            }
          }
        } catch {
          // sync may not be available in incognito or testing
        }
      }

      if (!settings) {
        settings = {
          filterStatus: 'all',
          isCommentModeActive: false,
          storageRepo: '',
          projectsByDomain: {}
        };
      }

      if (!settings.projectsByDomain) {
        settings.projectsByDomain = {};
      }

      // Normalize defaults before resolving a website; reads must never change defaults.
      if (settings.storageRepo) {
        settings.storageRepo = parseGitHubRepo(settings.storageRepo)?.fullName || settings.storageRepo;
      }

      // Resolve a website without persisting its credentials as global defaults.
      if (urlOrDomain) {
        const domain = extractDomain(urlOrDomain);
        if (domain && settings.projectsByDomain[domain]) {
          const siteProj = settings.projectsByDomain[domain];
          settings.storageRepo = siteProj.repo;
          settings.githubToken = siteProj.token ?? settings.githubToken;
          settings.realtime = normalizeRealtime(siteProj.realtime) || undefined;
        }
      }

      return settings;
    } catch {
      return { filterStatus: 'all', isCommentModeActive: false, storageRepo: '', projectsByDomain: {} };
    }
  }

  static async saveSettings(settings: Partial<UserSettings>): Promise<void> {
    return this.serialize(this.SETTINGS_KEY, () => this.writeSettings(settings));
  }

  private static async writeSettings(settings: Partial<UserSettings>): Promise<void> {
    const current = await this.getSettings();
    const cleanSettings: Partial<UserSettings> = {};
    for (const [key, val] of Object.entries(settings)) {
      if (val !== undefined) {
        (cleanSettings as any)[key] = val;
      }
    }
    if (cleanSettings.storageRepo) {
      const parsed = parseGitHubRepo(cleanSettings.storageRepo);
      if (parsed) {
        cleanSettings.storageRepo = parsed.fullName;
      }
    }
    const updated = { ...current, ...cleanSettings };
    await chrome.storage.local.set({ [this.SETTINGS_KEY]: updated });

    // Also persist in chrome.storage.sync so settings survive plugin reloads, updates and new folder installs
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        const { githubToken: _token, projectsByDomain, ...preferences } = updated;
        const safeProjects = Object.fromEntries(Object.entries(projectsByDomain || {}).map(([domain, project]) => {
          const { token: _projectToken, ...safeProject } = project;
          return [domain, safeProject];
        }));
        await chrome.storage.sync.set({ [this.SETTINGS_KEY]: { ...preferences, projectsByDomain: safeProjects } });
      }
    } catch {
      // ignore
    }
  }

  /**
   * Get project associated with a specific website domain
   */
  static async getSiteProject(domain: string): Promise<SiteProject | undefined> {
    const settings = await this.getSettings();
    const cleanDomain = extractDomain(domain);
    return settings.projectsByDomain?.[cleanDomain];
  }

  /**
   * Save or link a GitHub project repo to a specific website domain
   */
  static async saveSiteProject(project: SiteProject): Promise<void> {
    return this.serialize(this.SETTINGS_KEY, async () => {
    const cleanDomain = extractDomain(project.domain);
    if (!cleanDomain) return;

    const settings = await this.getSettings();
    if (!settings.projectsByDomain) {
      settings.projectsByDomain = {};
    }

    const parsed = parseGitHubRepo(project.repo);
    const cleanRepo = parsed ? parsed.fullName : project.repo.trim();

    settings.projectsByDomain[cleanDomain] = {
      domain: cleanDomain,
      repo: cleanRepo,
      name: project.name?.trim() || cleanDomain,
      token: project.token === undefined ? settings.projectsByDomain[cleanDomain]?.token : project.token.trim(),
      realtime: project.realtime === undefined && settings.projectsByDomain[cleanDomain]?.repo.toLowerCase() === cleanRepo.toLowerCase()
        ? settings.projectsByDomain[cleanDomain]?.realtime : normalizeRealtime(project.realtime),
      updatedAt: new Date().toISOString()
    };

    await this.writeSettings(settings);
    });
  }

  /**
   * Remove project association for a specific website domain
   */
  static async removeSiteProject(domain: string): Promise<void> {
    return this.serialize(this.SETTINGS_KEY, async () => {
    const cleanDomain = extractDomain(domain);
    const settings = await this.getSettings();
    if (settings.projectsByDomain && settings.projectsByDomain[cleanDomain]) {
      delete settings.projectsByDomain[cleanDomain];
      await this.writeSettings(settings);
    }
    });
  }

  /**
   * Retrieve all website projects
   */
  static async getAllSiteProjects(): Promise<SiteProject[]> {
    const settings = await this.getSettings();
    if (!settings.projectsByDomain) return [];
    return Object.values(settings.projectsByDomain);
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

  static async getAllComments(): Promise<WebComment[]> {
    try {
      const all = await chrome.storage.local.get(null);
      const allComments: WebComment[] = [];
      const seenIds = new Set<string>();
      for (const [key, val] of Object.entries(all)) {
        if (key.startsWith(this.COMMENTS_PREFIX) && Array.isArray(val)) {
          for (const comment of val) {
            if (!seenIds.has(comment.id)) {
              seenIds.add(comment.id);
              allComments.push(comment);
            }
          }
        }
      }
      allComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return allComments;
    } catch {
      return [];
    }
  }

  static async saveCommentsForUrl(urlHash: string, comments: WebComment[]): Promise<void> {
    const key = `${this.COMMENTS_PREFIX}${urlHash}`;
    await chrome.storage.local.set({ [key]: comments });
  }

  static async addComment(comment: WebComment): Promise<void> {
    return this.serialize(comment.urlHash, async () => {
    const comments = await this.getCommentsForUrl(comment.urlHash);
    const existingIndex = comments.findIndex(c => c.id === comment.id);
    if (existingIndex >= 0) {
      comments[existingIndex] = comment;
    } else {
      comments.push(comment);
    }
    await this.saveCommentsForUrl(comment.urlHash, comments);
    });
  }

  static belongsToProject(comment: WebComment, repo: string = ''): boolean {
    const issueRepo = comment.issueUrl?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\//)?.[1];
    return (comment.storageRepo || issueRepo || '').toLowerCase() === repo.toLowerCase();
  }

  static async saveProjectComments(urlHash: string, repo: string, comments: WebComment[]): Promise<void> {
    return this.serialize(urlHash, async () => {
      const existing = await this.getCommentsForUrl(urlHash);
      const others = existing.filter(c => !this.belongsToProject(c, repo));
      await this.saveCommentsForUrl(urlHash, [...others, ...comments]);
    });
  }

  static async mergeRemoteComments(urlHash: string, repo: string, remote: WebComment[], baseline?: WebComment[]): Promise<void> {
    return this.serialize(urlHash, async () => {
      const existing = await this.getCommentsForUrl(urlHash);
      const merged = new Map(remote.map(comment => [comment.id, comment]));
      for (const local of existing.filter(c => this.belongsToProject(c, repo))) {
        const shared = merged.get(local.id);
        const changedDuringFetch = baseline && JSON.stringify(local) !== JSON.stringify(baseline.find(c => c.id === local.id));
        if (!shared || local.pendingChanges?.length || !local.issueNumber || changedDuringFetch) {
          merged.set(local.id, { ...local,
            ...(!local.issueNumber && shared?.issueNumber ? { issueNumber: shared.issueNumber, issueUrl: shared.issueUrl } : {}) });
        }
      }
      await this.saveCommentsForUrl(urlHash, [...existing.filter(c => !this.belongsToProject(c, repo)), ...merged.values()]);
    });
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
      m => m.authCode === code && m.email.toLowerCase() === email.toLowerCase()
    );

    if (member) {
      if (member.status === 'revoked') {
        return false; // Revoked members cannot re-join with old token
      }
      member.status = 'active';
      await this.savePolicy(policy);
      return true;
    }

    return false;
  }
}
