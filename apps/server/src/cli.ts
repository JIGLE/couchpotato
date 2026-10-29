// Host admin from the command line, until the admin page exists (Phase 3).
//   node apps/server/dist/cli.js invite [days]   make an invite code (default: valid 7 days)
//   node apps/server/dist/cli.js invites         list unused invites
//   node apps/server/dist/cli.js hosts           list hosts
//   node apps/server/dist/cli.js revoke <name>   stop a host opening rooms and sign them out
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
      for (const h of hosts.list()) console.log(`${h.name}${h.revoked ? '  (revoked)' : ''}  since ${date(h.createdAt)} UTC`);
      break;
    case 'revoke':
      if (!arg) throw new Error('usage: revoke <name>');
      console.log(hosts.revoke(arg) ? `${arg} can no longer open rooms.` : `No host called ${arg}.`);
      break;
    default:
      console.log('usage: cli.js invite [days] | invites | hosts | revoke <name>');
      process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db.close();
}
