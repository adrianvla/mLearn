/**
 * Structural guard for the rule that decides whether a word the learner is
 * READING is known: "would this word be hidden from the unknown-words list?"
 *
 * The observation this test exists to prevent, reproduced in the running app
 * against the live 450-card profile:
 *
 *   A profile holds words imported from Anki, or claimed "known" by the learner,
 *   that carry a word-level claim of `known` and NO `surface-recognition`
 *   record. For 12 such words the two capture surfaces answer differently for
 *   the same word:
 *
 *     - VideoRoute / overlay  filter with `getComprehensiveWordStatusSync(...) === 'known'`
 *       (word-level), so the word is dropped and never reaches the sidebar.
 *     - ReaderRoute           filters with `getWrittenComprehensionStatus(...)`
 *       (written identity AND meaning), so `surface-recognition` reads
 *       `untracked` -> `unknown`, the word is kept, and the sidebar shows it.
 *
 *   The rendered subtitle for one such word (遅刻) simultaneously lacked the
 *   `known` class, i.e. the UI presented it as unknown, while the video sidebar
 *   refused to list it. Same word, same profile, same moment: one surface says
 *   "unknown, here it is", the other says "known, nothing to do".
 *
 * The two answers are both defensible in isolation, and the written-comprehension
 * predicate is deliberate and directly tested in writtenComprehension.test.ts.
 * What is NOT acceptable is that the same product concept -- "is this word
 * unknown to the learner, as encountered in reading?" -- is decided by two
 * different rules in two sibling capture surfaces, so a change to knowledge
 * semantics has to be understood in both and the two can silently disagree
 * again. These assertions pin the ownership: the video routes must ask the
 * same question the reader asks, not a second, laxer one.
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

const read = (path: string) => readFileSync(path, 'utf8');

/** Surfaces that accumulate subtitle/OCR words into the unknown-words list. */
const CAPTURE_SURFACES = [
  'windows/main/routes/VideoRoute.tsx',
  'windows/main/routes/ReaderRoute.tsx',
  'windows/overlay/App.tsx',
];

describe('the written-comprehension question has one owner', () => {
  it('finds renderer sources to check', () => {
    expect(rendererSources().length).toBeGreaterThan(50);
  });

  it('every capture surface asks the written-comprehension question, not a word-level one', () => {
    // The concrete regression. `getComprehensiveWordStatusSync(word) === 'known'`
    // is a DIFFERENT question from written comprehension, and on any profile
    // holding a lexical `known` claim with no surface record the two disagree --
    // which is exactly how a word ends up rendered as unknown, absent from the
    // video sidebar, and present in the reader's.
    const offenders: string[] = [];
    const wordLevelGate = /getComprehensiveWordStatusSync\([^)]*\)\s*(!==|===)\s*'known'/;
    for (const rel of CAPTURE_SURFACES) {
      const source = read(join(RENDERER, rel));
      if (wordLevelGate.test(source)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('every capture surface asks the context-owned predicate', () => {
    // A surface could satisfy the check above by hand-rolling an equivalent
    // test. Routing all three through one context member keeps the rule in a
    // single implementation, so the semantics (which capabilities participate,
    // and how an untracked access reads) have one place to change.
    const owner = read(join(RENDERER, 'context/FlashcardContext.tsx'));
    expect(owner, 'the context must expose one written-comprehension predicate')
      .toMatch(/isWordKnownWhenWrittenSync[\s\S]{0,400}getWrittenComprehensionStatus\(/);

    for (const rel of CAPTURE_SURFACES) {
      const source = read(join(RENDERER, rel));
      expect(source, `${rel} must use isWordKnownWhenWrittenSync`)
        .toContain('isWordKnownWhenWrittenSync');
    }
  });

  it('the claim release stays inside the owner, scoped to the claimed surface', () => {
    // The claim rule belongs to the predicate, not to a surface. Two things
    // have to hold together: a surface must not implement its own claim
    // escape (which would put the two rules back in competition), and the
    // owner must keep the release scoped to the surface the claim was made on
    // — an unbounded release would let one claim vouch for every spelling.
    for (const rel of CAPTURE_SURFACES) {
      expect(read(join(RENDERER, rel)), rel).not.toMatch(/basis\s*===?\s*'claim'/);
    }
    const owner = read(join(RENDERER, 'utils/writtenComprehension.ts'));
    expect(owner, 'the owner must release an unmeasured surface on a claim')
      .toMatch(/meaning\.basis === 'claim'/);
    expect(owner, 'the release must stay scoped to the claimed surface')
      .toMatch(/query\.surface === \(query\.lexicalWord \?\? query\.surface\)/);
  });

  it('no capture surface invents a second written-identity check', () => {
    // Guards against the copy-and-edit variant: a surface reaching for
    // `surface-recognition` (or any other written-identity access) directly
    // instead of going through the canonical predicate.
    const offenders: string[] = [];
    for (const rel of CAPTURE_SURFACES) {
      if (/'surface-recognition'/.test(read(join(RENDERER, rel)))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
