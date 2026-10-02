/**
 * Structural guard for durable flashcard media ownership.
 *
 * Durable flashcard media is named after the object that owns it:
 * `flashcard-images/{cardId}.{ext}`. Every delete path works from that name
 * alone - `removeFlashcard` calls `deleteFlashcardImage(id)`, and
 * `releaseUnusedFlashcardMedia` refuses to remove anything the store still
 * references. So the filename IS the ownership record.
 *
 * That makes an owner who invents its own id unservable rather than merely
 * untidy. A capture surface that persisted a frame under its own UUID - or
 * under a word hash, or a page id - created a file no delete path could ever
 * address, so it outlived the card it was meant for. On a real store this had
 * produced 2371 unreferenced images totalling 25MB, including frames of
 * unrelated video that no flashcard ever claimed.
 *
 * The invariant, therefore: capture produces prepared bytes, and only the owner
 * persists them. These assertions read sources directly, because the failure
 * being guarded against is a write whose absence no happy-path behavioural
 * test would notice.
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

const relative = (file: string) => file.slice(RENDERER.length + 1);

/** FlashcardContext is the one place allowed to write durable media. */
const OWNER = 'context/FlashcardContext.tsx';

describe('durable flashcard media has exactly one owner', () => {
  it('finds renderer sources to check', () => {
    expect(rendererSources().length).toBeGreaterThan(50);
  });

  it('only the owner writes durable flashcard media', () => {
    const offenders: string[] = [];
    for (const file of rendererSources()) {
      if (relative(file) === OWNER) continue;
      const source = read(file);
      // The bridge definition and the shared type contracts are not writers.
      if (/saveFlashcard(Image|Video)\s*[:(]/.test(source) === false) continue;
      if (relative(file).startsWith('shared/bridges/')) continue;
      offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });

  it('the owner persists media only through its adopt helpers', () => {
    const source = read(join(RENDERER, OWNER));
    // Every write must name the owner id it was handed, never a capture name.
    const writes = [...source.matchAll(/flashcards\.(saveFlashcardImage|saveFlashcardVideo)\((\w+)/g)];
    expect(writes.length).toBeGreaterThan(0);
    for (const [, method, idArgument] of writes) {
      expect(idArgument, `${method} must persist under its owner id`).toBe('ownerId');
    }
  });

  it('never names a durable artifact after a capture event', () => {
    // These were the observed symptoms, not the rule. A filename derived from
    // the clock, the page, or the video identifies the SOURCE of a picture, not
    // the learning object that would make it meaningful - so no such name may
    // be minted anywhere in the renderer.
    const offenders: string[] = [];
    for (const file of rendererSources()) {
      const source = read(file);
      if (/overlay-screenshot-|reader-page-/.test(source)) offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });

  it('capture helpers return prepared bytes instead of persisting', () => {
    // The capture layer describes what is on screen. Persisting is the owner's
    // job, so these modules must not reach the storage bridge at all.
    for (const path of ['services/canvasCapture.ts', 'services/flashcardImageCapture.ts']) {
      expect(read(join(RENDERER, path))).not.toMatch(/saveFlashcardImage|saveFlashcardVideo/);
    }
  });

  it('keeps a captured video frame in memory in the overlay', () => {
    // The extension reports a frame on every pause and seek, including for
    // videos that are not language content. The overlay holds the observation;
    // only a capture turns it into a card's media.
    const source = read(join(RENDERER, 'windows/overlay/App.tsx'));
    const handler = source.slice(
      source.indexOf('onOverlayVideoScreenshot('),
      source.indexOf('onOverlayVideoScreenshot(') + 600,
    );
    expect(handler).not.toMatch(/saveFlashcardImage/);
  });

  it('does not key a reader suggestion image by page', () => {
    // Two words on one page each need their own occurrence crop. A page-scoped
    // cache made every suggested card share one whole-page image.
    const source = read(join(RENDERER, 'windows/main/routes/ReaderRoute.tsx'));
    expect(source).toMatch(/captureReaderImageForOccurrence\(/);
    expect(source).not.toMatch(/capturedPages/);
  });

  it('generates card audio only for a card that already exists', () => {
    // TTS is analogous generated media: it is written as `{cardId}-{field}.ogg`
    // and deleted under the same card id, so a caller that invented an id would
    // produce audio no card could ever release. Every call site must pass the
    // id of a created card.
    for (const file of rendererSources()) {
      const source = read(file);
      for (const call of source.matchAll(/generateFlashcardTts\(\s*([A-Za-z_$][\w$.]*)/g)) {
        expect(
          call[1],
          `${relative(file)} must generate audio for an existing card id, not a fresh id`,
        ).not.toMatch(/^(crypto\.randomUUID|generateUUID|toUniqueIdentifier)$/);
      }
    }
  });

  it('does not name a video clip after the word it contains', () => {
    // The clip was saved under a word hash but deleted under the card's id,
    // so removing the card left the file behind forever.
    for (const path of [
      'windows/main/routes/VideoRoute.tsx',
      'windows/overlay/App.tsx',
      'components/subtitle/WordHover.tsx',
    ]) {
      const source = read(join(RENDERER, path));
      expect(source).not.toMatch(/saveFlashcardVideo\(/);
      expect(source).not.toMatch(/toUniqueIdentifier\(content\.word\)/);
    }
  });
});
