import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ClientToServer, ServerToClient, Screen } from '@couchpotato/shared';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const here = path.dirname(fileURLToPath(import.meta.url));
// In the container the built web app sits next to the server; in dev Vite serves it.
const WEB_DIR = process.env.WEB_DIR ?? path.resolve(here, '../../web/dist');

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.get('/healthz', async () => ({ ok: true }));

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

// ---- Phase 0 smoke test: phones tap, the TV counts. ----
let count = 0;
let lastBy: string | null = null;
const screens = new Map<string, { screen: Screen; name?: string }>();

function broadcastPresence() {
  let tvs = 0;
  let phones = 0;
  for (const s of screens.values()) s.screen === 'tv' ? tvs++ : phones++;
  io.emit('presence', { tvs, phones });
}

io.on('connection', (socket) => {
  socket.on('hello', ({ screen, name }) => {
    screens.set(socket.id, { screen, name: name?.slice(0, 20) });
    socket.emit('tap:count', { count, lastBy });
    broadcastPresence();
  });

  socket.on('tap', () => {
    const me = screens.get(socket.id);
    if (me?.screen !== 'phone') return;
    count += 1;
    lastBy = me.name ?? 'someone';
    io.emit('tap:count', { count, lastBy });
  });

  socket.on('disconnect', () => {
    screens.delete(socket.id);
    broadcastPresence();
  });
});

await app.listen({ port: PORT, host: HOST });
