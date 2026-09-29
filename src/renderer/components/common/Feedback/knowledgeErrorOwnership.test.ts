// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * KnowledgeLoadError is the declared single owner of "a knowledge read failed":
 * a message plus, when the surface can recover, a Retry action. These tests
 * fail if a surface re-implements that pair locally, because a second copy is
 * exactly what makes "the knowledge panel failed" look different from place to
 * place — and makes a fix to it require edits in several places.
 *
 * Scoped to knowledge-read failures. A surface that owns some other kind of
 * failure (a sync modal, a dictionary lookup, a whole-window load error) is a
 * different interaction and is deliberately not covered here.
 */

const RENDERER = join(process.cwd(), 'src/renderer');
const OWNER = join('Feedback', 'KnowledgeLoadError.tsx');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'stubs') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/**
 * A file only participates if it consumes a knowledge query at all. That is
 * what separates this interaction from a same-shaped one it does not own:
 * WindowWrapper's `retry` comes from useInstallProgress (a language-data
 * install), and its failure genuinely is not a knowledge read.
 */
const KNOWLEDGE_QUERY = /useKnowledgeHistory|useWordEaseHistory|useKnowledgeProjection|projected\b/;

/**
 * A knowledge query's retry, in either of the two shapes it can reach markup:
 * handed to the canonical owner (`onRetry={...}`) or wired straight to a raw
 * element (`onClick={history.retry}`). The second is the copy this guards.
 */
const KNOWLEDGE_RETRY_BINDING =
  /(onRetry|onClick)=\{\{?[^{}]*\b(retry|projected\.retry|history\.retry|model\.retry)\b/;

describe('knowledge failure presentation has one owner', () => {
  it('no surface renders a knowledge-query retry outside KnowledgeLoadError', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(RENDERER)) {
      if (file.endsWith(OWNER)) continue;
      const src = readFileSync(file, 'utf8');
      if (!KNOWLEDGE_QUERY.test(src)) continue;
      if (!KNOWLEDGE_RETRY_BINDING.test(src)) continue;
      // Renders the canonical owner — not merely imports it, which a file can
      // do while still wiring some retry straight to a raw element.
      const rendersOwner = /<KnowledgeLoadError[\s/>]/.test(src);
      if (!rendersOwner) offenders.push(file.replace(RENDERER, ''));
    }
    expect(offenders).toEqual([]);
  });

  it('the canonical owner is what the knowledge panels actually use', () => {
    // Guards against the component being deleted or renamed out from under its
    // consumers, which would silently leave the failures unhandled.
    const consumers = tsxFiles(RENDERER).filter((f) =>
      readFileSync(f, 'utf8').includes('KnowledgeLoadError'));
    expect(consumers.length).toBeGreaterThanOrEqual(4);
  });
});
