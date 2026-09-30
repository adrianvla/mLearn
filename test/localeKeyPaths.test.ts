import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import {
  LEGACY_KNOWLEDGE_ASPECT_LABEL_KEYS,
  LEGACY_KNOWLEDGE_ASPECTS,
} from '../src/shared/constants';

const LOCALES = ['en', 'ja', 'ru', 'zh', 'de', 'fr'] as const;

const localeCache = new Map<string, Record<string, unknown>>();

function localeObject(code: string): Record<string, unknown> {
  const cached = localeCache.get(code);
  if (cached) return cached;
  const parsed = JSON.parse(readFileSync(join(__dirname, '../src/root-of-app/locales', `lang.${code}.json`), 'utf-8'));
  localeCache.set(code, parsed);
  return parsed;
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
  it('every legacy knowledge aspect label path exists in every locale', () => {
    for (const code of LOCALES) {
      const locale = localeObject(code);
      for (const key of Object.values(LEGACY_KNOWLEDGE_ASPECT_LABEL_KEYS)) {
        expect(hasKeyPath(locale, key), `${code}: missing ${key}`).toBe(true);
      }
    }
  });

  it('every legacy knowledge aspect has a label key', () => {
    for (const aspect of LEGACY_KNOWLEDGE_ASPECTS) {
      expect(LEGACY_KNOWLEDGE_ASPECT_LABEL_KEYS[aspect], `${aspect} lacks a locale label key`).toBeDefined();
    }
  });
});

/**
 * Guards the whole renderer against inventing a locale key.
 *
 * The localization contract is that `t('mlearn.X.Y')` returns the raw path
 * when a key is absent, so an invented key is not a crash — it is a raw
 * `mlearn.…` string rendered straight to the learner. That failure shipped
 * twice on surfaces that report a refused durable write: the home rating
 * banner and the Suggested "Ignore" toast both named keys that no locale
 * ever defined, and neither was caught because the test suites assert
 * behaviour, not copy.
 *
 * This walks the renderer sources for statically-declared `mlearn.*` keys
 * and requires each one to resolve in all six locales.
 */
describe('every statically declared renderer locale key resolves', () => {
  const RENDERER_ROOT = join(__dirname, '../src/renderer');
  const SOURCE_FILE = /\.(ts|tsx)$/;
  const NOT_A_TEST = (file: string) => !file.includes('.test.');

  // A quoted mlearn.* path. Template placeholders after it are irrelevant:
  // only the key's path shape matters here.
  const KEY_LITERAL = /(['"])(mlearn(?:\.[A-Za-z0-9_]+)+)\1/g;

  function rendererSourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return rendererSourceFiles(full);
      if (!SOURCE_FILE.test(entry.name) || !NOT_A_TEST(full)) return [];
      return [full];
    });
  }

  const referenced = new Map<string, string[]>();

  for (const file of rendererSourceFiles(RENDERER_ROOT)) {
    const source = readFileSync(file, 'utf-8');
    for (const match of source.matchAll(KEY_LITERAL)) {
      const key = match[2]!;
      const sites = referenced.get(key) ?? [];
      sites.push(relative(join(__dirname, '..'), file));
      referenced.set(key, sites);
    }
  }

  it('finds renderer sources to check', () => {
    expect(referenced.size).toBeGreaterThan(500);
  });

  const leavesByLocale = new Map<string, Set<string>>();

  function localeLeaves(code: string): Set<string> {
    const cached = leavesByLocale.get(code);
    if (cached) return cached;
    const leaves = new Set<string>();
    const walk = (node: unknown, prefix: string): void => {
      if (typeof node !== 'object' || node === null) return;
      for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${name}` : name;
        if (typeof value === 'object' && value !== null) walk(value, path);
        else leaves.add(path);
      }
    };
    walk(localeObject(code), '');
    leavesByLocale.set(code, leaves);
    return leaves;
  }

  it('declares no key that a locale does not define', () => {
    const missing: string[] = [];
    for (const [key, sites] of referenced) {
      for (const code of LOCALES) {
        if (!localeLeaves(code).has(key)) {
          missing.push(`${key} missing from ${code} (used at ${sites[0]})`);
        }
      }
    }
    expect(missing).toEqual([]);
  }, 60_000);
});

/**
 * Guards the other direction: every locale must define exactly the keys every
 * other locale defines.
 *
 * The test above walks the source and asks "does this key exist?", which cannot
 * see a key that is missing from one language. `en` is the source language, so
 * a key added there and forgotten in `ja` is invisible to every other check
 * until a Japanese user sees a raw `mlearn.…` path. That is not hypothetical:
 * the destructive-data prompts landed with a whole `ResetSRS` block missing from
 * `ja`, and nothing failed until the shapes were compared directly.
 *
 * The second half of the rule is the stricter one: a key that exists nowhere
 * is dead weight in six files. Removing a control has to remove its copy too.
 */
describe('locale files declare the same key set', () => {
  function leafPaths(locale: Record<string, unknown>): Set<string> {
    const paths = new Set<string>();
    const walk = (node: unknown, prefix: string): void => {
      if (typeof node !== 'object' || node === null) return;
      for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${name}` : name;
        if (typeof value === 'object' && value !== null) walk(value, path);
        else paths.add(path);
      }
    };
    walk(locale, '');
    return paths;
  }

  it('every locale has the same keys as en', () => {
    const english = leafPaths(localeObject('en'));
    const problems: string[] = [];
    for (const code of LOCALES) {
      if (code === 'en') continue;
      const other = leafPaths(localeObject(code));
      for (const key of english) {
        if (!other.has(key)) problems.push(`${code} is missing ${key}`);
      }
      for (const key of other) {
        if (!english.has(key)) problems.push(`${code} defines ${key}, which en does not`);
      }
    }
    expect(problems).toEqual([]);
  }, 60_000);

  it('no locale leaves a translated value empty', () => {
    const empty: string[] = [];
    for (const code of LOCALES) {
      const walk = (node: unknown, prefix: string): void => {
        if (typeof node !== 'object' || node === null) return;
        for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
          const path = `${prefix}.${name}`;
          if (typeof value === 'object' && value !== null) walk(value, path);
          else if (typeof value === 'string' && value.trim() === '') empty.push(`${code}: ${path}`);
        }
      };
      walk(localeObject(code), '');
    }
    expect(empty).toEqual([]);
  }, 60_000);
});
