import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GameView } from '@couchpotato/shared';
import type { PlayableQuestion } from './packs.ts';
import { LEADERBOARD_MS, MAX_POINTS, MIN_POINTS, REVEAL_MS, STREAK_BONUS, TriviaGame } from './trivia.ts';

const Q = (id: string, correct = 1): PlayableQuestion => ({
  id,
  category: 'test',
  text: `Question ${id}?`,
  answers: ['A', 'B', 'C', 'D'],
  correct,
  fact: 'A fact.',
});

const players = [
  { id: 'maya', name: 'Maya' },
  { id: 'jose', name: 'Jose' },
];

function game(rounds = 3, seconds = 20) {
  let now = 1_000_000;
  const qs = Array.from({ length: rounds }, (_, i) => Q(`q${i + 1}`));
  const g = new TriviaGame(qs, { language: 'en', rounds, seconds }, players, now);
  g.setPresent(['maya', 'jose'], now);
  return {
    g,
    get now() {
      return now;
    },
    at: (ms: number) => (now += ms),
    /** Advance through reveal and leaderboard to the next question (or the podium). */
    next() {
      g.advance((now += 10_000_000)); // question → reveal (deadline long gone)
      g.advance((now += REVEAL_MS));
      g.advance((now += LEADERBOARD_MS));
    },
  };
}

const phase = (v: GameView) => v.phase;

test('a whole game goes question → reveal → leaderboard → … → podium', () => {
  const t = game(2);
  assert.equal(phase(t.g.tvView(t.now)), 'question');
  t.g.advance(t.at(20_000));
  assert.equal(phase(t.g.tvView(t.now)), 'reveal');
  t.g.advance(t.at(REVEAL_MS));
  assert.equal(phase(t.g.tvView(t.now)), 'leaderboard');
  t.g.advance(t.at(LEADERBOARD_MS));
  const v = t.g.tvView(t.now);
  assert.ok(v.phase === 'question' && v.round === 2);
  t.g.advance(t.at(20_000));
  t.g.advance(t.at(REVEAL_MS));
  assert.equal(phase(t.g.tvView(t.now)), 'podium', 'no leaderboard after the last question');
  assert.equal(t.g.over, true);
});

test('nothing moves before a deadline', () => {
  const t = game();
  assert.equal(t.g.advance(t.at(19_999)), false);
  assert.equal(phase(t.g.tvView(t.now)), 'question');
});

test('faster right answers score more; wrong and missing answers score nothing', () => {
  const t = game(1, 20);
  const start = t.now;
  assert.ok(t.g.answer('maya', 1, start)); // instant and right
  assert.ok(t.g.answer('jose', 2, start + 5_000)); // wrong
  t.g.advance(t.at(20_000));
  const s = t.g.standings();
  assert.equal(s.find((x) => x.id === 'maya')!.score, MAX_POINTS);
  assert.equal(s.find((x) => x.id === 'jose')!.score, 0);

  const u = game(1, 20);
  u.g.answer('maya', 1, u.now + 20_000); // right at the buzzer
  u.g.advance(u.at(20_000));
  assert.equal(u.g.standings().find((x) => x.id === 'maya')!.score, MIN_POINTS);
});

test('the round ends early once everyone present has answered', () => {
  const t = game();
  t.g.answer('maya', 0, t.now);
  assert.equal(t.g.advance(t.now), false, 'still waiting for Jose');
  t.g.answer('jose', 1, t.at(3_000));
  assert.equal(t.g.advance(t.now), true);
  assert.equal(phase(t.g.tvView(t.now)), 'reveal');
});

test('a player who dropped is not waited for, but nobody answering does not end it early', () => {
  const t = game();
  t.g.setPresent(['maya'], t.now);
  assert.equal(t.g.advance(t.now), false, 'zero answers never ends early');
  t.g.answer('maya', 1, t.at(1_000));
  assert.equal(t.g.advance(t.now), true);
});

test('late, repeated and invalid answers are ignored', () => {
  const t = game(1, 10);
  assert.equal(t.g.answer('maya', 7, t.now), false, 'no such answer');
  assert.equal(t.g.answer('ghost', 1, t.now), false, 'not a player');
  assert.ok(t.g.answer('maya', 0, t.now));
  assert.equal(t.g.answer('maya', 1, t.now), false, 'first pick counts');
  assert.equal(t.g.answer('jose', 1, t.now + 10_001), false, 'after the buzzer');
});

test('three right answers in a row earn the streak bonus; a miss resets it', () => {
  const t = game(4);
  for (let r = 0; r < 3; r++) {
    t.g.answer('maya', 1, t.now);
    t.next();
  }
  const s = t.g.standings().find((x) => x.id === 'maya')!;
  assert.equal(s.streak, 3);
  assert.equal(s.score, 3 * MAX_POINTS + STREAK_BONUS);
  t.g.answer('maya', 0, t.now);
  t.g.advance(t.at(20_000));
  assert.equal(t.g.standings().find((x) => x.id === 'maya')!.streak, 0);
});

test('ties share a rank, and the leaderboard shows who moved', () => {
  const t = game(3);
  t.g.answer('maya', 1, t.now);
  t.g.answer('jose', 1, t.now);
  t.g.advance(t.at(1));
  assert.deepEqual(t.g.standings().map((s) => s.rank), [1, 1]);
  t.next();
  t.g.answer('jose', 1, t.now); // only Jose this time
  t.g.advance(t.at(20_000));
  const jose = t.g.standings().find((x) => x.id === 'jose')!;
  assert.equal(jose.rank, 1);
  assert.equal(jose.moved, 0, 'was tied first, still first');
  assert.equal(t.g.standings().find((x) => x.id === 'maya')!.moved, -1);
});

test('phones never see the question text, the TV never sees phone-only fields', () => {
  const t = game();
  const tv = t.g.tvView(t.now);
  const phone = t.g.phoneView('maya', t.now);
  assert.ok(tv.phase === 'question' && tv.text && tv.answers && !('myChoice' in tv));
  assert.ok(phone.phase === 'question' && !phone.text && !phone.answers && phone.myChoice === null && phone.canAnswer);
  t.g.answer('maya', 2, t.now);
  const after = t.g.phoneView('maya', t.now);
  assert.ok(after.phase === 'question' && after.myChoice === 2);
});

test('the reveal tells each phone its own result and the TV who picked what', () => {
  const t = game();
  t.g.answer('maya', 1, t.now);
  t.g.answer('jose', 3, t.now);
  t.g.advance(t.now);
  const tv = t.g.tvView(t.now);
  assert.ok(tv.phase === 'reveal');
  assert.deepEqual(tv.pickedBy, [[], ['maya'], [], ['jose']]);
  assert.equal(tv.fact, 'A fact.');
  const jose = t.g.phoneView('jose', t.now);
  assert.ok(jose.phase === 'reveal' && jose.me && jose.me.correct === false && jose.me.choice === 3 && jose.me.rank === 2);
});

test('someone joining mid-question waits for the next one and starts from the average score', () => {
  const t = game(3);
  t.g.answer('maya', 1, t.now);
  t.g.answer('jose', 0, t.now);
  t.next(); // Maya 1000, Jose 0 → average 500
  t.at(2_000);
  t.g.addPlayer('lina', 'Lina', t.now);
  t.g.setPresent(['maya', 'jose', 'lina'], t.now);
  const v = t.g.phoneView('lina', t.now);
  assert.ok(v.phase === 'question' && v.canAnswer === false);
  assert.equal(t.g.answer('lina', 1, t.now), false);
  assert.equal(t.g.standings().find((x) => x.id === 'lina')!.score, 500);

  t.g.answer('maya', 1, t.now);
  t.g.answer('jose', 1, t.now);
  assert.equal(t.g.advance(t.now), true, "Lina isn't waited for this round");

  t.g.advance(t.at(REVEAL_MS));
  t.g.advance(t.at(LEADERBOARD_MS));
  assert.ok(t.g.answer('lina', 1, t.now), 'and plays from the next question');
});

test('no time limit: the question waits until everyone has answered', () => {
  const t = game(1, 0);
  assert.equal(t.g.tvView(t.now).phase === 'question' && t.g.tvView(t.now).endsAt, null);
  assert.equal(t.g.advance(t.at(10 * 60_000)), false);
  t.g.answer('maya', 1, t.now);
  t.g.answer('jose', 1, t.now);
  assert.equal(t.g.advance(t.now), true);
});

test('settings from the TV are cleaned up', async () => {
  const { parseSettings } = await import('./trivia.ts');
  assert.deepEqual(parseSettings(undefined), { language: 'en', rounds: 10, seconds: 20 });
  assert.deepEqual(parseSettings({ language: 'pt-PT', rounds: 5, seconds: 0, youngest: 9, regions: ['PT', 'PT', 'es', 'ES'] }), {
    language: 'pt-PT',
    rounds: 5,
    seconds: 0,
    youngest: 9,
    regions: ['PT', 'ES'],
  });
  assert.deepEqual(parseSettings({ language: 'da', rounds: 500, seconds: 7, youngest: 1.5, regions: 'PT' }), {
    language: 'en',
    rounds: 10,
    seconds: 20,
  });
});
