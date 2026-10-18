import { normalizeUrl } from './security';
import { parseGitHubRepo } from './github-parser';

export interface CommywebProjectConfig {
  repo?: string;
  email?: string;
  url: string;
  // Legacy fields are accepted by callers but never encoded or applied.
  token?: string;
  authCode?: string;
}

export function encodeProjectConfig(config: CommywebProjectConfig): string {
  try {
    const safe = { repo: parseGitHubRepo(config.repo)?.fullName, url: normalizeUrl(config.url) };
    if (!/^https?:\/\//.test(safe.url)) return '';
    const bytes = new TextEncoder().encode(JSON.stringify(safe));
    return btoa(String.fromCharCode(...bytes));
  } catch { return ''; }
}

export function decodeProjectConfig(encoded: string): CommywebProjectConfig | null {
  try {
    if (encoded.length > 16000) return null;
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
    if (typeof parsed.url !== 'string' || !/^https?:\/\//.test(parsed.url)) return null;
    const url = normalizeUrl(parsed.url);
    const repo = parseGitHubRepo(parsed.repo)?.fullName;
    if (parsed.repo && !repo) return null;
    return { url, repo };
  } catch { return null; }
}

export function projectLink(url: string, repo?: string): string {
  const normalized = normalizeUrl(url);
  const encoded = encodeProjectConfig({ url: normalized, repo });
  return encoded ? `${normalized}#commyweb_config=${encoded}` : normalized;
}
