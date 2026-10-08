/**
 * Security utilities: Anti-XSS escaping, URL normalization, and safe DOM manipulation.
 */

/**
 * Escapes raw strings to prevent HTML injection/XSS
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Normalizes web URLs by removing tracking query params and anchor hashes
 * so comments on the same page are unified regardless of UTM tags.
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // Keep protocol, host, and pathname
    // Remove UTM and analytics trackers
    const paramsToRemove = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid'
    ];
    paramsToRemove.forEach(p => url.searchParams.delete(p));
    
    // Sort parameters for consistency
    url.searchParams.sort();
    
    // Strip trailing slash if pathname is more than '/'
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    const search = url.searchParams.toString();
    return `${url.origin}${path}${search ? `?${search}` : ''}`;
  } catch {
    return rawUrl.split('#')[0];
  }
}

/**
 * Generates a consistent hash string (simple fast DJB2-based or SHA-like) for the URL
 */
export function hashUrl(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) + hash) + url.charCodeAt(i);
    hash |= 0;
  }
  return 'cw_' + Math.abs(hash).toString(36);
}

/**
 * Generates a collision-resistant UUID v4
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generates a consistent, distinct, vibrant color for a user based on their name or ID
 */
export function getUserColor(identifier: string): string {
  if (!identifier) return '#18181b';
  const palette = [
    '#2563eb', // Blue
    '#7c3aed', // Purple
    '#db2777', // Pink
    '#ea580c', // Orange
    '#059669', // Emerald
    '#0891b2', // Cyan
    '#d97706', // Amber
    '#4f46e5', // Indigo
    '#e11d48', // Rose
    '#0d9488', // Teal
  ];
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

