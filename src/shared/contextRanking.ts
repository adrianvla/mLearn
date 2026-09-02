/**
 * Turn-specific lexical ranking for compiled-context budgets.
 *
 * Pure string/number ops: no embeddings, no async, no randomness, no clock —
 * callers pass an explicit reference time for recency (the Date.now() parameter
 * default serves ad-hoc callers only). Identical inputs yield identical
 * outputs.
 *
 * Scoring is language-agnostic: spaced-script words are lowercased runs of at
 * least 2 letters/digits; every Han/Hiragana/Katakana/Hangul code point is its
 * own token — CJK text is unspaced, so per-character granularity keeps it
 * matchable. Term coverage of the turn dominates the score; an exact-substring
 * bonus (carrying CJK phrase-level relevance), exponential recency (half-life
 * 14 days) and a small per-kind weight only break ties.
 */

import type { MemoryEntry } from './world';

const RECENCY_HALF_LIFE_DAYS = 14;
const DAY_MS = 86_400_000;
/** Term coverage of the turn outweighs recency + kind weight combined. */
const COVERAGE_WEIGHT = 3;
const SUBSTRING_BONUS = 0.5;
/** Small ordering bias between memory kinds; never outweighs term overlap. */
const KIND_WEIGHT: Record<MemoryEntry['kind'], number> = {
  'open-loop': 0.3,
  relationship: 0.25,
  belief: 0.2,
  episode: 0.15,
  fact: 0.1,
};

const WORD_RUN = /[\p{L}\p{N}]+/gu;
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Minimal shape rankable as a memory/open-loop entry. */
export interface RankableMemory {
  text: string;
  createdAt: number;
  kind?: MemoryEntry['kind'];
}

/** Minimal shape rankable as a thread event. */
export interface RankableThreadEvent {
  text?: string;
  createdAt: number;
}

export interface RankedMemory<T extends RankableMemory = RankableMemory> {
  entry: T;
  score: number;
}

interface TurnTerms {
  tokens: Set<string>;
  lower: string;
}

/**
 * Script-aware tokens: lowercased >=2-code-point letter/digit runs from spaced
 * scripts, plus one token per Han/Hiragana/Katakana/Hangul code point (CJK is
 * unspaced; its code points are exempt from the minimum length).
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const run of text.toLowerCase().match(WORD_RUN) ?? []) {
    let word = '';
    for (const char of run) {
      if (CJK_CHAR.test(char)) {
        if (word.length >= 2) tokens.push(word);
        word = '';
        tokens.push(char);
      } else {
        word += char;
      }
    }
    if (word.length >= 2) tokens.push(word);
  }
  return tokens;
}

/**
 * Conservative token estimate: one token per CJK code point, otherwise four
 * characters per token (rounded up).
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (CJK_CHAR.test(char)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

function turnTerms(turnText: string): TurnTerms {
  return { tokens: new Set(tokenize(turnText)), lower: turnText.trim().toLowerCase() };
}

function recencyWeight(createdAt: number, now: number): number {
  if (now <= 0) return 0;
  const ageDays = Math.max(0, (now - createdAt) / DAY_MS);
  return 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}

function lexicalScore(entryText: string, turn: TurnTerms): number {
  const entryTokens = new Set(tokenize(entryText));
  let covered = 0;
  for (const token of turn.tokens) {
    if (entryTokens.has(token)) covered += 1;
  }
  const lower = entryText.toLowerCase();
  const substring =
    turn.lower.length > 0 && (lower.includes(turn.lower) || turn.lower.includes(lower)) ? 1 : 0;
  return COVERAGE_WEIGHT * covered + SUBSTRING_BONUS * substring;
}

/** Scores entries against the turn text, best first (stable on ties). */
export function scoreMemoryEntries<T extends RankableMemory>(
  entries: readonly T[],
  turnText: string,
  now: number = Date.now(),
): RankedMemory<T>[] {
  const turn = turnTerms(turnText);
  const ranked = entries.map((entry) => ({
    entry,
    score:
      lexicalScore(entry.text, turn) +
      recencyWeight(entry.createdAt, now) +
      (entry.kind === undefined ? 0 : KIND_WEIGHT[entry.kind]),
  }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/**
 * Greedy take over an already-ranked list: highest score first, skipping any
 * entry that no longer fits so smaller entries can still fill the budget.
 */
export function selectWithinBudget<T extends RankableMemory>(
  ranked: readonly RankedMemory<T>[],
  budgetTokens: number,
): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const { entry } of ranked) {
    const cost = estimateTokens(entry.text);
    if (used + cost > budgetTokens) continue;
    kept.push(entry);
    used += cost;
  }
  return kept;
}

/**
 * Selects thread events for a turn, preserving input (chronological) order:
 * the newest `keepLatest` events always survive; older events survive only
 * when they share at least one term with the turn text.
 */
export function rankRecentThreadEvents<T extends RankableThreadEvent>(
  events: readonly T[],
  turnText: string,
  keepLatest: number,
): T[] {
  const turn = turnTerms(turnText);
  const floor = Math.max(0, events.length - Math.max(0, keepLatest));
  const kept: T[] = [];
  for (let i = 0; i < events.length; i += 1) {
    if (i >= floor) {
      kept.push(events[i]);
    } else if (lexicalScore(events[i].text ?? '', turn) > 0) {
      kept.push(events[i]);
    }
  }
  return kept;
}

/**
 * Keeps the most recent contiguous tail whose estimated tokens fit the
 * budget, dropping oldest-first. Input must be chronological (oldest first).
 */
export function recentTailWithinBudget<T extends RankableThreadEvent>(
  events: readonly T[],
  budgetTokens: number,
): T[] {
  let used = 0;
  let start = events.length;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(events[i].text ?? '');
    if (used + cost > budgetTokens) break;
    used += cost;
    start = i;
  }
  return events.slice(start);
}
