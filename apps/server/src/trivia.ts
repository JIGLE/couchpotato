// The trivia game: rounds, timer, scoring and what each screen sees.
// No sockets and no real clock — `now` is always passed in — so whole games are unit-tested.

import type { GameSettings, GameView, Standing } from '@couchpotato/shared';
import type { PlayableQuestion } from './packs.js';

export const REVEAL_MS = 6_000;
export const LEADERBOARD_MS = 6_000;
/** Score range for a right answer: full points instantly, half at the buzzer. */
export const MAX_POINTS = 1000;
export const MIN_POINTS = 500;
/** From the third right answer in a row, each right answer earns this on top. */
export const STREAK_BONUS = 200;
export const STREAK_FROM = 3;
/** What "+10 s" on the Head Spud's remote adds. */
export const EXTRA_TIME_MS = 10_000;
/** With no timer, speed is measured against this. */
const UNTIMED_REFERENCE_MS = 20_000;

type Phase = 'question' | 'reveal' | 'leaderboard' | 'podium';

interface Seat {
  id: string;
  name: string;
  score: number;
  streak: number;
  lastPoints: number;
  rank: number;
  prevRank: number;
  /** Round from which this player may answer (late joiners wait for the next question). */
  fromRound: number;
  picks: Map<number, { choice: number; at: number }>;
}

export class TriviaGame {
  private phase: Phase = 'question';
  private round = 0;
  private startedAt: number;
  private endsAt: number | null;
  private seats = new Map<string, Seat>();
  private present = new Set<string>();
  /** Set while the Head Spud has paused: when, and how long was left on the clock (null = no limit). */
  private paused: { at: number; left: number | null } | null = null;

  constructor(
    private questions: PlayableQuestion[],
    private settings: GameSettings,
    players: { id: string; name: string }[],
    now: number,
  ) {
    if (!questions.length) throw new Error('a game needs at least one question');
    this.startedAt = now;
    this.endsAt = this.questionDeadline(now);
    for (const p of players) this.addPlayer(p.id, p.name, now);
  }

  get rounds(): number {
    return this.questions.length;
  }

  get over(): boolean {
    return this.phase === 'podium';
  }

  get playedIds(): string[] {
    return this.questions.slice(0, this.round + 1).map((q) => q.id);
  }

  /**
   * Someone sat down. Unless the game is just starting they wait for the next question,
   * and their score starts at the room's average. Nobody new joins once the podium is up.
   */
  addPlayer(id: string, name: string, now: number): void {
    const known = this.seats.get(id);
    if (known) {
      known.name = name;
      return;
    }
    if (this.phase === 'podium') return;
    const others = [...this.seats.values()];
    const average = others.length ? Math.round(others.reduce((t, s) => t + s.score, 0) / others.length) : 0;
    const atStart = this.phase === 'question' && now <= this.startedAt;
    this.seats.set(id, {
      id,
      name,
      score: average,
      streak: 0,
      lastPoints: 0,
      rank: 0,
      prevRank: 0,
      fromRound: atStart ? this.round : this.round + 1,
      picks: new Map(),
    });
    this.present.add(id);
    this.rerank(false);
  }

  /** Who is connected right now. Away players keep their score but nobody waits for them. */
  setPresent(ids: Iterable<string>, now: number): void {
    this.present = new Set([...ids].filter((id) => this.seats.has(id)));
    this.maybeEndEarly(now);
  }

  /** The Head Spud took this player off the couch: they leave the game and the leaderboard. */
  removePlayer(id: string, now: number): boolean {
    if (!this.seats.delete(id)) return false;
    this.present.delete(id);
    this.rerank(false);
    this.maybeEndEarly(now);
    return true;
  }

  /** A phone picks an answer. Returns false if it doesn't count (too late, twice, paused, not their round…). */
  answer(id: string, choice: number, now: number): boolean {
    const seat = this.seats.get(id);
    const q = this.questions[this.round];
    if (this.phase !== 'question' || this.paused || !seat || seat.fromRound > this.round) return false;
    if (this.endsAt !== null && now > this.endsAt) return false;
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.answers.length) return false;
    if (seat.picks.has(this.round)) return false;
    seat.picks.set(this.round, { choice, at: now });
    this.maybeEndEarly(now);
    return true;
  }

  // ---- The Head Spud's remote. Each returns true when screens need an update. ----

  /** Freeze the clock. Nobody can answer until it resumes. */
  pause(now: number): boolean {
    if (this.paused || this.phase === 'podium') return false;
    this.paused = { at: now, left: this.endsAt === null ? null : Math.max(0, this.endsAt - now) };
    this.endsAt = null;
    return true;
  }

  /** Start the clock again where it stopped. The pause doesn't count against anyone's answer speed. */
  resume(now: number): boolean {
    if (!this.paused) return false;
    const { at, left } = this.paused;
    this.paused = null;
    if (this.phase === 'question') this.startedAt += now - at;
    this.endsAt = left === null ? null : now + left;
    this.maybeEndEarly(now);
    return true;
  }

  /** Ten more seconds on a timed question that is still open. */
  addTime(now: number): boolean {
    if (this.phase !== 'question' || this.settings.seconds <= 0) return false;
    if (this.paused) {
      if (this.paused.left === null) return false;
      this.paused.left += EXTRA_TIME_MS;
      return true;
    }
    if (this.endsAt === null || this.endsAt <= now) return false; // already over (or everyone answered)
    this.endsAt += EXTRA_TIME_MS;
    return true;
  }

  /** Don't wait for the clock: reveal now, or move on from the reveal or leaderboard. Also ends a pause. */
  next(now: number): boolean {
    if (this.phase === 'podium') return false;
    if (this.paused && this.phase === 'question') this.startedAt += now - this.paused.at;
    this.paused = null;
    this.endsAt = now;
    return this.advance(now);
  }

  /** Drop the current question: nobody scores, streaks stay as they were, and the next one starts. */
  skip(now: number): boolean {
    if (this.phase !== 'question') return false;
    this.paused = null;
    for (const s of this.seats.values()) s.picks.delete(this.round);
    if (this.round >= this.questions.length - 1) {
      this.phase = 'podium';
      this.endsAt = null;
    } else {
      this.round += 1;
      this.startedAt = now;
      this.endsAt = this.questionDeadline(now);
    }
    return true;
  }

  /** Move the game on if a deadline has passed. Returns true when screens need an update. */
  advance(now: number): boolean {
    if (this.endsAt === null || now < this.endsAt) return false;
    switch (this.phase) {
      case 'question':
        this.reveal(now);
        return true;
      case 'reveal':
        if (this.round >= this.questions.length - 1) {
          this.phase = 'podium';
          this.endsAt = null;
        } else {
          this.phase = 'leaderboard';
          this.endsAt = now + LEADERBOARD_MS;
        }
        return true;
      case 'leaderboard':
        this.round += 1;
        this.phase = 'question';
        this.startedAt = now;
        this.endsAt = this.questionDeadline(now);
        return true;
      default:
        return false;
    }
  }

  standings(): Standing[] {
    return [...this.seats.values()]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((s) => ({
        id: s.id,
        name: s.name,
        score: s.score,
        rank: s.rank,
        moved: s.prevRank ? s.prevRank - s.rank : 0,
        streak: s.streak,
        lastPoints: s.lastPoints,
        away: !this.present.has(s.id),
      }));
  }

  /** What the TV shows: everything except phone-only fields. */
  tvView(now: number): GameView {
    return this.view(now, null);
  }

  /** What one phone shows: no question text, plus its own pick and result. */
  phoneView(id: string, now: number): GameView {
    return this.view(now, id);
  }

  // ---- internals ----

  private questionDeadline(now: number): number | null {
    return this.settings.seconds > 0 ? now + this.settings.seconds * 1000 : null;
  }

  /**
   * Everyone here has answered (and at least one person has): no need to wait for the timer.
   * Also ends a question nobody here can answer while someone is waiting for the next one,
   * so players who left never stall the game, even with no time limit.
   */
  private maybeEndEarly(now: number): void {
    if (this.phase !== 'question' || this.paused) return;
    const expected = [...this.present].filter((id) => this.seats.get(id)!.fromRound <= this.round);
    const answered = expected.filter((id) => this.seats.get(id)!.picks.has(this.round));
    const waiting = this.present.size > expected.length;
    if (answered.length === expected.length && (answered.length > 0 || waiting)) this.endsAt = now;
  }

  private reveal(now: number): void {
    const q = this.questions[this.round];
    const limit = this.settings.seconds > 0 ? this.settings.seconds * 1000 : UNTIMED_REFERENCE_MS;
    for (const s of this.seats.values()) {
      const pick = s.picks.get(this.round);
      if (pick && pick.choice === q.correct) {
        const speed = Math.min(Math.max((pick.at - this.startedAt) / limit, 0), 1);
        s.streak += 1;
        s.lastPoints = Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * speed) + (s.streak >= STREAK_FROM ? STREAK_BONUS : 0);
        s.score += s.lastPoints;
      } else {
        // Sitting out a question you joined in the middle of doesn't break a streak you never had.
        if (s.fromRound <= this.round) s.streak = 0;
        s.lastPoints = 0;
      }
    }
    this.rerank(true);
    this.phase = 'reveal';
    this.endsAt = now + REVEAL_MS;
  }

  private rerank(remember: boolean): void {
    const scores = [...this.seats.values()].map((s) => s.score);
    for (const s of this.seats.values()) {
      if (remember) s.prevRank = s.rank;
      s.rank = 1 + scores.filter((x) => x > s.score).length;
    }
  }

  private view(now: number, phoneId: string | null): GameView {
    const q = this.questions[this.round];
    const tv = phoneId === null;
    const base = {
      endsAt: this.endsAt,
      serverNow: now,
      round: this.round + 1,
      rounds: this.rounds,
      ...(this.paused ? { paused: true, left: this.paused.left } : {}),
    };
    switch (this.phase) {
      case 'question': {
        // Someone who answered and then left still counts, so the TV never shows "3 of 2 locked in".
        const expected = [...this.seats.values()].filter(
          (s) => s.fromRound <= this.round && (this.present.has(s.id) || s.picks.has(this.round)),
        );
        const seat = phoneId ? this.seats.get(phoneId) : undefined;
        return {
          ...base,
          phase: 'question',
          category: q.category,
          ...(tv ? { text: q.text, answers: q.answers } : {}),
          choices: q.answers.length,
          answered: expected.filter((s) => s.picks.has(this.round)).length,
          players: expected.length,
          ...(tv ? {} : { myChoice: seat?.picks.get(this.round)?.choice ?? null, canAnswer: !!seat && seat.fromRound <= this.round }),
        };
      }
      case 'reveal': {
        const pickedBy: string[][] = q.answers.map(() => []);
        for (const s of this.seats.values()) {
          const pick = s.picks.get(this.round);
          if (pick) pickedBy[pick.choice].push(s.id);
        }
        const seat = phoneId ? this.seats.get(phoneId) : undefined;
        const me = seat && this.standings().find((x) => x.id === seat.id)!;
        const choice = seat?.picks.get(this.round)?.choice ?? null;
        return {
          ...base,
          phase: 'reveal',
          ...(tv ? { text: q.text, answers: q.answers } : {}),
          choices: q.answers.length,
          correct: q.correct,
          pickedBy,
          fact: q.fact,
          ...(me ? { me: { ...me, choice, correct: choice === q.correct } } : {}),
          ...(seat ? { waiting: seat.fromRound > this.round } : {}),
        };
      }
      case 'leaderboard': {
        const seat = phoneId ? this.seats.get(phoneId) : undefined;
        return {
          ...base,
          phase: 'leaderboard',
          standings: this.standings(),
          ...(seat ? { waiting: seat.fromRound > this.round } : {}),
        };
      }
      default:
        return { phase: 'podium', rounds: this.rounds, standings: this.standings(), serverNow: now };
    }
  }
}

const SECONDS = [0, 10, 20, 30];
const LANGS = ['en', 'pt-PT', 'es-ES'] as const;

/** Turn whatever the TV sent into safe settings. Anything odd falls back to a sensible default. */
export function parseSettings(raw: unknown): GameSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : undefined);
  const rounds = int(r.rounds);
  const seconds = int(r.seconds);
  const youngest = int(r.youngest);
  const settings: GameSettings = {
    language: LANGS.includes(r.language as (typeof LANGS)[number]) ? (r.language as GameSettings['language']) : 'en',
    rounds: rounds !== undefined && rounds >= 1 && rounds <= 30 ? rounds : 10,
    seconds: seconds !== undefined && SECONDS.includes(seconds) ? seconds : 20,
  };
  if (youngest !== undefined && youngest >= 3 && youngest <= 99) settings.youngest = youngest;
  if (Array.isArray(r.regions)) {
    const regions = [...new Set(r.regions.filter((x): x is string => typeof x === 'string' && /^[A-Z]{2}$/.test(x)))].slice(0, 10);
    if (regions.length) settings.regions = regions;
  }
  return settings;
}
