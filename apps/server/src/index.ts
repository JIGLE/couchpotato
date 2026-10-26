import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ClientToServer, ServerToClient, Screen } from '@couchpotato/shared';
import { RoomStore } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const here = path.dirname(fileURLToPath(import.meta.url));
// In the container the built web app sits next to the server; in dev Vite serves it.
const WEB_DIR = process.env.WEB_DIR ?? path.resolve(here, '../../web/dist');

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

const VERSION = (process.env.APP_VERSION ?? 'dev').slice(0, 12);
app.get('/healthz', async () => ({ ok: true, version: VERSION }));
app.log.info({ version: VERSION }, 'starting couch potato');

if (existsSync(WEB_DIR)) {
  await app.register(fastifyStatic, { root: WEB_DIR, wildcard: false });
  // Single-page app: /tv, /join and friends all load index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/ws')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'not found' });
  });
} else {
  app.log.warn(`No web build at ${WEB_DIR} — run the Vite dev server for the UI.`);
}

const io = new Server<ClientToServer, ServerToClient>(app.server, {
  path: '/ws',
  // Short pings keep the socket alive well inside Cloudflare's ~100 s idle timeout.
  pingInterval: 20_000,
  pingTimeout: 15_000,
  cors: { origin: process.env.CORS_ORIGIN ?? false },
});

// ---- Rooms: each TV gets its own 4-letter room; phones join by code. ----
const rooms = new RoomStore();
const members = new Map<string, { screen: Screen; name?: string; code: string }>();

function broadcastPresence(code: string) {
  let tvs = 0;
  let phones = 0;
  for (const m of members.values()) {
    if (m.code !== code) continue;
    if (m.screen === 'tv') tvs++;
    else phones++;
  }
  io.to(code).emit('presence', { tvs, phones });
}

io.on('connection', (socket) => {
  socket.on('hello', ({ screen, code, name }) => {
    if (members.has(socket.id)) return; // one hello per connection
    if (screen !== 'tv' && screen !== 'phone') return;

    let room = code ? rooms.get(code) : undefined;
    if (screen === 'tv' && !room) {
      room = rooms.create();
      socket.emit('room:created', { code: room.code });
    }
    if (!room) {
      socket.emit('room:error', { reason: code ? 'not-found' : 'bad-request', code: code ?? '' });
      return;
    }

    rooms.join(room.code, socket.id);
    members.set(socket.id, { screen, name: name?.trim().slice(0, 20) || undefined, code: room.code });
    socket.join(room.code);
    socket.emit('room:joined', { code: room.code });
    socket.emit('tap:count', { count: room.taps, lastBy: room.lastTapBy });
    broadcastPresence(room.code);
  });

  socket.on('tap', () => {
    const me = members.get(socket.id);
    if (me?.screen !== 'phone') return;
    const room = rooms.get(me.code);
    if (!room) return;
    room.taps += 1;
    room.lastTapBy = me.name ?? 'someone';
    io.to(room.code).emit('tap:count', { count: room.taps, lastBy: room.lastTapBy });
  });

  socket.on('disconnect', () => {
    const me = members.get(socket.id);
    if (!me) return;
    members.delete(socket.id);
    rooms.leave(me.code, socket.id);
    broadcastPresence(me.code);
  });
});

// Clear out rooms nobody has used for 30 minutes.
setInterval(() => {
  const removed = rooms.sweep();
  if (removed.length) app.log.info({ removed }, 'expired empty rooms');
}, 60_000).unref();

await app.listen({ port: PORT, host: HOST });
