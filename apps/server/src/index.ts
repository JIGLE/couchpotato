import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ClientToServer, ServerToClient, Screen } from '@couchpotato/shared';
import { MAX_SEATS, RoomStore } from './rooms.js';
import { Couch } from './couch.js';

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
/** Seats per room. A seat survives the phone's connection; see couch.ts. */
const couches = new Map<string, Couch>();
/** What each live socket is: a TV or a phone, and in which room. */
const members = new Map<string, { screen: Screen; code: string }>();

function couchFor(code: string): Couch {
  let couch = couches.get(code);
  if (!couch) couches.set(code, (couch = new Couch()));
  return couch;
}

function broadcastRoom(code: string) {
  let tvs = 0;
  let phones = 0;
  for (const m of members.values()) {
    if (m.code !== code) continue;
    if (m.screen === 'tv') tvs++;
    else phones++;
  }
  io.to(code).emit('presence', { tvs, phones });
  io.to(code).emit('room:players', { players: couchFor(code).list(), seats: MAX_SEATS });
}

io.on('connection', (socket) => {
  socket.on('hello', ({ screen, code, name, colour, token }) => {
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

    let joined: { code: string; playerId?: string; token?: string } = { code: room.code };
    if (screen === 'phone') {
      const sat = couchFor(room.code).sit(token, socket.id, name?.trim().slice(0, 20) || 'Potato', colour);
      if (!sat.ok) {
        socket.emit('room:error', { reason: 'full', code: room.code });
        return;
      }
      joined = { code: room.code, playerId: sat.player.id, token: sat.token };
    }

    rooms.join(room.code, socket.id);
    members.set(socket.id, { screen, code: room.code });
    socket.join(room.code);
    socket.emit('room:joined', joined);
    socket.emit('tap:count', { count: room.taps, lastBy: room.lastTapBy, lastById: null });
    broadcastRoom(room.code);
  });

  socket.on('tap', () => {
    const me = members.get(socket.id);
    if (me?.screen !== 'phone') return;
    const room = rooms.get(me.code);
    const player = couchFor(me.code).player(socket.id);
    if (!room || !player) return;
    room.taps += 1;
    room.lastTapBy = player.name;
    io.to(room.code).emit('tap:count', { count: room.taps, lastBy: room.lastTapBy, lastById: player.id });
  });

  socket.on('leave', () => {
    const me = members.get(socket.id);
    if (me?.screen !== 'phone') return;
    couchFor(me.code).leave(socket.id);
    members.delete(socket.id);
    rooms.leave(me.code, socket.id);
    socket.leave(me.code);
    broadcastRoom(me.code);
  });

  socket.on('disconnect', () => {
    const me = members.get(socket.id);
    if (!me) return;
    members.delete(socket.id);
    rooms.leave(me.code, socket.id);
    if (me.screen === 'phone') couchFor(me.code).drop(socket.id);
    broadcastRoom(me.code);
  });
});

// Free seats whose phones have been gone too long, and clear out rooms nobody has used for 30 minutes.
setInterval(() => {
  for (const [code, couch] of couches) if (couch.sweep()) broadcastRoom(code);
}, 10_000).unref();
setInterval(() => {
  const removed = rooms.sweep();
  for (const code of removed) couches.delete(code);
  if (removed.length) app.log.info({ removed }, 'expired empty rooms');
}, 60_000).unref();

await app.listen({ port: PORT, host: HOST });
