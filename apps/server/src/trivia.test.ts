import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GameView } from '@couchpotato/shared';
import type { PlayableQuestion } from './packs.ts';
import { EXTRA_TIME_MS, LEADERBOARD_MS, MAX_POINTS, MIN_POINTS, REVEAL_MS, STREAK_BONUS, TriviaGame } from './trivia.ts';

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

test('someone joining during the reveal or leaderboard sits out until the next question', () => {
  const t = game(3);
  t.g.answer('maya', 1, t.now);
  t.g.answer('jose', 1, t.now);
  t.g.advance(t.now); // reveal of question 1
  t.g.addPlayer('lina', 'Lina', t.at(1_000));
  t.g.setPresent(['maya', 'jose', 'lina'], t.now);
  const reveal = t.g.phoneView('lina', t.now);
  assert.ok(reveal.phase === 'reveal' && reveal.waiting === true, "Lina sees 'You're in next round', not 'Too slow!'");
  const maya = t.g.phoneView('maya', t.now);
  assert.ok(maya.phase === 'reveal' && maya.waiting === false);

  t.g.advance(t.at(REVEAL_MS));
  t.g.addPlayer('ana', 'Ana', t.at(1_000));
  t.g.setPresent(['maya', 'jose', 'lina', 'ana'], t.now);
  const board = t.g.phoneView('ana', t.now);
  assert.ok(board.phase === 'leaderboard' && board.waiting === true);
  assert.equal(t.g.standings().find((x) => x.id === 'ana')!.score, MAX_POINTS, 'average of everyone already seated');

  t.g.advance(t.at(LEADERBOARD_MS));
  for (const id of ['lina', 'ana']) {
    const v = t.g.phoneView(id, t.now);
    assert.ok(v.phase === 'question' && v.canAnswer, `${id} plays question 2`);
  }
  assert.ok(t.g.answer('lina', 1, t.now));
  assert.ok(t.g.answer('ana', 1, t.now));
});

test('nobody joins once the podium is up', () => {
  const t = game(1);
  t.next();
  assert.equal(t.g.over, true);
  t.g.addPlayer('lina', 'Lina', t.now);
  assert.equal(t.g.standings().some((x) => x.id === 'lina'), false);
});

test('a player who leaves keeps their score, shown as away', () => {
  const t = game(2);
  t.g.answer('maya', 1, t.now);
  t.g.answer('jose', 1, t.now);
  t.g.advance(t.now);
  t.g.setPresent(['maya'], t.now); // Jose leaves
  const jose = t.g.standings().find((x) => x.id === 'jose')!;
  assert.equal(jose.score, MAX_POINTS);
  assert.equal(jose.away, true);
  assert.equal(t.g.standings().find((x) => x.id === 'maya')!.away, false);
  t.g.setPresent(['maya', 'jose'], t.now); // and comes back
  assert.equal(t.g.standings().find((x) => x.id === 'jose')!.away, false);
});

test('the last unanswered player leaving ends the question straight away', () => {
  const t = game(2, 0); // no time limit, so only answers can end it
  t.g.answer('maya', 1, t.at(1_000));
  assert.equal(t.g.advance(t.now), false, 'waiting for Jose');
  t.g.setPresent(['maya'], t.at(1_000));
  assert.equal(t.g.advance(t.now), true);
  assert.equal(phase(t.g.tvView(t.now)), 'reveal');
});

test('a game with no time limit never stalls when everyone who could answer has left', () => {
  const t = game(2, 0);
  t.at(1_000);
  t.g.addPlayer('lina', 'Lina', t.now); // waits for question 2
  t.g.setPresent(['maya', 'jose', 'lina'], t.now);
  assert.equal(t.g.advance(t.now), false);
  t.g.setPresent(['lina'], t.at(1_000)); // Maya and Jose leave without answering
  assert.equal(t.g.advance(t.now), true, "Lina isn't left looking at 'You're in next round' forever");
  t.g.advance(t.at(REVEAL_MS));
  t.g.advance(t.at(LEADERBOARD_MS));
  assert.ok(t.g.answer('lina', 1, t.now));
  assert.equal(t.g.advance(t.now), true, 'and her answer ends question 2');
});

test('someone who answered and then left still counts as locked in', () => {
  const t = game();
  t.g.answer('jose', 1, t.now);
  t.g.setPresent(['maya'], t.now);
  const v = t.g.tvView(t.now);
  assert.ok(v.phase === 'question' && v.answered === 1 && v.players === 2, '1 of 2, never 1 of 1 or 2 of 1');
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

test('pausing freezes the clock and answers, and the pause does not cost answer speed', () => {
  const t = game(2, 20);
  t.at(5_000);
  assert.equal(t.g.pause(t.now), true);
  assert.equal(t.g.pause(t.now), false, 'already paused');
  const v = t.g.tvView(t.now);
  assert.ok(v.phase === 'question' && v.paused && v.left === 15_000 && v.endsAt === null);
  assert.equal(t.g.answer('maya', 1, t.at(1_000)), false, 'no answers while paused');
  assert.equal(t.g.advance(t.at(60_000)), false, 'the clock is frozen');

  assert.equal(t.g.resume(t.now), true);
  const after = t.g.tvView(t.now);
  assert.ok(after.phase === 'question' && !after.paused && after.endsAt === t.now + 15_000);
  // Maya answers right away after the pause: 5 s in, not 66 s.
  assert.ok(t.g.answer('maya', 1, t.now));
  t.g.next(t.now);
  const maya = t.g.standings().find((s) => s.id === 'maya')!;
  assert.equal(maya.lastPoints, Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * (5 / 20)));
});

test('+10 s extends an open timed question, also while paused, but not an untimed one', () => {
  const t = game(2, 20);
  assert.equal(t.g.addTime(t.now), true);
  const v = t.g.tvView(t.now);
  assert.ok(v.phase === 'question' && v.endsAt === t.now + 20_000 + EXTRA_TIME_MS);
  t.g.pause(t.now);
  t.g.addTime(t.now);
  const p = t.g.tvView(t.now);
  assert.ok(p.phase === 'question' && p.left === 20_000 + 2 * EXTRA_TIME_MS);
  assert.equal(game(2, 0).g.addTime(1_000_000), false);
});

test('next reveals now; skip drops the question without scoring', () => {
  const t = game(2, 20);
  t.g.answer('maya', 1, t.at(1_000));
  assert.equal(t.g.next(t.now), true);
  assert.equal(phase(t.g.tvView(t.now)), 'reveal');
  assert.equal(t.g.next(t.now), true);
  assert.equal(phase(t.g.tvView(t.now)), 'leaderboard');
  t.g.next(t.now);
  const before = t.g.standings().find((s) => s.id === 'maya')!.score;
  t.g.answer('maya', 1, t.at(1_000));
  assert.equal(t.g.skip(t.now), true);
  assert.equal(phase(t.g.tvView(t.now)), 'podium', 'skipping the last question ends the game');
  assert.equal(t.g.standings().find((s) => s.id === 'maya')!.score, before, 'nobody scores a skipped question');
  assert.equal(t.g.next(t.now), false);
});

test('a kicked player leaves the game and the leaderboard', () => {
  const t = game(2, 20);
  t.g.answer('maya', 1, t.at(1_000));
  assert.equal(t.g.removePlayer('jose', t.now), true);
  assert.deepEqual(t.g.standings().map((s) => s.id), ['maya']);
  t.g.advance(t.now);
  assert.equal(phase(t.g.tvView(t.now)), 'reveal', 'everyone left has answered');
});
