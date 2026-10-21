import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Stateless invalidation relay: no tokens, repository names or comment bodies. */
export function createRelay({ host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000) } = {}) {
  const channels = new Map();
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"ok":true}');
    } else { response.writeHead(404); response.end(); }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/sync' || sockets.clients.size >= 1000) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client));
  });
  sockets.on('connection', client => {
    let channel;
    let lastPublished = 0;
    const handshake = setTimeout(() => client.close(1008, 'Subscription required'), 8000);
    client.on('error', () => {});
    client.on('message', (bytes, binary) => {
      if (binary) { client.close(1008, 'JSON text required'); return; }
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { client.close(1008, 'Invalid JSON'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { client.close(1008, 'Invalid message'); return; }
      if (!channel) {
        if (message.type !== 'subscribe' || typeof message.channel !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(message.channel)) {
          client.close(1008, 'Invalid channel'); return;
        }
        channel = message.channel;
        if (!channels.has(channel)) channels.set(channel, new Set());
        channels.get(channel).add(client);
        clearTimeout(handshake);
        client.send('{"type":"ready"}');
      } else if (message.type === 'ping') client.send('{"type":"pong"}');
      else if (message.type === 'changed') {
        // Coalesce bursts, without retaining or forwarding caller-supplied payloads.
        if (Date.now() - lastPublished < 100) return;
        lastPublished = Date.now();
        for (const subscriber of channels.get(channel) || []) {
          if (subscriber !== client && subscriber.readyState === WebSocket.OPEN) subscriber.send('{"type":"changed"}');
        }
      } else client.close(1008, 'Unknown message');
    });
    client.on('close', () => {
      clearTimeout(handshake);
      if (channel) {
        const subscribers = channels.get(channel);
        subscribers?.delete(client);
        if (!subscribers?.size) channels.delete(channel);
      }
    });
  });
  return {
    async start() {
      await new Promise((done, reject) => { server.once('error', reject); server.listen(port, host, done); });
      return server.address();
    },
    async close() {
      for (const client of sockets.clients) client.terminate();
      await new Promise(done => sockets.close(done));
      await new Promise(done => server.close(done));
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const relay = createRelay();
  const address = await relay.start();
  console.log(`Commyweb relay listening on ${address.address}:${address.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await relay.close(); process.exit(0); });
}
