import { RealtimeConfig } from '../types';

export function realtimeEndpoint(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && loopback)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname === '/') url.pathname = '/sync';
    return url.href;
  } catch { return null; }
}

export function normalizeRealtime(value: unknown): RealtimeConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as RealtimeConfig;
  if (typeof config.endpoint !== 'string' || typeof config.channel !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(config.channel)) return null;
  const endpoint = realtimeEndpoint(config.endpoint);
  return endpoint ? { endpoint, channel: config.channel } : null;
}

export function newRealtimeChannel(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
