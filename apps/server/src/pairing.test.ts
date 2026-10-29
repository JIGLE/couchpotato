import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_CODE_LENGTH, Pairings, RENEW_MS, newClaimCode, normaliseClaim } from './pairing.ts';

function setup() {
  let now = 0;
  let n = 0;
  const pairings = new Pairings(() => now, () => `CODE${String(n++).padStart(2, '0')}`);
  return { pairings, tick: (ms: number) => (now += ms) };
}

test('claim codes use the room-code alphabet', () => {
  const code = newClaimCode();
  assert.equal(code.length, CLAIM_CODE_LENGTH);
  assert.match(code, /^[A-HJ-NP-Z2-9]+$/);
  assert.equal(normaliseClaim(' ab-c 12 3 '), 'ABC123');
});

test('a code works once and only for its TV', () => {
  const { pairings } = setup();
  const tv1 = pairings.issue('tv1');
  const tv2 = pairings.issue('tv2');
  assert.notEqual(tv1.code, tv2.code);
  assert.equal(pairings.claim(tv1.code.toLowerCase()), 'tv1');
  assert.equal(pairings.claim(tv1.code), undefined, 'used');
  assert.equal(pairings.has('tv1'), false);
  assert.equal(pairings.claim('NOPE00'), undefined);
  assert.equal(pairings.claim(tv2.code), 'tv2');
});

test('codes renew every minute; the previous one works until the next renewal', () => {
  const { pairings, tick } = setup();
  const first = pairings.issue('tv');
  tick(RENEW_MS - 1);
  assert.deepEqual(pairings.renew(), []);
  tick(1);
  const [[tvId, second]] = pairings.renew();
  assert.equal(tvId, 'tv');
  assert.notEqual(second.code, first.code);
  assert.equal(second.renewsAt, 2 * RENEW_MS);

  tick(RENEW_MS);
  const [[, third]] = pairings.renew();
  assert.equal(pairings.claim(first.code), undefined, 'two renewals old');
  assert.equal(pairings.claim(second.code), 'tv', 'one renewal old still works');
  assert.equal(pairings.claim(third.code), undefined, 'claiming used up all of the TV codes');
});

test('a TV that leaves takes its codes with it; issuing again replaces the old code', () => {
  const { pairings } = setup();
  const a = pairings.issue('tv');
  const b = pairings.issue('tv');
  assert.equal(pairings.claim(a.code), undefined);
  pairings.drop('tv');
  assert.equal(pairings.claim(b.code), undefined);
});
