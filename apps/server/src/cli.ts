// Host admin from the command line, until the admin page exists (Phase 3).
//   node apps/server/dist/cli.js invite [days]   make an invite code (default: valid 7 days)
//   node apps/server/dist/cli.js invites         list unused invites
//   node apps/server/dist/cli.js hosts           list hosts
//   node apps/server/dist/cli.js revoke <name>   stop a host opening rooms and sign them out
//   node apps/server/dist/cli.js god-potato      one-use invite (1 hour) for the server's one God Potato
//   node apps/server/dist/cli.js god-potato <name>        make an existing host the God Potato
//   node apps/server/dist/cli.js god-potato --step-down   hand the role back, so it can go to someone else
// In the container: docker exec -it couchpotato node apps/server/dist/cli.js invite

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_FILE, openDatabase } from './storage.js';
import { Hosts } from './hosts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(here, '../data');
const [command, arg] = process.argv.slice(2);
const day = 24 * 60 * 60 * 1000;
const date = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
/** PUBLIC_URL (e.g. https://cp.example.com) makes the printed claim link complete; without it the path is printed. */
const claimUrl = (invite: string) => `${(process.env.PUBLIC_URL ?? '').replace(/\/+$/, '')}/claim?invite=${invite}`;

const db = openDatabase(path.join(DATA_DIR, DB_FILE));
const hosts = new Hosts(db);
try {
  switch (command) {
    case 'invite': {
      const days = Math.min(Math.max(Number(arg) || 7, 1), 90);
      const invite = hosts.createInvite(days * day);
      console.log(`${invite.code}  (valid until ${date(invite.expiresAt)} UTC; use it once at /claim → "I have an invite")`);
      break;
    }
    case 'invites':
      for (const i of hosts.openInvites()) console.log(`${i.code}  until ${date(i.expiresAt)} UTC`);
      break;
    case 'hosts':
      for (const h of hosts.list()) {
        const tag = h.revoked ? '  (revoked)' : h.role === 'god' ? '  (God Potato)' : '';
        console.log(`${h.name}${tag}  since ${date(h.createdAt)} UTC`);
      }
      break;
    case 'god-potato': {
      const current = hosts.godPotato();
      if (arg === '--step-down') {
        console.log(current ? `${hosts.demote()!.name} is an ordinary Head Spud again.` : 'There is no God Potato.');
        break;
      }
      if (current) {
        // One per server. Passing it on is deliberate: step down first, then promote or invite.
        console.log(`${current.name} is already the God Potato (one per server). To pass it on: god-potato --step-down`);
        process.exitCode = 1;
        break;
      }
      if (arg) {
        const result = hosts.promote(arg);
        console.log(result.ok ? `${result.host.name} is now the God Potato.` : `No active host called ${arg}.`);
        if (!result.ok) process.exitCode = 1;
        break;
      }
      const invite = hosts.createGodInvite()!;
      console.log(`God Potato invite: ${invite.code}  (works once, until ${date(invite.expiresAt)} UTC)`);
      console.log(`On your phone open ${claimUrl(invite.code)} and choose your name and password.`);
      console.log('Running this again cancels this code and prints a new one.');
      break;
    }
    case 'revoke':
      if (!arg) throw new Error('usage: revoke <name>');
      console.log(hosts.revoke(arg) ? `${arg} can no longer open rooms.` : `No host called ${arg}.`);
      break;
    default:
      console.log('usage: cli.js invite [days] | invites | hosts | revoke <name> | god-potato [<name> | --step-down]');
      process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db.close();
}
