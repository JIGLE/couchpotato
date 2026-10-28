import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Couch, HOLD_MS, isToken, newToken } from './couch.ts';

function setup(seats = 8) {
  let now = 0;
  const couch = new Couch(() => now, newToken, seats);
  return { couch, tick: (ms: number) => (now += ms) };
}

test('tokens are 32 hex characters and validated', () => {
  assert.ok(isToken(newToken()));
  assert.equal(isToken('nope'), false);
  assert.equal(isToken(undefined), false);
  assert.equal(isToken('A'.repeat(32)), false);
});

test('a new phone gets the lowest free seat, a token, and a public id that is not the token', () => {
  const { couch } = setup();
  const a = couch.sit(undefined, 's1', 'Maya', 1);
  const b = couch.sit(undefined, 's2', 'Jose', 0);
  assert.ok(a.ok && b.ok);
  assert.equal(a.player.seat, 0);
  assert.equal(b.player.seat, 1);
  assert.ok(isToken(a.token));
  assert.notEqual(a.player.id, a.token);
  assert.ok(!a.token.startsWith(a.player.id), 'public id must not leak the token');
  assert.equal(a.rejoined, false);
});

test('a dropped phone is shown as away and gets the same seat and colour back with its token', () => {
  const { couch, tick } = setup();
  couch.sit(undefined, 's1', 'Maya', 0);
  const jose = couch.sit(undefined, 's2', 'Jose', 3);
  assert.ok(jose.ok);

  couch.drop('s2');
  assert.equal(couch.list().find((p) => p.name === 'Jose')?.away, true);

  tick(HOLD_MS - 1);
  couch.sweep();
  const back = couch.sit(jose.token, 's3', 'Jose', 0);
  assert.ok(back.ok);
  assert.equal(back.rejoined, true);
  assert.equal(back.player.seat, jose.player.seat);
  assert.equal(back.player.colour, 3, 'keeps the original colour');
  assert.equal(back.player.id, jose.player.id);
  assert.equal(back.player.away, false);
});

test('a held seat is not given to a newcomer', () => {
  const { couch } = setup(2);
  const a = couch.sit(undefined, 's1', 'A', 0);
  couch.sit(undefined, 's2', 'B', 0);
  assert.ok(a.ok);
  couch.drop('s1');
  assert.deepEqual(couch.sit(undefined, 's3', 'C', 0), { ok: false, reason: 'full' });
});

test('the seat frees after the hold time, and the old token then sits as a newcomer', () => {
  const { couch, tick } = setup();
  const a = couch.sit(undefined, 's1', 'A', 2);
  assert.ok(a.ok);
  couch.drop('s1');
  tick(HOLD_MS);
  assert.equal(couch.sweep(), true);
  assert.equal(couch.list().length, 0);
  const again = couch.sit(a.token, 's2', 'A', 1);
  assert.ok(again.ok);
  assert.equal(again.rejoined, false);
  assert.notEqual(again.token, a.token);
  assert.equal(again.player.colour, 1);
});

test('leaving on purpose frees the seat straight away', () => {
  const { couch } = setup();
  couch.sit(undefined, 's1', 'A', 0);
  assert.equal(couch.leave('s1'), true);
  assert.equal(couch.list().length, 0);
});

test('a second tab with the same token takes over; the old tab dropping does not mark the player away', () => {
  const { couch } = setup();
  const a = couch.sit(undefined, 's1', 'A', 0);
  assert.ok(a.ok);
  couch.sit(a.token, 's2', 'A', 0);
  assert.equal(couch.drop('s1'), false);
  assert.equal(couch.list()[0].away, false);
});

test('a forged or malformed token never steals a seat', () => {
  const { couch } = setup();
  couch.sit(undefined, 's1', 'A', 0);
  const intruder = couch.sit('0'.repeat(32), 's2', 'B', 0);
  assert.ok(intruder.ok);
  assert.equal(intruder.rejoined, false);
  assert.equal(intruder.player.seat, 1);
  assert.notEqual(intruder.token, '0'.repeat(32), 'the server issues its own token');
});

test('each phone gets the potato it asked for, or a free one when it is taken', () => {
  const { couch } = setup();
  const a = couch.sit(undefined, 's1', 'A', 0, 'chip');
  const b = couch.sit(undefined, 's2', 'B', 0, 'chip');
  const c = couch.sit(undefined, 's3', 'C', 0, 'not-a-potato');
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(a.player.potato, 'chip');
  assert.equal(b.player.potato, 'boiled');
  assert.equal(c.player.potato, 'grilled');
});

test('a rejoining phone keeps its potato, even if it asks for another', () => {
  const { couch } = setup();
  const a = couch.sit(undefined, 's1', 'A', 0, 'jacket');
  assert.ok(a.ok);
  couch.drop('s1');
  const back = couch.sit(a.token, 's2', 'A', 0, 'fry');
  assert.ok(back.ok);
  assert.equal(back.player.potato, 'jacket');
});

test('a phone can swap to a free potato but not to one someone else has, away or not', () => {
  const { couch } = setup();
  couch.sit(undefined, 's1', 'A', 0, 'mashed');
  couch.sit(undefined, 's2', 'B', 0, 'sweet');
  couch.drop('s2');
  assert.equal(couch.pick('s1', 'sweet'), false);
  assert.equal(couch.pick('s1', 'mashed'), false, 'same potato is not a change');
  assert.equal(couch.pick('s1', 'nope'), false);
  assert.equal(couch.pick('s1', 'hashbrown'), true);
  assert.equal(couch.list()[0].potato, 'hashbrown');
});

test('eight seats use all eight potatoes', () => {
  const { couch } = setup();
  for (let i = 0; i < 8; i++) assert.ok(couch.sit(undefined, `s${i}`, `P${i}`, 0, 'boiled').ok);
  assert.equal(new Set(couch.list().map((p) => p.potato)).size, 8);
  assert.equal(couch.sit(undefined, 's9', 'Late', 0).ok, false);
});

test('the first phone on the couch is the Head Spud; the role passes on when they leave, not when they drop', () => {
  const { couch, tick } = setup();
  couch.sit(undefined, 's1', 'Ana', 0);
  couch.sit(undefined, 's2', 'Rui', 0);
  couch.sit(undefined, 's3', 'Maya', 0);
  const role = (name: string) => couch.list().find((p) => p.name === name)?.role;
  assert.equal(role('Ana'), 'head-spud');
  assert.equal(role('Rui'), 'potato');
  assert.ok(couch.isHeadSpud('s1'));
  assert.equal(couch.isHeadSpud('s2'), false);

  couch.drop('s1');
  assert.equal(role('Ana'), 'head-spud', 'a dropped Head Spud keeps the role while the seat is held');

  tick(HOLD_MS);
  couch.sweep();
  assert.equal(role('Rui'), 'head-spud');
  couch.leave('s2');
  assert.equal(role('Maya'), 'head-spud');
  assert.ok(couch.isHeadSpud('s3'));
});
