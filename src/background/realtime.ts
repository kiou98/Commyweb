import { RealtimeConfig } from '../types';
import { normalizeRealtime } from '../utils/realtime';

type Status = 'connecting' | 'live' | 'reconnecting' | 'off';
type Session = {
  config: RealtimeConfig; socket?: WebSocket; status: Status; retry: number;
  reconnect?: ReturnType<typeof setTimeout>; heartbeat?: ReturnType<typeof setInterval>;
  expiry?: ReturnType<typeof setTimeout>; pending: boolean; stopped: boolean;
  lastMessage?: number;
};

/** The relay only exchanges invalidations. GitHub credentials and comments never enter it. */
export class RealtimeManager {
  private sessions = new Map<string, Session>();
  constructor(private changed: (config: RealtimeConfig) => void, private statusChanged: () => void = () => {}) {}

  private key(config: RealtimeConfig) { return `${config.endpoint}|${config.channel}`; }

  watch(raw?: RealtimeConfig): Status {
    const config = normalizeRealtime(raw);
    if (!config) return 'off';
    const key = this.key(config);
    let session = this.sessions.get(key);
    if (!session) {
      session = { config, status: 'connecting', retry: 0, pending: false, stopped: false };
      this.sessions.set(key, session);
      this.connect(session);
    }
    clearTimeout(session.expiry);
    session.expiry = setTimeout(() => { this.stop(session!); this.sessions.delete(key); }, 90000);
    return session.status;
  }

  publish(raw?: RealtimeConfig) {
    const config = normalizeRealtime(raw);
    if (!config) return;
    this.watch(config);
    const session = this.sessions.get(this.key(config))!;
    if (session.status === 'live' && session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({ type: 'changed' }));
    else session.pending = true;
  }

  private connect(session: Session) {
    if (session.stopped) return;
    let socket: WebSocket;
    try { socket = new WebSocket(session.config.endpoint, 'commyweb.v1'); }
    catch { this.retry(session); return; }
    session.socket = socket;
    const handshake = setTimeout(() => { if (session.status !== 'live') socket.close(); }, 8000);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'subscribe', channel: session.config.channel }));
    socket.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 1024) return;
      try {
        const message = JSON.parse(event.data);
        session.lastMessage = Date.now();
        if (message.type === 'ready' && session.status !== 'live') {
          clearTimeout(handshake);
          session.status = 'live'; session.retry = 0;
          session.heartbeat = setInterval(() => {
            if (Date.now() - (session.lastMessage || 0) > 45000) { socket.close(); return; }
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
          }, 20000);
          // Reconnects also refresh comments missed while disconnected.
          this.changed(session.config);
          this.statusChanged();
          if (session.pending) { session.pending = false; socket.send(JSON.stringify({ type: 'changed' })); }
        } else if (message.type === 'changed' && session.status === 'live') this.changed(session.config);
      } catch { /* Ignore malformed notifications. */ }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      clearTimeout(handshake); clearInterval(session.heartbeat);
      if (!session.stopped) this.retry(session);
    };
  }

  private retry(session: Session) {
    session.status = 'reconnecting';
    this.statusChanged();
    const delay = Math.min(30000, 500 * 2 ** Math.min(session.retry++, 6));
    session.reconnect = setTimeout(() => this.connect(session), delay);
  }

  private stop(session: Session) {
    session.stopped = true;
    clearTimeout(session.reconnect); clearTimeout(session.expiry); clearInterval(session.heartbeat);
    session.socket?.close();
  }

  closeAll() { for (const session of this.sessions.values()) this.stop(session); this.sessions.clear(); }
}
