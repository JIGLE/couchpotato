// Host accounts: invite-only sign-up, hashed passwords, remember-me sessions and a login rate limit.
// Players never sign in; only a host can open a room by claiming a TV. Kept free of Fastify and
// Socket.IO so it can be unit-tested against an in-memory database.

import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { HostAuthError, HostRole } from '@couchpotato/shared';
import { CODE_ALPHABET } from './rooms.js';

/** "Remember me": a session lasts 30 days. Without it, half a day — long enough for one game night. */
export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
export const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;
/** An unused invite stops working after a week. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A God Potato invite comes from the server's shell and is used straight away, so it lasts an hour. */
export const GOD_INVITE_TTL_MS = 60 * 60 * 1000;
export const MIN_PASSWORD = 8;
export const MAX_NAME = 20;

// scrypt with the OWASP-recommended cost; ~50 ms per hash, run off the event loop.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;

function scryptAsync(password: string, salt: Buffer, opts = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** `scrypt$N$r$p$salt$key`, so the cost can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), { ...SCRYPT, N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Checked against when the name is unknown, so a wrong name takes as long as a wrong password. */
let decoy: Promise<string> | null = null;

/** Invite codes look like SPUD-7KQ3-M9XA: easy to read out loud, no 0/O or 1/I. */
export function newInviteCode(): string {
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `SPUD-${part()}-${part()}`;
}

/** What a person typed: upper-case, dashes where they belong, spaces and stray characters dropped. */
export function normaliseInvite(input: unknown): string {
  if (typeof input !== 'string') return '';
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('SPUD') ? raw.slice(4) : raw;
  return body.length === 8 ? `SPUD-${body.slice(0, 4)}-${body.slice(4)}` : '';
}

export function cleanName(input: unknown): string {
  return typeof input === 'string' ? input.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : '';
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

export interface Host {
  id: number;
  name: string;
  role: HostRole;
}

export interface Invite {
  code: string;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
}

export type SignUpResult = { ok: true; host: Host } | { ok: false; reason: HostAuthError };

/** Why the shell could not make someone the God Potato: there already is one, or no such (unrevoked) host. */
export type PromoteResult = { ok: true; host: Host } | { ok: false; reason: 'taken'; current: string } | { ok: false; reason: 'not-found' };

type HostRow = { id: number; name: string; role: HostRole };
const toHost = (r: HostRow): Host => ({ id: r.id, name: r.name, role: r.role });

export class Hosts {
  constructor(
    private db: DatabaseSync,
    private now: () => number = Date.now,
  ) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM hosts WHERE revoked_at IS NULL').get() as { n: number }).n;
  }

  list(): (Host & { createdAt: number; revoked: boolean })[] {
    const rows = this.db.prepare('SELECT id, name, role, created_at, revoked_at FROM hosts ORDER BY id').all() as (HostRow & {
      created_at: number; revoked_at: number | null;
    })[];
    return rows.map((r) => ({ ...toHost(r), createdAt: r.created_at, revoked: r.revoked_at !== null }));
  }

  /** A Head Spud invite. */
  createInvite(ttlMs = INVITE_TTL_MS): Invite {
    const t = this.now();
    const code = newInviteCode();
    this.db.prepare('INSERT INTO invites (code, created_at, expires_at) VALUES (?, ?, ?)').run(code, t, t + ttlMs);
    return { code, createdAt: t, expiresAt: t + ttlMs, usedBy: null };
  }

  /** The server's one God Potato, if there is one. Revoked hosts lose the role, so this is always someone active. */
  godPotato(): Host | undefined {
    const row = this.db.prepare("SELECT id, name, role FROM hosts WHERE role = 'god'").get() as HostRow | undefined;
    return row && toHost(row);
  }

  /**
   * A one-use invite that signs up the God Potato. Only from the shell (cli.js). Undefined if there already is one.
   * Making a new one cancels any earlier unused one, so only the latest code printed works.
   */
  createGodInvite(ttlMs = GOD_INVITE_TTL_MS): Invite | undefined {
    if (this.godPotato()) return undefined;
    const t = this.now();
    const code = newInviteCode();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("DELETE FROM invites WHERE role = 'god' AND used_at IS NULL").run();
      this.db.prepare("INSERT INTO invites (code, created_at, expires_at, role) VALUES (?, ?, ?, 'god')").run(code, t, t + ttlMs);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { code, createdAt: t, expiresAt: t + ttlMs, usedBy: null };
  }

  /** Make an existing host the God Potato (from the shell). Refuses while someone else holds the role. */
  promote(name: string): PromoteResult {
    const current = this.godPotato();
    if (current) return { ok: false, reason: 'taken', current: current.name };
    const row = this.db.prepare('SELECT id, name, role FROM hosts WHERE name = ? AND revoked_at IS NULL').get(cleanName(name)) as
      | HostRow
      | undefined;
    if (!row) return { ok: false, reason: 'not-found' };
    this.db.prepare("UPDATE hosts SET role = 'god' WHERE id = ?").run(row.id);
    this.db.prepare("DELETE FROM invites WHERE role = 'god' AND used_at IS NULL").run();
    return { ok: true, host: { ...toHost(row), role: 'god' } };
  }

  /** Take the God Potato role back to an ordinary Head Spud (from the shell), so it can go to someone else. */
  demote(): Host | undefined {
    const current = this.godPotato();
    if (current) this.db.prepare("UPDATE hosts SET role = 'host' WHERE id = ?").run(current.id);
    return current && { ...current, role: 'host' };
  }

  /** Head Spud invites nobody has used yet and that have not expired. God Potato invites are never listed. */
  openInvites(): Invite[] {
    const rows = this.db
      .prepare("SELECT code, created_at, expires_at FROM invites WHERE used_at IS NULL AND expires_at > ? AND role = 'host' ORDER BY created_at")
      .all(this.now()) as { code: string; created_at: number; expires_at: number }[];
    return rows.map((r) => ({ code: r.code, createdAt: r.created_at, expiresAt: r.expires_at, usedBy: null }));
  }

  /** Turn an invite into a host account. The invite works once. */
  async signUp(invite: unknown, name: unknown, password: unknown): Promise<SignUpResult> {
    const code = normaliseInvite(invite);
    const clean = cleanName(name);
    if (!clean) return { ok: false, reason: 'bad-name' };
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 200) {
      return { ok: false, reason: 'weak-password' };
    }
    if (!code || !this.inviteRole(code)) return { ok: false, reason: 'bad-invite' };
    const hash = await hashPassword(password);

    // Check again inside the transaction: two phones may race for the same invite or name.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const role = this.inviteRole(code);
      // A God Potato invite stops working the moment the server has one, however it got one.
      if (!role || (role === 'god' && this.godPotato())) {
        this.db.exec('ROLLBACK');
        return { ok: false, reason: 'bad-invite' };
      }
      if (this.db.prepare('SELECT 1 FROM hosts WHERE name = ?').get(clean)) {
        this.db.exec('ROLLBACK');
        return { ok: false, reason: 'name-taken' };
      }
      const t = this.now();
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO hosts (name, password_hash, created_at, role) VALUES (?, ?, ?, ?)')
        .run(clean, hash, t, role);
      this.db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(lastInsertRowid, t, code);
      this.db.exec('COMMIT');
      return { ok: true, host: { id: Number(lastInsertRowid), name: clean, role } };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** The host, if the name and password match and the host has not been revoked. */
  async login(name: unknown, password: unknown): Promise<Host | undefined> {
    const clean = cleanName(name);
    const row = clean
      ? (this.db.prepare('SELECT id, name, role, password_hash FROM hosts WHERE name = ? AND revoked_at IS NULL').get(clean) as
          | (HostRow & { password_hash: string })
          | undefined)
      : undefined;
    const pw = typeof password === 'string' ? password.slice(0, 200) : '';
    if (!row) {
      await verifyPassword(pw, await (decoy ??= hashPassword('not a real password')));
      return undefined;
    }
    return (await verifyPassword(pw, row.password_hash)) ? toHost(row) : undefined;
  }

  /** Start a session. Returns the token for the cookie; only its hash is stored. */
  startSession(hostId: number, remember: boolean): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const t = this.now();
    const expiresAt = t + (remember ? REMEMBER_MS : SHORT_SESSION_MS);
    this.db
      .prepare('INSERT INTO sessions (token_hash, host_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), hostId, t, expiresAt);
    return { token, expiresAt };
  }

  /** Who a session token belongs to, if it is still valid. Checked on every claim so a revoke bites at once. */
  session(token: unknown): Host | undefined {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return undefined;
    const row = this.db
      .prepare(
        `SELECT h.id, h.name, h.role FROM sessions s JOIN hosts h ON h.id = s.host_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND h.revoked_at IS NULL`,
      )
      .get(sha256(token), this.now()) as HostRow | undefined;
    return row && toHost(row);
  }

  endSession(token: unknown): void {
    if (typeof token === 'string') this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  /** Stop a host from opening rooms and sign them out everywhere; a revoked God Potato loses the role. False if no such host. */
  revoke(name: string): boolean {
    const row = this.db.prepare('SELECT id FROM hosts WHERE name = ?').get(cleanName(name)) as { id: number } | undefined;
    if (!row) return false;
    this.db.prepare("UPDATE hosts SET revoked_at = ?, role = 'host' WHERE id = ?").run(this.now(), row.id);
    this.db.prepare('DELETE FROM sessions WHERE host_id = ?').run(row.id);
    return true;
  }

  /** Forget expired sessions. */
  sweep(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now());
  }

  /** The role an unused, unexpired invite makes, or undefined. */
  private inviteRole(code: string): HostRole | undefined {
    const row = this.db.prepare('SELECT role FROM invites WHERE code = ? AND used_at IS NULL AND expires_at > ?').get(code, this.now()) as
      | { role: HostRole }
      | undefined;
    return row?.role;
  }
}

/**
 * Counts failures per key (an IP, a host name, a phone) in a sliding window. Successful sign-ins do not count.
 * In memory on purpose: a restart forgetting the counts is fine.
 */
export class RateLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  /** Milliseconds until this key may try again; 0 = go ahead. */
  wait(key: string): number {
    const recent = this.recent(key);
    return recent.length >= this.max ? recent[0] + this.windowMs - this.now() : 0;
  }

  fail(key: string): void {
    const recent = this.recent(key);
    recent.push(this.now());
    this.failures.set(key, recent);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  /** Drop keys with nothing recent, so the map does not grow forever. */
  sweep(): void {
    for (const key of [...this.failures.keys()]) if (!this.recent(key).length) this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.failures.set(key, list);
    return list;
  }
}

/** The host's session cookie. httpOnly so page scripts never see it; SameSite=Strict so other sites can't use it. */
export const SESSION_COOKIE = 'cp_host';

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Set-Cookie value for the session. Without `maxAgeMs` it is a browser-session cookie (gone when the browser
 * closes); an empty token clears it. `secure` should be true behind HTTPS (the Cloudflare tunnel).
 */
export function sessionCookie(token: string, maxAgeMs: number | undefined, secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (!token) parts.push('Max-Age=0');
  else if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
