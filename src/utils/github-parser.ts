/**
 * GitHub repository input parser and normalizer
 * Handles various user inputs: full URLs, SSH links, owner/repo, whitespace, trailing slashes, etc.
 */

export interface ParsedGitHubRepo {
  owner: string;
  repo: string;
  fullName: string;
}

export function parseGitHubRepo(input?: string | null, fallbackOwner?: string | null): ParsedGitHubRepo | null {
  if (!input) return null;
  let str = input.trim();
  if (!str) return null;

  // Remove surrounding quotes if any
  str = str.replace(/^["']|["']$/g, '').trim();

  // Strip trailing .git and trailing slashes
  str = str.replace(/\.git\/?$/i, '').replace(/\/+$/, '');

  // 1. Matches GitHub URLs (HTTPS, HTTP, SSH, www or no protocol)
  // e.g. https://github.com/owner/repo or git@github.com:owner/repo
  const urlMatch = str.match(/(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|git@github\.com:)([^/\s#?]+)\/([^/\s#?]+)/i);
  if (urlMatch) {
    const owner = urlMatch[1].trim();
    const repo = urlMatch[2].trim().replace(/\.git$/i, '');
    if (owner && repo) {
      return { owner, repo, fullName: `${owner}/${repo}` };
    }
  }

  // 2. Matches "owner/repo" with optional extra whitespace
  const parts = str.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    const [owner, repo] = parts;
    if (owner && repo && !owner.includes(' ') && !repo.includes(' ')) {
      return { owner, repo, fullName: `${owner}/${repo}` };
    }
  }

  // 3. Fallback: single word repo name if fallbackOwner is provided
  if (parts.length === 1 && fallbackOwner && fallbackOwner.trim()) {
    const repo = parts[0];
    const owner = fallbackOwner.trim();
    if (owner && repo && !repo.includes(' ') && !owner.includes(' ')) {
      return { owner, repo, fullName: `${owner}/${repo}` };
    }
  }

  return null;
}
