// Everything that must survive a restart lives in one SQLite file in DATA_DIR (/data in the container).
// Uses Node's built-in node:sqlite, so there is no native module to build on Alpine.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const DB_FILE = 'couchpotato.db';

/**
 * Schema changes, oldest first. Each runs once, in its own transaction; the database remembers how many
 * have run in `PRAGMA user_version`. Never edit or reorder one that has shipped — add a new one.
 */
export const MIGRATIONS: readonly string[] = [
  // 1 · Small server-wide values (the server secret, later admin options).
  `CREATE TABLE settings (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   ) STRICT`,
  // 2 · Host accounts. Only hosts can open a room (claim a TV); players never sign in.
  //     Sessions keep a hash of the remember-me token, never the token itself.
  `CREATE TABLE hosts (
     id            INTEGER PRIMARY KEY,
     name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     created_at    INTEGER NOT NULL,
     revoked_at    INTEGER
   ) STRICT;
   CREATE TABLE invites (
     code       TEXT PRIMARY KEY,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     used_by    INTEGER REFERENCES hosts (id) ON DELETE SET NULL,
     used_at    INTEGER
   ) STRICT;
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     host_id    INTEGER NOT NULL REFERENCES hosts (id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX sessions_by_host ON sessions (host_id);`,
];

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

/** Bring the schema up to date. Returns how many migrations ran. */
export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): number {
  const current = schemaVersion(db);
  if (current > migrations.length) {
    // Rolled back to an older image: refuse rather than let old code write into a newer schema.
    throw new Error(`database is at version ${current} but this build only knows ${migrations.length}`);
  }
  for (let v = current; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${v + 1} failed`, { cause: err });
    }
  }
  return migrations.length - current;
}

/** Open (or create) the database file and migrate it. Pass ':memory:' in tests. */
export function openDatabase(file: string, migrations: readonly string[] = MIGRATIONS): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    // WAL keeps reads from waiting on writes; busy_timeout covers the rare overlap.
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate(db, migrations);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** Cheap check for /healthz. */
export function isHealthy(db: DatabaseSync | null): boolean {
  if (!db?.isOpen) return false;
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

export class Settings {
  constructor(private db: DatabaseSync, private now: () => number = Date.now) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, this.now());
  }
}

/**
 * A random secret made on first start and kept, so anything signed with it (host remember-me
 * sessions, next) stays valid across restarts and image updates.
 */
export function serverSecret(settings: Settings): string {
  let secret = settings.get('server-secret');
  if (!secret) settings.set('server-secret', (secret = randomBytes(32).toString('base64url')));
  return secret;
}
