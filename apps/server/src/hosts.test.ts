import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './storage.ts';
import {
  Hosts, RateLimiter, REMEMBER_MS, SHORT_SESSION_MS, INVITE_TTL_MS, GOD_INVITE_TTL_MS,
  hashPassword, normaliseInvite, readCookie, sessionCookie, verifyPassword,
} from './hosts.ts';

function setup() {
  let now = 1_000_000;
  const db = openDatabase(':memory:');
  const hosts = new Hosts(db, () => now);
  return { db, hosts, tick: (ms: number) => (now += ms) };
}

test('passwords are salted scrypt hashes that verify only the right password', async () => {
  const a = await hashPassword('correct horse');
  const b = await hashPassword('correct horse');
  assert.match(a, /^scrypt\$/);
  assert.notEqual(a, b, 'salted');
  assert.ok(!a.includes('correct'));
  assert.equal(await verifyPassword('correct horse', a), true);
  assert.equal(await verifyPassword('correct hors', a), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('invite codes are normalised from what people type', () => {
  assert.equal(normaliseInvite('spud 7kq3 m9xa'), 'SPUD-7KQ3-M9XA');
  assert.equal(normaliseInvite('7KQ3-M9XA'), 'SPUD-7KQ3-M9XA');
  assert.equal(normaliseInvite('SPUD-7KQ'), '');
  assert.equal(normaliseInvite(42), '');
});

test('an invite makes exactly one host, then stops working', async () => {
  const { hosts } = setup();
  const { code } = hosts.createInvite();
  assert.equal(hosts.openInvites().length, 1);
  const first = await hosts.signUp(code.toLowerCase(), '  Jose ', 'potatoes!');
  assert.ok(first.ok);
  assert.equal(first.host.name, 'Jose');
  assert.equal(hosts.count(), 1);
  assert.equal(hosts.openInvites().length, 0);
  assert.deepEqual(await hosts.signUp(code, 'Maya', 'potatoes!'), { ok: false, reason: 'bad-invite' });
});

test('sign-up checks the name, the password and the invite', async () => {
  const { hosts, tick } = setup();
  const { code } = hosts.createInvite();
  assert.deepEqual(await hosts.signUp(code, '   ', 'potatoes!'), { ok: false, reason: 'bad-name' });
  assert.deepEqual(await hosts.signUp(code, 'Jose', 'short'), { ok: false, reason: 'weak-password' });
  assert.deepEqual(await hosts.signUp('SPUD-AAAA-BBBB', 'Jose', 'potatoes!'), { ok: false, reason: 'bad-invite' });
  assert.ok((await hosts.signUp(code, 'Jose', 'potatoes!')).ok);

  const second = hosts.createInvite();
  assert.deepEqual(await hosts.signUp(second.code, 'JOSE', 'potatoes!'), { ok: false, reason: 'name-taken' }, 'names ignore case');
  tick(INVITE_TTL_MS);
  assert.deepEqual(await hosts.signUp(second.code, 'Maya', 'potatoes!'), { ok: false, reason: 'bad-invite' }, 'expired');
});

test('login takes the name in any case and refuses wrong passwords and unknown names', async () => {
  const { hosts } = setup();
  await hosts.signUp(hosts.createInvite().code, 'Jose', 'potatoes!');
  assert.equal((await hosts.login('jose', 'potatoes!'))?.name, 'Jose');
  assert.equal(await hosts.login('Jose', 'Potatoes!'), undefined);
  assert.equal(await hosts.login('Nobody', 'potatoes!'), undefined);
  assert.equal(await hosts.login(undefined, undefined), undefined);
});

test('sessions last 30 days with remember-me, 12 hours without, and only the hash is stored', async () => {
  const { db, hosts, tick } = setup();
  const r = await hosts.signUp(hosts.createInvite().code, 'Jose', 'potatoes!');
  assert.ok(r.ok);
  const long = hosts.startSession(r.host.id, true);
  const short = hosts.startSession(r.host.id, false);
  const stored = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
  assert.ok(stored.every((s) => s.token_hash !== long.token && s.token_hash !== short.token));

  assert.equal(hosts.session(long.token)?.name, 'Jose');
  tick(SHORT_SESSION_MS);
  assert.equal(hosts.session(short.token), undefined);
  assert.equal(hosts.session(long.token)?.name, 'Jose');
  tick(REMEMBER_MS);
  assert.equal(hosts.session(long.token), undefined);
  hosts.sweep();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 0);
  assert.equal(hosts.session('nonsense'), undefined);
});

test('revoking a host signs them out and blocks login; logout ends one session', async () => {
  const { hosts } = setup();
  const r = await hosts.signUp(hosts.createInvite().code, 'Jose', 'potatoes!');
  assert.ok(r.ok);
  const a = hosts.startSession(r.host.id, true);
  const b = hosts.startSession(r.host.id, true);
  hosts.endSession(a.token);
  assert.equal(hosts.session(a.token), undefined);
  assert.ok(hosts.session(b.token));
  assert.equal(hosts.revoke('jose'), true);
  assert.equal(hosts.session(b.token), undefined);
  assert.equal(await hosts.login('Jose', 'potatoes!'), undefined);
  assert.equal(hosts.count(), 0);
  assert.equal(hosts.revoke('Nobody'), false);
});

test('a God Potato invite makes the one God Potato and is never listed', async () => {
  const { hosts, tick } = setup();
  const stale = hosts.createGodInvite()!;
  const invite = hosts.createGodInvite()!;
  assert.deepEqual(hosts.openInvites(), [], 'God Potato invites stay off the list');
  assert.deepEqual(await hosts.signUp(stale.code, 'Jose', 'potatoes!'), { ok: false, reason: 'bad-invite' }, 'only the latest works');
  const god = await hosts.signUp(invite.code, 'Jose', 'potatoes!');
  assert.ok(god.ok);
  assert.equal(god.host.role, 'god');
  assert.equal(hosts.godPotato()?.name, 'Jose');
  assert.equal((await hosts.login('jose', 'potatoes!'))?.role, 'god');
  assert.equal(hosts.session(hosts.startSession(god.host.id, false).token)?.role, 'god');
  assert.equal(hosts.createGodInvite(), undefined, 'one per server');

  const head = await hosts.signUp(hosts.createInvite().code, 'Maya', 'potatoes!');
  assert.ok(head.ok);
  assert.equal(head.host.role, 'host');

  const expired = (() => { hosts.demote(); return hosts.createGodInvite()!; })();
  tick(GOD_INVITE_TTL_MS);
  assert.deepEqual(await hosts.signUp(expired.code, 'Ana', 'potatoes!'), { ok: false, reason: 'bad-invite' }, 'an hour only');
});

test('only one God Potato: promote refuses while one exists, step down and revoke free the role', async () => {
  const { db, hosts } = setup();
  await hosts.signUp(hosts.createInvite().code, 'Jose', 'potatoes!');
  await hosts.signUp(hosts.createInvite().code, 'Maya', 'potatoes!');
  const pending = hosts.createGodInvite()!;
  assert.equal(hosts.promote('nobody').ok, false);
  const jose = hosts.promote('jose');
  assert.ok(jose.ok && jose.host.role === 'god');
  assert.deepEqual(await hosts.signUp(pending.code, 'Ana', 'potatoes!'), { ok: false, reason: 'bad-invite' }, 'promoting cancels the invite');
  assert.deepEqual(hosts.promote('Maya'), { ok: false, reason: 'taken', current: 'Jose' });
  assert.throws(() => db.prepare("UPDATE hosts SET role = 'god' WHERE name = 'Maya'").run(), 'the database refuses a second one too');

  assert.equal(hosts.demote()?.name, 'Jose');
  assert.equal(hosts.godPotato(), undefined);
  assert.ok(hosts.promote('Maya').ok);
  hosts.revoke('Maya');
  assert.equal(hosts.godPotato(), undefined, 'a revoked God Potato loses the role');
  assert.equal(hosts.promote('Maya').ok, false, 'revoked hosts cannot be promoted');
});

test('the rate limiter blocks after too many failures until the window passes', () => {
  let now = 0;
  const limit = new RateLimiter(3, 1000, () => now);
  for (let i = 0; i < 3; i++) {
    assert.equal(limit.wait('ip'), 0);
    limit.fail('ip');
    now += 100;
  }
  assert.equal(limit.wait('ip'), 700, 'first failure was at 0, window 1000, now 300');
  assert.equal(limit.wait('other'), 0);
  now = 1000;
  assert.equal(limit.wait('ip'), 0, 'the oldest failure dropped out');
  limit.fail('ip');
  limit.reset('ip');
  assert.equal(limit.wait('ip'), 0);
});

test('session cookies are httpOnly, strict, and clearable', () => {
  assert.equal(readCookie('a=1; cp_host=abc%3D; b=2', 'cp_host'), 'abc=');
  assert.equal(readCookie(undefined, 'cp_host'), undefined);
  assert.equal(readCookie('xcp_host=1', 'cp_host'), undefined);
  const set = sessionCookie('tok', REMEMBER_MS, true);
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.match(set, /Max-Age=2592000/);
  assert.match(set, /Secure/);
  assert.doesNotMatch(sessionCookie('tok', undefined, false), /Max-Age|Secure/);
  assert.match(sessionCookie('', undefined, false), /Max-Age=0/);
});
