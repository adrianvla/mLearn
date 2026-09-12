import { describe, expect, it, vi } from 'vitest';
import type { CapabilityKey } from '../../shared/types';
import type { WordStatus } from '../../shared/constants';
import { getWrittenComprehensionStatus } from './writtenComprehension';

describe('written comprehension', () => {
  it('does not hide a word known by sound when its presented surface access is unknown', () => {
    const read = vi.fn((_word: string, capability: CapabilityKey) => ({
      status: capability === 'surface-recognition' ? 'unknown' as const : 'known' as const,
      ease: 0, source: 'None' as const,
    }));
    expect(getWrittenComprehensionStatus({ surface: '会う', language: 'ja' }, read)).toBe('unknown');
  });

  it('requires meaning as well as the written identity access', () => {
    const read = (_word: string, capability: CapabilityKey) => ({
      status: capability === 'sense-recognition' ? 'learning' as const : 'known' as const,
      ease: 0, source: 'None' as const,
    });
    expect(getWrittenComprehensionStatus({ surface: '会う', language: 'ja' }, read)).toBe('learning');
  });

  it('ignores unknown pronunciation and prosody during silent comprehension', () => {
    const statuses: Partial<Record<CapabilityKey, WordStatus>> = {
      'surface-recognition': 'known', 'sense-recognition': 'known',
      'surface-reading': 'unknown', 'prosodic-pattern': 'unknown',
    };
    const read = vi.fn((_word: string, capability: CapabilityKey) => ({ status: statuses[capability] ?? 'unknown', ease: 0, source: 'None' as const }));
    expect(getWrittenComprehensionStatus({ surface: '会う', language: 'ja' }, read)).toBe('known');
    expect(read.mock.calls.map(call => call[1])).toEqual(['surface-recognition', 'sense-recognition']);
  });

  it('keeps surface identity separate from the lexical lookup and language', () => {
    const read = vi.fn(() => ({ status: 'known' as const, ease: 0, source: 'None' as const }));
    getWrittenComprehensionStatus({ surface: 'variant', lexicalWord: 'lemma', language: 'third-party' }, read);
    expect(read.mock.calls).toEqual([
      ['variant', 'surface-recognition', 'third-party'], ['lemma', 'sense-recognition', 'third-party'],
    ]);
  });
});

describe('written comprehension with the canonical access resolver', () => {
  it('keeps a written alias unknown while the known surface comprehends without reading or prosody', async () => {
    const { getAccessStatusSync } = await import('./accessKnowledge');
    const deps = {
      language: 'ja', getCanonicalForm: () => '会う', getWordForms: () => ['会う', 'あう'],
      hashWordSync: (word: string) => word, langKey: (language: string, hash: string) => `${language}:${hash}`,
      ignoredWords: {}, knownEaseThreshold: 1.8, learningThreshold: 1.5,
      wordKnowledge: {
        'ja:会う': {
          word: '会う', language: 'ja', ease: 0, lastSeen: 1, timesSeen: 1, timesHovered: 0,
          claim: 'known' as const, claimAt: 1,
          access: {
            'surface-recognition': { status: 'known' as const, ease: 2, source: 'Manual' as const, lastStatusChange: 1, updatedAt: 1 },
            'surface-reading': { status: 'unknown' as const, ease: 0, source: 'Manual' as const, lastStatusChange: 1, updatedAt: 1 },
            'prosodic-pattern': { status: 'unknown' as const, ease: 0, source: 'Manual' as const, lastStatusChange: 1, updatedAt: 1 },
          },
        },
      },
    };
    const read = (word: string, capability: CapabilityKey) => getAccessStatusSync(word, capability, deps);
    expect(getWrittenComprehensionStatus({ surface: '会う', language: 'ja' }, read)).toBe('known');
    expect(getWrittenComprehensionStatus({ surface: 'あう', lexicalWord: '会う', language: 'ja' }, read)).toBe('unknown');
  });
});
