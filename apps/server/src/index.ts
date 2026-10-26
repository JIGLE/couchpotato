import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ClientToServer, ServerToClient, Screen } from '@couchpotato/shared';
import { MAX_SEATS, RoomStore, isMood } from './rooms.js';
import { Couch } from './couch.js';
import { loadPacks, pickQuestions, summarize } from './packs.js';
import { TriviaGame, parseSettings } from './trivia.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const here = path.dirname(fileURLToPath(import.meta.url));
// In the container the built web app sits next to the server; in dev Vite serves it.
const WEB_DIR = process.env.WEB_DIR ?? path.resolve(here, '../../web/dist');

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

// Question packs bundled with the app; from Phase 3 also the host's own packs in /data.
const PACKS_DIR = process.env.PACKS_DIR ?? path.resolve(here, '../packs');
const packs = await loadPacks(PACKS_DIR, app.log);
app.get('/api/packs', async () => packs.map(summarize));

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

/** The game running in each room, plus question ids already played there (so the next game feels fresh). */
const games = new Map<string, TriviaGame>();
const played = new Map<string, Set<string>>();

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
  const players = couchFor(code).list();
  io.to(code).emit('room:players', { players, seats: MAX_SEATS });

  const game = games.get(code);
  if (game) {
    const now = Date.now();
    for (const p of players) game.addPlayer(p.id, p.name, now);
    game.setPresent(players.filter((p) => !p.away).map((p) => p.id), now);
    broadcastGame(code);
  }
}

/** Send every screen in the room its own view of the game: the TV sees the question, each phone only its part. */
function broadcastGame(code: string, only?: string) {
  const game = games.get(code);
  const now = Date.now();
  const ids = only ? [only] : [...(io.sockets.adapter.rooms.get(code) ?? [])];
  for (const socketId of ids) {
    const socket = io.sockets.sockets.get(socketId);
    const member = members.get(socketId);
    if (!socket || !member) continue;
    if (!game) {
      socket.emit('game:state', null);
    } else if (member.screen === 'tv') {
      socket.emit('game:state', game.tvView(now));
    } else {
      const player = couchFor(code).player(socketId);
      socket.emit('game:state', player ? game.phoneView(player.id, now) : null);
    }
  }
}

io.on('connection', (socket) => {
  socket.on('hello', ({ screen, code, name, colour, token, mood }) => {
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
    // A TV brings its own mood (the one it used last time); phones follow the room.
    if (screen === 'tv' && isMood(mood) && mood !== room.mood) {
      room.mood = mood;
      io.to(room.code).emit('room:mood', { mood });
    }
    socket.emit('room:joined', joined);
    socket.emit('room:mood', { mood: room.mood });
    socket.emit('tap:count', { count: room.taps, lastBy: room.lastTapBy, lastById: null });
    broadcastRoom(room.code);
    broadcastGame(room.code, socket.id);
  });

  socket.on('room:mood', (payload) => {
    const me = members.get(socket.id);
    const room = me && rooms.get(me.code);
    if (me?.screen !== 'tv' || !room || !isMood(payload?.mood)) return;
    room.mood = payload.mood;
    io.to(room.code).emit('room:mood', { mood: room.mood });
  });

  socket.on('game:start', (raw) => {
    const me = members.get(socket.id);
    if (me?.screen !== 'tv') return; // Phase 3: only a signed-in host
    const settings = parseSettings(raw);
    const players = couchFor(me.code).list();
    if (!players.length) return void socket.emit('game:error', { reason: 'no-players' });

    const seen = played.get(me.code) ?? new Set<string>();
    const audience = { language: settings.language, youngest: settings.youngest, regions: settings.regions };
    let questions = pickQuestions(packs, { ...audience, exclude: seen }, settings.rounds);
    if (questions.length < settings.rounds) {
      // Ran out of fresh questions: start the cycle again rather than play a short game.
      seen.clear();
      questions = pickQuestions(packs, audience, settings.rounds);
    }
    if (!questions.length) return void socket.emit('game:error', { reason: 'no-questions' });

    const now = Date.now();
    const game = new TriviaGame(questions, settings, players, now);
    game.setPresent(players.filter((p) => !p.away).map((p) => p.id), now);
    games.set(me.code, game);
    played.set(me.code, seen);
    app.log.info({ room: me.code, ...settings, questions: questions.length }, 'game started');
    broadcastGame(me.code);
  });

  socket.on('game:answer', (payload) => {
    const me = members.get(socket.id);
    if (me?.screen !== 'phone') return;
    const game = games.get(me.code);
    const player = couchFor(me.code).player(socket.id);
    if (!game || !player) return;
    if (game.answer(player.id, Number(payload?.choice), Date.now())) broadcastGame(me.code);
  });

  socket.on('game:end', () => {
    const me = members.get(socket.id);
    if (me?.screen !== 'tv' || !games.has(me.code)) return;
    endGame(me.code);
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

function endGame(code: string) {
  const game = games.get(code);
  if (game) for (const id of game.playedIds) played.get(code)?.add(id);
  games.delete(code);
  broadcastGame(code);
}

// Move every running game along. Cheap: most ticks change nothing.
setInterval(() => {
  const now = Date.now();
  for (const [code, game] of games) {
    if (game.advance(now)) {
      broadcastGame(code);
      if (game.over) for (const id of game.playedIds) played.get(code)?.add(id);
    }
  }
}, 200).unref();

// Free seats whose phones have been gone too long, and clear out rooms nobody has used for 30 minutes.
setInterval(() => {
  for (const [code, couch] of couches) if (couch.sweep()) broadcastRoom(code);
}, 10_000).unref();
setInterval(() => {
  const removed = rooms.sweep();
  for (const code of removed) {
    couches.delete(code);
    games.delete(code);
    played.delete(code);
  }
  if (removed.length) app.log.info({ removed }, 'expired empty rooms');
}, 60_000).unref();

await app.listen({ port: PORT, host: HOST });
