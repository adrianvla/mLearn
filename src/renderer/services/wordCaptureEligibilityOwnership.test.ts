/**
 * Structural guard for the rule that decides whether a word captured while
 * reading or watching may become a flashcard.
 *
 * The rule had four owners - the shared sidebar, the reader route, the video
 * route and the floating overlay - and only the reader enforced it on the bulk
 * add path. That is the shape this test exists to prevent: a new capture
 * surface that filters what it *shows* correctly, but never checks what it
 * *adds*, will quietly re-create cards the learner already has.
 *
 * These assertions read the sources rather than the DOM, because the failure
 * being guarded against is a missing guard, which no behavioural test of the
 * happy path would notice.
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

describe('word capture eligibility has one owner', () => {
  it('finds renderer sources to check', () => {
    expect(rendererSources().length).toBeGreaterThan(50);
  });

  /**
   * The concrete regression. `bulkAddWords` only enforces a skip if the caller
   * passes one, so a capture surface that omits it adds every entry it was
   * handed - including words that became cards or were excluded while the list
   * was on screen. Every caller must now supply the canonical predicate.
   */
  it('every bulk add of captured words passes the canonical skip', () => {
    // `addAllCapturedWords` is now the single caller of `bulkAddWords` for
    // captured words, and it receives the canonical predicate as `isEligible`
    // rather than writing a `skip` arrow inline. So there are two things to
    // check: that the owner forwards `isEligible` into `skip` at all, and that
    // every surface supplies a predicate rather than omitting one.
    const owner = read(join(RENDERER, 'services/addAllCapturedWords.ts'));
    expect(owner, 'the owner must forward isEligible into bulkAddWords skip')
      .toMatch(/skip:\s*[^,\n]*isEligible/);

    const offenders: string[] = [];
    for (const file of rendererSources()) {
      const source = read(file);
      if (!source.includes('addAllCapturedWords({')) continue;
      for (const call of source.split('addAllCapturedWords({').slice(1)) {
        const body = call.slice(0, call.indexOf('})'));
        if (!/isEligible:\s*\w/.test(body)) {
          offenders.push(relative(RENDERER, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Eligibility must be asked of the one owner rather than restated. The
   * pattern this rejects is a surface building the decision out of a card
   * lookup OR'd with an ignored-word lookup, which is how the reader and the
   * video route came to disagree.
   */
  it('no surface restates the rule from a card lookup OR an ignore lookup', () => {
    const offenders: string[] = [];
    const restated = /getCardByWordSync\([^)]*\)[\s\S]{0,200}?\|\|\s*\w+\.isWordIgnoredSync\(/;
    for (const file of rendererSources()) {
      if (restated.test(read(file))) offenders.push(relative(RENDERER, file));
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Re-entering a bulk add has to be refused everywhere or nowhere.
   *
   * The reader guarded its "Add All" entry point against a second run while
   * the video route and the floating overlay did not, even though all three
   * are the same sidebar offering the same button. Capturing a video card
   * takes long enough that a learner can confirm a second Add All over the
   * first, and the un-guarded routes then capture the same words twice.
   */
  it('every bulk-add entry point refuses to re-enter', () => {
    // The guard moved into `addAllCapturedWords` when the three duplicated
    // skeletons collapsed into one owner, so this now checks two things: that
    // the owner actually refuses a second run, and that each surface hands it
    // the signal it needs to judge by. A surface passing no `isInFlight` would
    // make the owner unable to tell a fresh run from a re-entry.
    const owner = read(join(RENDERER, 'services/addAllCapturedWords.ts'));
    expect(owner, 'the owner must refuse to re-enter or run an empty batch')
      .toMatch(/if \(isInFlight\(\) \|\| entries\.length === 0\)/);

    const offenders: string[] = [];
    for (const file of rendererSources()) {
      const source = read(file);
      // The entry point is the handler the sidebar's onAddAll is wired to.
      if (!/onAddAll=\{/.test(source)) continue;
      for (const call of source.split('addAllCapturedWords({').slice(1)) {
        const body = call.slice(0, call.indexOf('})'));
        if (!/isInFlight:\s*\w/.test(body) || !/setInFlight:\s*\w/.test(body)) {
          offenders.push(relative(RENDERER, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the shared sidebar disables its Add All while a batch is running', () => {
    // The reason the route-level re-entrancy guard could not be falsified in the
    // running app. The single owner of the Add All control is the shared
    // sidebar, and it disables the button whenever the surface reports a batch
    // in progress - so a learner cannot open a second confirmation over a
    // running one, whichever route is mounted underneath.
    //
    // The route-level guards are therefore defence in depth rather than the
    // thing keeping duplicates out. If the sidebar ever stops disabling, those
    // guards become load-bearing again and the batch has to be able to run
    // twice; this assertion is what would notice.
    const source = read(join(RENDERER, 'components/sidebar/UnknownWordsSidebar.tsx'));
    const button = source.slice(source.indexOf("t('mlearn.Sidebar.AddAll')"));
    expect(button).toContain('props.isAddingAll()');
  });

  it('every capture surface reports its batch-in-progress state to the sidebar', () => {
    // The disable above is only real if each surface actually wires the signal
    // up. A surface that renders the shared sidebar but never passes
    // `isAddingAll` leaves the control live for the whole batch, and the
    // route-level guard becomes the only thing standing between the learner
    // and the same words captured twice.
    const surfaces = [
      'windows/main/routes/ReaderRoute.tsx',
      'windows/main/routes/VideoRoute.tsx',
    ];
    for (const surface of surfaces) {
      const source = read(join(RENDERER, surface));
      const sidebar = source.slice(source.lastIndexOf('UnknownWordsSidebar'));
      // Either the signal itself or an accessor that reads it.
      expect(sidebar, surface).toContain('isAddingAll=');
      expect(sidebar.slice(sidebar.indexOf('isAddingAll=')), surface)
        .toMatch(/isAddingAll=\{[^}]*isAddingAll[A-Za-z0-9_]*/);
    }
  });

  it('the canonical rule is reachable from every capture surface', () => {
    const surfaces = [
      'windows/main/routes/ReaderRoute.tsx',
      'windows/main/routes/VideoRoute.tsx',
      'windows/overlay/App.tsx',
      'components/sidebar/UnknownWordsSidebar.tsx',
    ];
    for (const surface of surfaces) {
      expect(read(join(RENDERER, surface)))
        .toContain('wordCaptureEligibility');
    }
  });
});
