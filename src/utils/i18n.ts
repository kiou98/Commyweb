/**
 * Internationalization & Localization (i18n) Helper
 */

// Fallback dictionary if running outside extension context or testing
const FALLBACK_STRINGS: Record<string, string> = {
  appName: 'Commyweb - Figma-like Web Comments',
  appDescription: 'Collaborative, open-source commenting on any website like Figma (no database required)',
  actionTitle: 'Commyweb Comments',
  commandToggleComment: 'Toggle comment mode',
  commentMode: 'Comment Mode',
  clickToComment: 'Click anywhere to pin a comment',
  addComment: 'Add a comment...',
  reply: 'Reply...',
  send: 'Send',
  cancel: 'Cancel',
  resolve: 'Resolve',
  reopen: 'Reopen',
  resolved: 'Resolved',
  active: 'Active',
  filterAll: 'All',
  filterActive: 'Active',
  filterResolved: 'Resolved',
  noComments: 'No comments yet on this page. Be the first to leave one!',
  githubConnected: 'Connected as',
  githubConnect: 'Connect GitHub',
  githubRepo: 'Storage Repository',
  saveSettings: 'Save Settings',
  justNow: 'just now'
};

/**
 * Retrieves localized string by key using chrome.i18n with fallback
 */
export function t(key: string, substitutions?: string | string[]): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const msg = chrome.i18n.getMessage(key, substitutions);
      if (msg) return msg;
    }
  } catch {
    // ignore
  }
  return FALLBACK_STRINGS[key] || key;
}

/**
 * Formats an ISO date into international relative time (e.g. "5m ago", "il y a 2h")
 */
export function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);

    // If within 45 seconds
    if (Math.abs(diffSeconds) < 45) {
      return t('justNow');
    }

    const rtf = new Intl.RelativeTimeFormat(navigator.language || 'en', { numeric: 'auto' });

    const units: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
      { unit: 'year', seconds: 31536000 },
      { unit: 'month', seconds: 2592000 },
      { unit: 'week', seconds: 604800 },
      { unit: 'day', seconds: 86400 },
      { unit: 'hour', seconds: 3600 },
      { unit: 'minute', seconds: 60 }
    ];

    for (const { unit, seconds } of units) {
      if (Math.abs(diffSeconds) >= seconds || unit === 'minute') {
        const value = Math.round(diffSeconds / seconds);
        return rtf.format(value, unit);
      }
    }
  } catch {
    // Fallback simple date
    return new Date(isoString).toLocaleDateString();
  }
  return t('justNow');
}
