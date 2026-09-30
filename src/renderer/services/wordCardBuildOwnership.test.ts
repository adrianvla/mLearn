/**
 * Structural guard for "put this word in my deck".
 *
 * This is one product action reachable from six surfaces: the subtitle hover,
 * the reader sidebar, the video sidebar, the floating overlay, the word
 * definition popup and the vocabulary browser. Each of them sees a word, shows
 * the learner its translation, and then has to decide what a card for it
 * contains.
 *
 * The vocabulary browser used to answer that question itself, with an inline
 * object literal. It read `entry.translation`, which is empty for every row the
 * reader had not already carded — those rows display a lazily fetched
 * translation instead — so it fell through to `entry.word` and wrote cards
 * whose answer was the untranslated word, with a reading identical to the word
 * and no prosody, definition, or status-derived ease. The row said
 * "there, over there, that place" and the card said "あそこ".
 *
 * The fix routes it through `buildWordHoverFlashcardContent`, the owner the
 * other five already used. This test exists so a sixth surface cannot quietly
 * reintroduce a seventh implementation: the sources are read directly because
 * the failure being guarded against is a builder that no behavioural test of
 * the happy path would notice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

/** Surfaces that capture a word the learner is looking at right now. */
const CAPTURE_SURFACES = [
  'components/subtitle/WordHover.tsx',
  'windows/main/routes/ReaderRoute.tsx',
  'windows/main/routes/VideoRoute.tsx',
  'windows/overlay/App.tsx',
  'windows/wordDefinition/App.tsx',
  'windows/wordDbEditor/App.tsx',
];

describe('building a word card has one owner', () => {
  it('finds renderer sources to check', () => {
    expect(rendererSources().length).toBeGreaterThan(50);
  });

  it.each(CAPTURE_SURFACES)('%s calls the shared builder, not just its import', (surface) => {
    // Matching the identifier alone would be satisfied by the import line, so
    // require the call: the destructuring of `{ content, ease }` that every
    // capture surface performs and then hands to the store.
    const source = read(join(RENDERER, surface));
    expect(source).toMatch(/\{\s*content\s*,\s*ease\s*\}\s*=\s*await\s+buildWordHoverFlashcardContent\(/);
  });

  it.each(CAPTURE_SURFACES)('%s passes the word status-derived ease to the store', (surface) => {
    // An ease that is not derived from the word's status is a card that
    // ignores what the learner already knows about it.
    const source = read(join(RENDERER, surface));
    expect(source).toMatch(/addFlashcard\([^)]*ease/);
  });

  it('does not let a capture surface assemble a word card as an object literal', () => {
    // `type: 'word'` inside a literal is how both the vocabulary browser's
    // untranslated card and the suggested-card hydration paths are written.
    // Hydration is legitimate: it republishes content another owner already
    // built. The tell for a capture surface is building one from a bare word.
    const offenders: string[] = [];
    for (const file of rendererSources()) {
      const relativePath = file.slice(RENDERER.length + 1);
      if (relativePath === 'context/FlashcardContext.tsx') continue;
      if (relativePath === 'context/SyncContext.tsx') continue;
      if (relativePath === 'components/flashcard/FlashcardCreateModal.tsx') continue;
      if (relativePath === 'windows/flashcards/FlashcardsSuggested.tsx') continue;
      if (relativePath === 'windows/flashcards/flashcardsSuggestedPreview.ts') continue;

      const source = read(file);
      if (!/addFlashcard\(/.test(source)) continue;
      // A capture surface is one that *calls* the shared builder. If it does
      // not, any `type: 'word'` literal next to its addFlashcard call is a
      // second implementation of the same card.
      if (source.includes('buildWordHoverFlashcardContent(')) continue;
      if (/type:\s*'word'/.test(source)) {
        offenders.push(relativePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not let a surface subscribe to a knowledge pill without owning the write', () => {
    // The vocabulary browser wired `onStatusChange` to a handler that only
    // logged. WordStatusPill already claims the word itself, so the callback
    // could only ever be dead wiring: it looked like the browser was handling
    // knowledge state and silently discarded the claim. Any future subscriber
    // must be a real writer.
    const offenders: string[] = [];
    for (const file of rendererSources()) {
      const source = read(file);
      const subscribes = /<WordStatusPill[\s\S]{0,300}?onStatusChange=\{/.test(source);
      if (subscribes) offenders.push(file.slice(RENDERER.length + 1));
    }
    // One legitimate reader remains: the suggested-card list treats a claim of
    // `known` as "the learner knows this word, drop the suggestion".
    expect(offenders).toEqual(['windows/flashcards/FlashcardsSuggested.tsx']);
  });

  it('keeps the translation for a card in the shared cache the row already warmed', () => {
    // The regression was reading `entry.translation` (empty for lazy rows)
    // instead of the cache the row itself populates for display.
    const source = read(join(RENDERER, 'windows/wordDbEditor/App.tsx'));
    expect(source).toContain('getCachedTranslation');
    expect(source).not.toMatch(/back:\s*entry\.translation\s*\|\|/);
  });
});

describe('a failed capture is reported once, by one owner', () => {
  /**
   * The six capture surfaces each decided independently what to tell the
   * learner when a card could not be made, and the decisions had drifted into
   * four: two wordings, and two surfaces that said nothing at all. The two
   * silent ones were the video sidebar and the overlay, whose `bulkAddWords`
   * error branch was unreachable because the add function it called already
   * caught its own failure.
   *
   * This guard is deliberately structural. Every one of those surfaces had
   * passing tests of its happy path, and a behavioural test cannot tell that a
   * catch block announces nothing - only that the call still resolves.
   */
  it.each(CAPTURE_SURFACES)('%s routes its failure through the shared reporter', (surface) => {
    const source = read(join(RENDERER, surface));
    expect(source).toMatch(/reportCaptureFailure\(/);
  });

  it('does not let a capture surface decide its own failure message', () => {
    // A surface that toasts about a failed capture with a key of its own is a
    // seventh decision. The reporter owns the wording.
    const offenders: string[] = [];
    for (const file of rendererSources()) {
      const relativePath = file.slice(RENDERER.length + 1);
      if (!CAPTURE_SURFACES.includes(relativePath)) continue;
      const source = read(file);
      if (/t\(\s*'mlearn\.[^']*FlashcardAddFailed/.test(source)) offenders.push(relativePath);
    }
    expect(offenders).toEqual([]);
  });

  it('does not let a capture surface swallow a card-build failure silently', () => {
    // The defect this guards: the catch block belonging to a *capture* function
    // logging and returning. It has to be matched narrowly, because these files
    // legitimately swallow other failures - a translation lookup that degrades
    // to no translation, an Anki export that reports its own way. Scoping to
    // the catch that wraps the `addFlashcard` call keeps the guard honest.
    const offenders: string[] = [];
    for (const file of rendererSources()) {
      const relativePath = file.slice(RENDERER.length + 1);
      if (!CAPTURE_SURFACES.includes(relativePath)) continue;
      const source = read(file);

      // Each catch whose body mentions the card store call is a capture
      // failure handler; it must announce rather than swallow.
      for (const match of source.matchAll(/catch\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/g)) {
        const body = match[1];
        if (!/addFlashcard|buildWordHoverFlashcardContent/.test(body)) continue;
        if (/reportCaptureFailure|reportCaptureBatchFailure/.test(body)) continue;
        offenders.push(relativePath);
        break;
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes a sidebar click through the guard rather than the raw builder', () => {
    // Both video sidebars were wired `onAddWord={addVideoWordFlashcard}`, which
    // bypassed their own per-word in-flight guard and eligibility check: the
    // guard existed and never ran. The wiring is the only place this shows.
    for (const surface of ['windows/main/routes/VideoRoute.tsx', 'windows/overlay/App.tsx']) {
      const source = read(join(RENDERER, surface));
      expect(source).toMatch(/onAddWord=\{handleAddSidebarWord\}/);
    }
  });
});
