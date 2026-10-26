import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TriviaPack, TriviaQuestion } from '@couchpotato/shared';
import { pickQuestions, summarize, validatePack } from './packs.ts';

const q = (over: Partial<TriviaQuestion> = {}): TriviaQuestion => ({
  id: 'q1',
  category: 'test',
  text: { en: 'Two plus two?', 'pt-PT': 'Dois mais dois?' },
  answers: { en: ['3', '4'], 'pt-PT': ['3', '4'] },
  correct: 1,
  ...over,
});

const pack = (questions: unknown[], over: object = {}) => ({
  format: 'couchpotato.trivia/1',
  id: 'test',
  title: { en: 'Test' },
  author: 'Me',
  questions,
  ...over,
});

const ok = (raw: unknown) => {
  const r = validatePack(raw);
  assert.ok(r.ok, r.ok ? '' : r.errors.join(', '));
  return r;
};

test('a good pack validates', () => {
  const r = ok(pack([q()]));
  assert.equal(r.pack.questions.length, 1);
  assert.deepEqual(r.warnings, []);
});

test('pack-level problems reject the whole pack with clear messages', () => {
  const r = validatePack(pack([q()], { format: 'nope', id: 'Bad Id' }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('format')));
  assert.ok(!r.ok && r.errors.some((e) => e.includes('id')));
  assert.equal(validatePack('hello').ok, false);
});

test('a shared pack must say how it may be reused', () => {
  assert.equal(validatePack(pack([q()], { visibility: 'shared' })).ok, false);
  ok(pack([q()], { visibility: 'shared', license: 'CC-BY-4.0' }));
});

test('one broken question is dropped with a warning, the rest of the pack still loads', () => {
  const r = ok(
    pack([
      q(),
      q({ id: 'bad-correct', correct: 5 }),
      q({ id: 'too-few', answers: { en: ['only one'] } }),
      q({ id: 'mismatch', answers: { en: ['a', 'b'], 'pt-PT': ['a', 'b', 'c'] } }),
      q({ id: 'dupe-answers', answers: { en: ['Yes', 'yes'] } }),
      q({ id: 'bad-region', regions: ['portugal'] }),
      q(), // duplicate id
    ]),
  );
  assert.deepEqual(r.pack.questions.map((x) => x.id), ['q1']);
  assert.equal(r.warnings.length, 6);
});

test('a pack with no usable questions is rejected', () => {
  assert.equal(validatePack(pack([q({ correct: 9 })])).ok, false);
});

test('picking respects language, age, region and AI review', () => {
  const p = ok(
    pack([
      q({ id: 'everyone' }),
      q({ id: 'english-only', text: { en: 'Hi?' }, answers: { en: ['a', 'b'] } }),
      q({ id: 'grown-ups', minAge: 16 }),
      q({ id: 'portugal', regions: ['PT'] }),
      q({ id: 'ai-draft', source: 'ai' }),
      q({ id: 'ai-checked', source: 'ai', reviewed: true }),
    ]),
  ).pack;
  const ids = (a: Parameters<typeof pickQuestions>[1]) => pickQuestions([p], a, 99).map((x) => x.id).sort();

  assert.deepEqual(ids({ language: 'pt-PT' }), ['ai-checked', 'everyone', 'grown-ups']);
  assert.deepEqual(ids({ language: 'pt-PT', youngest: 10, regions: ['PT'] }), ['ai-checked', 'everyone', 'portugal']);
  assert.deepEqual(ids({ language: 'en', youngest: 30, exclude: ['everyone'] }), ['ai-checked', 'english-only', 'grown-ups']);
});

test('answers are shuffled but the right answer stays right', () => {
  const p = ok(pack([q({ answers: { en: ['a', 'b', 'c', 'd'] }, text: { en: 'x' }, correct: 2 })])).pack;
  const seen = new Set<string>();
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 50; i++) {
    const [played] = pickQuestions([p], { language: 'en' }, 1, rng);
    assert.equal(played.answers[played.correct], 'c');
    seen.add(played.answers.join(''));
  }
  assert.ok(seen.size > 1, 'order should vary');
});

test('the starter pack is valid, fully translated, and covers every age band', () => {
  const file = fileURLToPath(new URL('../packs/starter.json', import.meta.url));
  const r = ok(JSON.parse(readFileSync(file, 'utf8')));
  assert.deepEqual(r.warnings, []);
  const s = summarize(r.pack as TriviaPack);
  assert.deepEqual(s.languages, ['en', 'pt-PT', 'es-ES']);
  for (const lang of s.languages) {
    for (const question of r.pack.questions) {
      assert.ok(question.text[lang] && question.answers[lang], `${question.id} is missing ${lang}`);
      if (question.fact) assert.ok(question.fact[lang], `${question.id} fact is missing ${lang}`);
    }
  }
  assert.ok(pickQuestions([r.pack], { language: 'en', youngest: 8 }, 99).length >= 10, 'enough for a game with 8-year-olds');
  assert.ok(s.questions >= 30);
});
