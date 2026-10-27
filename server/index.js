import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const project = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.nes': 'application/octet-stream' };
const text = (value, max, fallback) => typeof value === 'string' ? value.trim().slice(0, max) || fallback : fallback;

export function createRetroServer({ root = path.join(project, 'dist'), allowedOrigins = [], iceServers = [], maxClients = 200 } = {}) {
  const rooms = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, version: 1 }));
    }
    try {
      const pathname = decodeURIComponent(url.pathname);
      const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(path.resolve(root) + path.sep) || !(await stat(target)).isFile()) throw new Error('not found');
      res.writeHead(200, { 'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Cache-Control': 'no-cache' });
      res.end(await readFile(target));
    } catch { res.writeHead(404); res.end('Niet gevonden'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (req.url !== '/ws' || wss.clients.size >= maxClients ||
        (allowedOrigins.length && !allowedOrigins.includes(origin))) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const send = (ws, message) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  const listing = () => [...rooms.values()].filter(r => r.public).map(r => ({
    id: r.id, title: r.title, host: r.hostName, game: r.game, console: 'NES',
    players: r.guest ? 2 : 1, status: r.status, created: r.created,
  }));
  const broadcast = () => { for (const ws of wss.clients) send(ws, { type: 'rooms', rooms: listing() }); };
  function leave(ws) {
    const room = rooms.get(ws.roomId);
    ws.roomId = null;
    if (!room) return;
    if (room.host === ws) {
      rooms.delete(room.id);
      if (room.guest) { room.guest.roomId = null; send(room.guest, { type: 'room-closed' }); }
    } else if (room.guest === ws) {
      room.guest = null; room.status = 'waiting';
      send(room.host, { type: 'guest-left' });
    }
    broadcast();
  }
  wss.on('connection', ws => {
    ws.alive = true; ws.count = 0; ws.countSince = Date.now();
    send(ws, { type: 'welcome', iceServers: typeof iceServers === 'function' ? iceServers() : iceServers });
    send(ws, { type: 'rooms', rooms: listing() });
    ws.on('pong', () => { ws.alive = true; });
    ws.on('close', () => leave(ws));
    ws.on('error', () => {});
    ws.on('message', (raw, binary) => {
      try {
        if (Date.now() - ws.countSince > 10000) { ws.count = 0; ws.countSince = Date.now(); }
        if (++ws.count > 120) return ws.close(1008, 'Te veel verzoeken');
        if (binary) throw new Error('Alleen verbindingsgegevens toegestaan.');
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== 'object') throw new Error('Ongeldig verzoek.');
        const room = rooms.get(ws.roomId);
        if (msg.type === 'list') return send(ws, { type: 'rooms', rooms: listing() });
        if (msg.type === 'create') {
          if (room) throw new Error('Verlaat eerst je huidige kamer.');
          let id;
          do { id = randomBytes(5).toString('hex').toUpperCase(); } while (rooms.has(id));
          const created = { id, host: ws, guest: null, public: msg.public === true,
            hostName: text(msg.name, 24, 'Speler 1'), title: text(msg.title, 48, 'Gezellig samen spelen'),
            game: text(msg.game, 80, 'NES-game'), status: 'waiting', created: Date.now() };
          rooms.set(id, created); ws.roomId = id;
          send(ws, { type: 'created', id }); broadcast(); return;
        }
        if (msg.type === 'join') {
          if (room) throw new Error('Verlaat eerst je huidige kamer.');
          const target = rooms.get(String(msg.id).toUpperCase());
          if (!target) throw new Error('Deze kamer bestaat niet meer.');
          if (target.guest) throw new Error('Deze kamer zit al vol.');
          target.guest = ws; ws.roomId = target.id;
          send(ws, { type: 'joined', id: target.id, host: target.hostName, game: target.game, title: target.title });
          send(target.host, { type: 'guest-joined', name: text(msg.name, 24, 'Speler 2') });
          broadcast(); return;
        }
        if (msg.type === 'leave') { leave(ws); send(ws, { type: 'left' }); return; }
        if (msg.type === 'status' && room?.host === ws) {
          if (['waiting', 'playing', 'paused'].includes(msg.status)) room.status = msg.status;
          broadcast(); return;
        }
        if (msg.type === 'signal' && room) {
          const data = msg.data;
          if (!data || !['offer', 'answer', 'candidate'].includes(data.type)) throw new Error('Ongeldig verbindingsbericht.');
          if (JSON.stringify(data).length > 50000) throw new Error('Verbindingsbericht te groot.');
          send(room.host === ws ? room.guest : room.host, { type: 'signal', data }); return;
        }
        throw new Error('Onbekend verzoek.');
      } catch (err) { send(ws, { type: 'error', message: err.message || 'Verzoek mislukt.' }); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 15000);
  heartbeat.unref();
  return { server, wss, rooms, close: async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.ICE_SERVERS_JSON) iceServers = JSON.parse(process.env.ICE_SERVERS_JSON);
  const getIceServers = () => {
    if (!process.env.TURN_SECRET || !process.env.TURN_URLS) return iceServers;
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${randomBytes(6).toString('hex')}`;
    const credential = createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    return [...iceServers, { urls: process.env.TURN_URLS.split(',').map(url => url.trim()).filter(Boolean), username, credential }];
  };
  const app = createRetroServer({ allowedOrigins, iceServers: getIceServers });
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`RetroRoom: http://localhost:${port}`));
  const stop = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
