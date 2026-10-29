import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server, type Socket } from 'socket.io';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AdminView, ClaimError, ClientToServer, HostAuthError, HostStatus, Mood, ServerToClient, Screen } from '@couchpotato/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MAX_SEATS, RoomStore, isMood, type Room } from './rooms.js';
import { Couch, isToken, newToken } from './couch.js';
import { type Host, Hosts, RateLimiter, REMEMBER_MS, SESSION_COOKIE, cleanName, readCookie, sessionCookie } from './hosts.js';
import { Pairings } from './pairing.js';
import { loadPacks, pickQuestions, summarize } from './packs.js';
import { TriviaGame, parseSettings } from './trivia.js';
import { DB_FILE, Settings, isHealthy, openDatabase, schemaVersion, serverSecret } from './storage.js';

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
app.log.info({ version: VERSION }, 'starting couch potato');

// ---- Storage: one SQLite file in /data. Games still run without it, so a volume problem never spoils a game night. ----
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(here, '../data');
const DB_PATH = path.join(DATA_DIR, DB_FILE);
let db: ReturnType<typeof openDatabase> | null = null;
try {
  db = openDatabase(DB_PATH);
  // Made once and kept, so host sign-ins can outlive restarts and image updates.
  serverSecret(new Settings(db));
  app.log.info({ file: DB_PATH, schema: schemaVersion(db) }, 'storage ready');
} catch (err) {
  app.log.error({ err, file: DB_PATH }, 'storage unavailable — is the /data volume mounted and writable by the node user? See docs/DEPLOY.md');
}

app.get('/healthz', async () => ({ ok: true, version: VERSION, storage: isHealthy(db) }));

// ---- Host accounts: only a signed-in host can claim a TV and open a room. Players never sign in. ----
const hosts = db ? new Hosts(db) : null;
/** OPEN_HOSTING=1 lets any phone claim a TV (handy in development). Without storage there are no accounts, so it is open too. */
const OPEN_HOSTING = process.env.OPEN_HOSTING === '1';
const hostsRequired = !!hosts && !OPEN_HOSTING;
if (!hostsRequired) {
  app.log.warn(hosts ? 'OPEN_HOSTING is on: any phone can claim a TV' : 'no storage, so no host accounts: any phone can claim a TV');
} else if (hosts.count() === 0) {
  // First start: there is no admin page yet, so the first invite goes to the log. More with the CLI (docs/DEPLOY.md).
  const invite = hosts.openInvites()[0] ?? hosts.createInvite();
  app.log.warn({ invite: invite.code }, 'no hosts yet: on your phone open /claim, tap "I have an invite" and use this code');
}

/** Behind the Cloudflare tunnel every request comes from cloudflared; the visitor's address is in this header. */
const clientIp = (headers: Record<string, unknown>, fallback: string) =>
  (typeof headers['cf-connecting-ip'] === 'string' ? headers['cf-connecting-ip'] : '') || fallback;
function hostOf(cookieHeader: string | undefined): Host | undefined {
  try {
    return hosts?.session(readCookie(cookieHeader, SESSION_COOKIE));
  } catch (err) {
    app.log.error({ err }, 'could not read host session');
    return undefined;
  }
}
const hostStatus = (host: Host | undefined): HostStatus => ({
  host: host ? { name: host.name, role: host.role } : null,
  required: hostsRequired,
});
const isHttps = (req: FastifyRequest) => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';

/** Wrong passwords: 5 per 15 minutes, counted both per address and per host name. Wrong invites count per address. */
const loginLimit = new RateLimiter(5, 15 * 60 * 1000);

function authError(reply: FastifyReply, status: number, error: HostAuthError, retryAfter?: number) {
  if (retryAfter) reply.header('retry-after', String(retryAfter));
  return reply.code(status).send(retryAfter ? { error, retryAfter } : { error });
}

function signIn(req: FastifyRequest, reply: FastifyReply, host: Host, remember: boolean) {
  const { token } = hosts!.startSession(host.id, remember);
  reply.header('set-cookie', sessionCookie(token, remember ? REMEMBER_MS : undefined, isHttps(req)));
  return hostStatus(host);
}

/** The keys to rate-limit on, and how long until all of them may try again (seconds, 0 = now). */
function limits(req: FastifyRequest, name?: unknown) {
  const keys = [`ip:${clientIp(req.headers, req.ip)}`];
  if (name !== undefined) keys.push(`name:${cleanName(name).toLowerCase()}`);
  return { keys, wait: Math.ceil(Math.max(...keys.map((k) => loginLimit.wait(k))) / 1000) };
}

app.get('/api/host', async (req) => hostStatus(hostOf(req.headers.cookie)));

app.post('/api/host/login', async (req, reply) => {
  if (!hosts) return authError(reply, 503, 'unavailable');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { keys, wait } = limits(req, body.name);
  if (wait) return authError(reply, 429, 'slow-down', wait);
  const host = await hosts.login(body.name, body.password);
  if (!host) {
    for (const k of keys) loginLimit.fail(k);
    return authError(reply, 401, 'wrong');
  }
  for (const k of keys) loginLimit.reset(k);
  return signIn(req, reply, host, body.remember === true);
});

app.post('/api/host/signup', async (req, reply) => {
  if (!hosts) return authError(reply, 503, 'unavailable');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { keys, wait } = limits(req);
  if (wait) return authError(reply, 429, 'slow-down', wait);
  const result = await hosts.signUp(body.invite, body.name, body.password);
  if (!result.ok) {
    if (result.reason === 'bad-invite') for (const k of keys) loginLimit.fail(k);
    return authError(reply, 400, result.reason);
  }
  app.log.info({ host: result.host.name }, 'new host signed up');
  return signIn(req, reply, result.host, body.remember === true);
});

app.post('/api/host/logout', async (req, reply) => {
  hosts?.endSession(readCookie(req.headers.cookie, SESSION_COOKIE));
  reply.header('set-cookie', sessionCookie('', undefined, isHttps(req)));
  return hostStatus(undefined);
});

// ---- God Potato: the one host per server who also makes invites and revokes hosts (cli.js god-potato makes them). ----
const ADMIN_INVITE_DAYS = { min: 1, max: 90, default: 7 };
const day = 24 * 60 * 60 * 1000;

/** The signed-in God Potato, or a 403 already sent. */
function godPotatoOf(req: FastifyRequest, reply: FastifyReply): Host | undefined {
  const me = hostOf(req.headers.cookie);
  if (me?.role === 'god') return me;
  reply.code(403).send({ error: 'forbidden' });
  return undefined;
}

const adminView = (): AdminView => ({
  invites: hosts!.openInvites().map((i) => ({ code: i.code, expiresAt: i.expiresAt })),
  hosts: hosts!.list().map((h) => ({ name: h.name, role: h.role, createdAt: h.createdAt, revoked: h.revoked })),
});

app.get('/api/admin', async (req, reply) => (godPotatoOf(req, reply) ? adminView() : reply));

app.post('/api/admin/invite', async (req, reply) => {
  const me = godPotatoOf(req, reply);
  if (!me) return reply;
  const asked = Number(((req.body ?? {}) as Record<string, unknown>).days) || ADMIN_INVITE_DAYS.default;
  const days = Math.min(Math.max(Math.round(asked), ADMIN_INVITE_DAYS.min), ADMIN_INVITE_DAYS.max);
  const invite = hosts!.createInvite(days * day);
  app.log.info({ by: me.name, days }, 'God Potato made an invite');
  return { code: invite.code, expiresAt: invite.expiresAt };
});

app.post('/api/admin/revoke', async (req, reply) => {
  const me = godPotatoOf(req, reply);
  if (!me) return reply;
  const name = cleanName(((req.body ?? {}) as Record<string, unknown>).name);
  // The God Potato can't revoke themselves from a phone; stepping down is a shell job.
  const target = hosts!.list().find((h) => h.name.toLowerCase() === name.toLowerCase());
  if (!target || target.id === me.id) return reply.code(404).send({ error: 'not-found' });
  hosts!.revoke(target.name);
  app.log.info({ by: me.name, host: target.name }, 'God Potato revoked a host');
  return adminView();
});

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
type Member = { screen: Screen; code: string };
const members = new Map<string, Member>();

/** TVs with no room yet, showing a claim code; and the mood each one brought, for when it is claimed. */
const pairings = new Pairings();
const waitingMoods = new Map<string, Mood | undefined>();
type CouchSocket = Socket<ClientToServer, ServerToClient>;

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

/** A TV with no room: show a claim code until a host's phone claims it. */
function waitForHost(socket: CouchSocket, mood?: Mood) {
  waitingMoods.set(socket.id, mood);
  const { code, renewsAt } = pairings.issue(socket.id);
  socket.emit('tv:pairing', { code, renewsAt, serverNow: Date.now(), hostsRequired });
}

/** Put a TV or a seated phone into its room and bring it up to date. */
function enter(socket: CouchSocket, screen: Screen, room: Room, joined: { code: string; playerId?: string; token?: string }, mood?: Mood) {
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
  socket.emit('lobby:setup', { settings: room.setup });
  socket.emit('tap:count', { count: room.taps, lastBy: room.lastTapBy, lastById: null });
  broadcastRoom(room.code);
  broadcastGame(room.code, socket.id);
}

/** Wrong claim codes: 10 a minute per address, so nobody can guess their way onto a TV. */
const claimLimit = new RateLimiter(10, 60 * 1000);

io.on('connection', (socket) => {
  const busy = () => members.has(socket.id) || pairings.has(socket.id); // one hello (or claim) per connection
  const host = () => hostOf(socket.handshake.headers.cookie);

  socket.on('hello', ({ screen, code, name, colour, potato, token, mood }) => {
    if (busy()) return;
    if (screen !== 'tv' && screen !== 'phone') return;
    const room = code ? rooms.get(code) : undefined;

    if (screen === 'tv') {
      // Only the TV that was claimed gets back into its room; anything else waits for a host.
      if (!room || !isToken(token) || token !== room.tvToken) return waitForHost(socket, isMood(mood) ? mood : undefined);
      return enter(socket, 'tv', room, { code: room.code, token: room.tvToken }, mood);
    }

    if (!room) {
      socket.emit('room:error', { reason: code ? 'not-found' : 'bad-request', code: code ?? '' });
      return;
    }
    const couch = couchFor(room.code);
    const sat = couch.sit(token, socket.id, name?.trim().slice(0, 20) || 'Potato', colour, potato);
    if (!sat.ok) {
      socket.emit('room:error', { reason: 'full', code: room.code });
      return;
    }
    // The host who claimed this TV gets the role back, even from a new seat.
    if (room.hostId !== null && host()?.id === room.hostId) couch.crown(socket.id);
    enter(socket, 'phone', room, { code: room.code, playerId: sat.player.id, token: sat.token });
  });

  socket.on('room:claim', (payload) => {
    if (busy()) return;
    const fail = (reason: ClaimError) => socket.emit('room:claim-error', { reason });
    const key = clientIp(socket.handshake.headers, socket.handshake.address);
    if (claimLimit.wait(key)) return fail('slow-down');
    const me = host();
    if (hostsRequired && !me) return fail('sign-in');
    const tvId = pairings.claim(payload?.pairing);
    const tv = tvId ? io.sockets.sockets.get(tvId) : undefined;
    if (!tv) {
      claimLimit.fail(key);
      return fail('expired');
    }

    const room = rooms.create(me?.id ?? null, newToken());
    const name = cleanName(payload?.name) || me?.name || 'Head Spud';
    const couch = couchFor(room.code);
    const sat = couch.sit(undefined, socket.id, name, payload?.colour, payload?.potato);
    if (!sat.ok) return fail('expired'); // an empty couch always has room; just in case
    couch.crown(socket.id);
    app.log.info({ room: room.code, host: me?.name ?? null }, 'TV claimed');

    tv.emit('room:claimed', { code: room.code, by: name });
    enter(tv, 'tv', room, { code: room.code, token: room.tvToken }, waitingMoods.get(tv.id));
    waitingMoods.delete(tv.id);
    enter(socket, 'phone', room, { code: room.code, playerId: sat.player.id, token: sat.token });
  });

  /** The TV and the Head Spud's phone may run the room; other phones only play. */
  const inCharge = (me: Member | undefined): me is Member =>
    !!me && (me.screen === 'tv' || couchFor(me.code).isHeadSpud(socket.id));

  socket.on('room:mood', (payload) => {
    const me = members.get(socket.id);
    const room = me && rooms.get(me.code);
    if (!inCharge(me) || !room || !isMood(payload?.mood)) return;
    room.mood = payload.mood;
    io.to(room.code).emit('room:mood', { mood: room.mood });
  });

  socket.on('lobby:setup', (raw) => {
    const me = members.get(socket.id);
    const room = me && rooms.get(me.code);
    if (!inCharge(me) || !room || games.has(me.code)) return;
    room.setup = parseSettings(raw);
    io.to(room.code).emit('lobby:setup', { settings: room.setup });
  });

  socket.on('game:start', (raw) => {
    const me = members.get(socket.id);
    if (!inCharge(me)) return;
    const settings = parseSettings(raw);
    const room = rooms.get(me.code);
    if (room) room.setup = settings;
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
    if (!inCharge(me) || !games.has(me.code)) return;
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

  socket.on('potato:pick', (payload) => {
    const me = members.get(socket.id);
    if (me?.screen !== 'phone' || games.has(me.code)) return; // no costume changes mid-game
    if (couchFor(me.code).pick(socket.id, payload?.potato)) broadcastRoom(me.code);
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
    pairings.drop(socket.id);
    waitingMoods.delete(socket.id);
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

// Waiting TVs get a fresh claim code every minute.
setInterval(() => {
  const serverNow = Date.now();
  for (const [tvId, { code, renewsAt }] of pairings.renew()) io.to(tvId).emit('tv:pairing', { code, renewsAt, serverNow, hostsRequired });
}, 1000).unref();

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
  hosts?.sweep();
  loginLimit.sweep();
  claimLimit.sweep();
}, 60_000).unref();

// Close the database cleanly when the container stops so the WAL is folded back into the file.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().finally(() => {
      db?.close();
      process.exit(0);
    });
  });
}

await app.listen({ port: PORT, host: HOST });
