import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { KNOWLEDGE_ASPECT_LABEL_KEYS, SURFACE_WEIGHTS, type KnowledgeAspect } from '../src/shared/constants';

const LOCALES = ['en', 'ja', 'ru', 'zh', 'de', 'fr'] as const;

function localeObject(code: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, '../src/root-of-app/locales', `lang.${code}.json`), 'utf-8'));
}

function hasKeyPath(root: Record<string, unknown>, dottedPath: string): boolean {
  let node: unknown = root;
  for (const part of dottedPath.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

/**
 * Guards against key-path drift between code constants and locale files: a key
 * that exists as a STRING somewhere in the file (e.g. pasted into the wrong
 * block) still fails here. Born from a real bug where aspect labels inserted
 * after the first "Prosody" anchor landed in Flashcards.Review.Modes instead
 * of Knowledge.Aspect, and only the string presence — never the path — was
 * verified.
 */
describe('locale key paths for knowledge constants', () => {
  it('every KNOWLEDGE_ASPECT_LABEL_KEYS path exists in every locale', () => {
    for (const code of LOCALES) {
      const locale = localeObject(code);
      for (const key of Object.values(KNOWLEDGE_ASPECT_LABEL_KEYS)) {
        expect(hasKeyPath(locale, key), `${code}: missing ${key}`).toBe(true);
      }
    }
  });

  it('every aspect weighted above zero in any surface has a label key', () => {
    const weighted = new Set<KnowledgeAspect>();
    for (const profile of Object.values(SURFACE_WEIGHTS)) {
      for (const [aspect, weight] of Object.entries(profile)) {
        if (weight > 0) weighted.add(aspect as KnowledgeAspect);
      }
    }
    for (const aspect of weighted) {
      expect(KNOWLEDGE_ASPECT_LABEL_KEYS[aspect], `${aspect} lacks a locale label key`).toBeDefined();
    }
  });
});
