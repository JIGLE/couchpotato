import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_ALPHABET, CODE_LENGTH, EMPTY_TTL_MS, MAX_SEATS, RoomStore, cushion, freeSeat, isMood, generateCode, normaliseCode } from './rooms.ts';

test('codes are 4 characters from the safe alphabet', () => {
  for (let i = 0; i < 500; i++) {
    const code = generateCode(() => false);
    assert.equal(code.length, CODE_LENGTH);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `unexpected ${ch}`);
    assert.doesNotMatch(code, /[01OI]/);
  }
});

test('generateCode skips codes that are taken', () => {
  // rng walks 0, then 0.5, so the first code is AAAA (taken), the second is not.
  const values = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
  let i = 0;
  const code = generateCode((c) => c === 'AAAA', () => values[i++]);
  assert.notEqual(code, 'AAAA');
  assert.equal(code.length, 4);
});

test('generateCode gives up instead of looping forever', () => {
  assert.throws(() => generateCode(() => true));
});

test('normaliseCode cleans what people type', () => {
  assert.equal(normaliseCode(' spud '), 'SPUD');
  assert.equal(normaliseCode('sp-ud!'), 'SPUD');
  assert.equal(normaliseCode('spudster'), 'SPUD');
});

test('two rooms get different codes and are found case-insensitively', () => {
  const store = new RoomStore();
  const a = store.create();
  const b = store.create();
  assert.notEqual(a.code, b.code);
  assert.equal(store.get(a.code.toLowerCase()), a);
  assert.equal(store.get('ZZZZ9'), store.get('ZZZZ'));
});

test('joining an unknown room returns undefined', () => {
  const store = new RoomStore();
  assert.equal(store.join('NOPE', 'socket-1'), undefined);
});

test('a room expires 30 minutes after it becomes empty, not before', () => {
  let now = 1_000_000;
  const store = new RoomStore(() => now);
  const room = store.create();
  store.join(room.code, 'tv');

  now += EMPTY_TTL_MS * 2;
  assert.deepEqual(store.sweep(), [], 'occupied rooms never expire');

  store.leave(room.code, 'tv');
  now += EMPTY_TTL_MS - 1;
  assert.deepEqual(store.sweep(), []);

  now += 1;
  assert.deepEqual(store.sweep(), [room.code]);
  assert.equal(store.get(room.code), undefined);
});

test('rejoining before expiry keeps the room alive', () => {
  let now = 0;
  const store = new RoomStore(() => now);
  const room = store.create();
  store.join(room.code, 'tv');
  store.leave(room.code, 'tv');
  now += EMPTY_TTL_MS - 10;
  store.join(room.code, 'tv-again');
  now += EMPTY_TTL_MS;
  assert.deepEqual(store.sweep(), []);
  assert.equal(store.size, 1);
});

test('freeSeat fills the lowest gap and reports a full couch', () => {
  assert.equal(freeSeat([]), 0);
  assert.equal(freeSeat([0, 1, 3]), 2);
  assert.equal(freeSeat([...Array(MAX_SEATS).keys()]), -1);
});

test('cushion keeps a valid pick and falls back for anything else', () => {
  assert.equal(cushion(2, 0), 2);
  assert.equal(cushion(undefined, 5), 1);
  assert.equal(cushion(7, 2), 2);
  assert.equal(cushion(1.5, 3), 3);
  assert.equal(cushion('0', 0), 0);
  assert.equal(cushion(-1, -1), 0);
});

test('rooms start in Lamp Light and only accept known moods', () => {
  assert.equal(new RoomStore().create().mood, 'lamp');
  assert.ok(isMood('velvet'));
  assert.equal(isMood('disco'), false);
  assert.equal(isMood(undefined), false);
});
