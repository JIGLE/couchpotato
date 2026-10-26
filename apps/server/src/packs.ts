// Trivia packs: validate, summarise, and pick questions for a game.
// Pure functions except loadPacks, so everything else is unit-tested.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Language, PackSummary, TriviaPack, TriviaQuestion } from '@couchpotato/shared';

export const LANGUAGES: readonly Language[] = ['en', 'pt-PT', 'es-ES'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REGION_RE = /^[A-Z]{2}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export type Validation = { ok: true; pack: TriviaPack; warnings: string[] } | { ok: false; errors: string[] };

/**
 * Check a pack read from JSON. Errors make the whole pack unusable; warnings only drop
 * single questions (so one typo doesn't sink a 200-question pack).
 */
export function validatePack(raw: unknown): Validation {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['pack is not a JSON object'] };
  if (raw.format !== 'couchpotato.trivia/1') errors.push('format must be "couchpotato.trivia/1"');
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) errors.push('id must be lowercase letters, digits and dashes');
  if (!isLocalizedText(raw.title)) errors.push('title needs at least one language');
  if (!isText(raw.author)) errors.push('author is required');
  if (raw.visibility !== undefined && raw.visibility !== 'private' && raw.visibility !== 'shared')
    errors.push('visibility must be "private" or "shared"');
  if (raw.visibility === 'shared' && !isText(raw.license)) errors.push('a shared pack needs a license');
  if (!Array.isArray(raw.questions)) errors.push('questions must be a list');
  if (errors.length) return { ok: false, errors };

  const warnings: string[] = [];
  const seen = new Set<string>();
  const questions: TriviaQuestion[] = [];
  (raw.questions as unknown[]).forEach((q, i) => {
    const problems = questionProblems(q);
    const id = isObj(q) && typeof q.id === 'string' ? q.id : `#${i + 1}`;
    if (!problems.length && seen.has(id)) problems.push('duplicate id');
    if (problems.length) {
      warnings.push(`question ${id}: ${problems.join('; ')}`);
      return;
    }
    seen.add(id);
    questions.push(q as TriviaQuestion);
  });
  if (!questions.length) return { ok: false, errors: ['no usable questions', ...warnings] };

  return { ok: true, pack: { ...(raw as unknown as TriviaPack), questions }, warnings };
}

function isLocalizedText(v: unknown): boolean {
  return isObj(v) && LANGUAGES.some((l) => isText(v[l])) && Object.keys(v).every((k) => LANGUAGES.includes(k as Language));
}

function questionProblems(q: unknown): string[] {
  if (!isObj(q)) return ['not an object'];
  const p: string[] = [];
  if (typeof q.id !== 'string' || !ID_RE.test(q.id)) p.push('id must be lowercase letters, digits and dashes');
  if (!isText(q.category)) p.push('category is required');
  if (q.minAge !== undefined && !(Number.isInteger(q.minAge) && (q.minAge as number) >= 0 && (q.minAge as number) <= 99))
    p.push('minAge must be a whole number 0–99');
  if (q.regions !== undefined && !(Array.isArray(q.regions) && q.regions.every((r) => typeof r === 'string' && REGION_RE.test(r))))
    p.push('regions must be two-letter country codes like "PT"');
  if (q.source !== undefined && q.source !== 'manual' && q.source !== 'ai') p.push('source must be "manual" or "ai"');
  if (!isLocalizedText(q.text)) p.push('text needs at least one language');
  if (!isObj(q.answers)) {
    p.push('answers needs at least one language');
    return p;
  }
  const lists = Object.entries(q.answers);
  if (!lists.length) p.push('answers needs at least one language');
  let size: number | null = null;
  for (const [lang, list] of lists) {
    if (!LANGUAGES.includes(lang as Language)) p.push(`unknown language "${lang}"`);
    else if (!Array.isArray(list) || list.length < 2 || list.length > 4 || !list.every(isText)) p.push(`answers.${lang} must be 2–4 texts`);
    else if (new Set(list.map((a: string) => a.trim().toLowerCase())).size !== list.length) p.push(`answers.${lang} has duplicates`);
    else if (size !== null && list.length !== size) p.push('every language needs the same number of answers');
    else size = list.length;
  }
  if (!Number.isInteger(q.correct) || size === null || (q.correct as number) < 0 || (q.correct as number) >= size)
    p.push('correct must point at one of the answers');
  return p;
}

/** Languages the question can be played in: it has the question and the answers. The fun fact is optional. */
export function questionLanguages(q: TriviaQuestion): Language[] {
  return LANGUAGES.filter((l) => isText(q.text[l]) && Array.isArray(q.answers[l]));
}

export function summarize(pack: TriviaPack): PackSummary {
  const languages = LANGUAGES.filter((l) => pack.questions.some((q) => questionLanguages(q).includes(l)));
  const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
  return {
    id: pack.id,
    title: pack.title,
    description: pack.description,
    author: pack.author,
    languages,
    questions: pack.questions.length,
    categories: sorted(pack.questions.map((q) => q.category)),
    regions: sorted(pack.questions.flatMap((q) => q.regions ?? [])),
    visibility: pack.visibility ?? 'private',
  };
}

export interface Audience {
  language: Language;
  /** Youngest player's age. Unknown = no age filter. */
  youngest?: number;
  /** Countries the group cares about. Global questions are always in; regional ones only if listed. */
  regions?: string[];
  /** Question ids to leave out, e.g. ones played recently. */
  exclude?: Iterable<string>;
}

/** A question ready to play: one language, answers shuffled, `correct` pointing into the shuffled list. */
export interface PlayableQuestion {
  id: string;
  category: string;
  text: string;
  answers: string[];
  correct: number;
  fact?: string;
}

export function eligible(q: TriviaQuestion, a: Audience): boolean {
  if (q.source === 'ai' && q.reviewed !== true) return false;
  if (!questionLanguages(q).includes(a.language)) return false;
  if (a.youngest !== undefined && (q.minAge ?? 0) > a.youngest) return false;
  const regions = q.regions ?? [];
  if (regions.length && !regions.some((r) => a.regions?.includes(r))) return false;
  return true;
}

export function pickQuestions(packs: TriviaPack[], audience: Audience, count: number, rng: () => number = Math.random): PlayableQuestion[] {
  const skip = new Set(audience.exclude ?? []);
  const pool = packs.flatMap((p) => p.questions.filter((q) => !skip.has(q.id) && eligible(q, audience)));
  return shuffle(pool, rng)
    .slice(0, count)
    .map((q) => {
      const answers = q.answers[audience.language]!;
      const order = shuffle([...answers.keys()], rng);
      return {
        id: q.id,
        category: q.category,
        text: q.text[audience.language]!,
        answers: order.map((i) => answers[i]),
        correct: order.indexOf(q.correct),
        fact: q.fact?.[audience.language],
      };
    });
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Read every *.json in `dir`. Broken packs are skipped with a log line, never a crash. */
export async function loadPacks(dir: string, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  const packs: TriviaPack[] = [];
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    log.warn({ dir }, 'no question packs folder');
    return packs;
  }
  for (const file of files) {
    try {
      const result = validatePack(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
      if (!result.ok) {
        log.warn({ file, errors: result.errors }, 'skipped broken question pack');
        continue;
      }
      if (packs.some((p) => p.id === result.pack.id)) {
        log.warn({ file, id: result.pack.id }, 'skipped pack with a duplicate id');
        continue;
      }
      if (result.warnings.length) log.warn({ file, warnings: result.warnings }, 'left out some questions');
      packs.push(result.pack);
      log.info({ file, id: result.pack.id, questions: result.pack.questions.length }, 'loaded question pack');
    } catch (err) {
      log.warn({ file, err: String(err) }, 'could not read question pack');
    }
  }
  return packs;
}
