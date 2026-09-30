/**
 * Structural guard for the rule that reduces a mixed profile's per-interaction
 * observations to the single quality a surface schedules on.
 *
 * The rule ("missed dominates struggled dominates fluent") had two owners: a
 * hardcoded ternary chain in flashcard review and a manual `indexOf` walk in
 * word sync. They agreed by coincidence. This test exists so a third surface
 * does not grow its own copy — a copy that scheduled on the strongest
 * evidence, or on an order the shared list did not share, would silently
 * disagree with the other two and mis-schedule a card.
 *
 * The assertions read sources rather than DOM: the failure being guarded
 * against is a duplicated decision, which no happy-path behavioural test of an
 * existing surface would notice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RENDERER = join(__dirname, '..');

function rendererSources(dir = RENDERER): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...rendererSources(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => relative(RENDERER, file);
const read = (file: string) => readFileSync(file, 'utf8');

describe('mixed-quality reduction has one owner', () => {
  it('finds renderer sources to check', () => {
    expect(rendererSources().length).toBeGreaterThan(50);
  });

  /**
   * The concrete regression: a surface that re-derives the ordering instead of
   * reading the shared helper. Any comparison of two quality values that is
   * not a call to `worstAttemptQuality` is a restatement of the policy.
   */
  it('no renderer source compares attempt qualities to reduce a set', () => {
    const offenders: string[] = [];
    // A quality-vs-quality comparison is what encodes the ordering. It looks
    // like either ATTEMPT_QUALITIES.indexOf(...) on both sides, or a nested
    // ternary / boolean chain over the literal quality names.
    const indexOfPair = /ATTEMPT_QUALITIES\s*\.\s*indexOf\([^)]*\)\s*[<>]=?\s*ATTEMPT_QUALITIES\s*\.\s*indexOf/;
    const ternaryChain = /quality\s*===\s*'missed'[\s\S]{0,200}quality\s*===\s*'struggled'/;
    const someChain = /\.some\([^)]*quality\s*===\s*'missed'\)[\s\S]{0,200}\.some\([^)]*quality\s*===\s*'struggled'/;
    for (const file of rendererSources()) {
      const source = read(file);
      if (indexOfPair.test(source) || ternaryChain.test(source) || someChain.test(source)) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the two scheduling surfaces read the one shared reduction', () => {
    const consumers = [
      'components/flashcard/FlashcardReview.tsx',
      'windows/wordSync/App.tsx',
    ];
    for (const consumer of consumers) {
      const source = read(join(RENDERER, consumer));
      expect(source, `${consumer} must import the shared reduction`).toMatch(
        /import\s*\{[^}]*\bworstAttemptQuality\b[^}]*\}\s*from\s*'[^']*shared\/constants'/,
      );
    }
  });
});
