import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type FlashcardStore, type PassiveWordKnowledge } from '../../shared/types';
import { replayKeyProjection } from '../../shared/utils/projectionReplay';
import { getComprehensiveWordStatusWithSource } from './comprehensiveKnowledge';
import { getAccessStatusSync } from './accessKnowledge';
import { buildKnownWordSetFromStore } from './knowledgeUtils';
import { computeLevelStats, computeWordLevelStats, getWordLevelStatus } from './wordLevelStats';
import { hashWordSync } from '../services/srsAlgorithm';
import { wordSyncPoolStatus } from '../windows/wordSync/wordSyncPool';

const word = 'sample';
const key = `xx:${hashWordSync(word)}`;
const known = DEFAULT_SETTINGS.easeThresholdKnown;
const learning = DEFAULT_SETTINGS.easeThresholdLearning;
const entry = (fields: Partial<PassiveWordKnowledge> = {}): PassiveWordKnowledge => ({
  word, language: 'xx', ease: 1.3, timesSeen: 0, timesHovered: 0, lastSeen: 1, ...fields,
});
const store = (knowledge?: PassiveWordKnowledge): FlashcardStore => ({
  flashcards: {}, wordToCardMap: {}, wordCandidates: {}, knownUntracked: {}, ignoredWords: {},
  wordKnowledge: knowledge ? { [key]: knowledge } : {},
} as FlashcardStore);
const deps = (data: FlashcardStore) => ({
  getCanonicalForm: (value: string) => value, hashWordSync, langKey: (lang: string, hash: string) => `${lang}:${hash}`,
  language: 'xx', wordKnowledge: data.wordKnowledge, ignoredWords: data.ignoredWords,
  knownEaseThreshold: known, learningThreshold: learning,
});
const frequency = { [word]: { raw_level: 1, level: 'L1', reading: '' } };
const levelNames = { '1': 'L1' };

function assertParity(data: FlashcardStore, expected: 'untracked' | 'unknown' | 'learning' | 'known') {
  const state = getComprehensiveWordStatusWithSource(word, deps(data));
  expect(getWordLevelStatus(state)).toBe(expected);
  expect(wordSyncPoolStatus(state.status, state.basis)).toBe({ untracked: 'untracked', unknown: '0', learning: '1', known: '2' }[expected]);
  const [level] = computeLevelStats(data, frequency, 'xx', known * 1000, learning * 1000, levelNames);
  expect(level[expected]).toBe(1);
  expect(level.known + level.learning + level.unknown + level.untracked).toBe(1);
  const stats = computeWordLevelStats(data, frequency, 'xx', known * 1000, learning * 1000, levelNames);
  expect(stats.byLevel[0][expected]).toBe(1);
  expect(stats.allEncountered[expected]).toBe(1);
  expect(buildKnownWordSetFromStore(data, known * 1000).has(key)).toBe(expected === 'known');
  return state;
}

describe('canonical learner state across consumers', () => {
  it.each([
    ['never measured', undefined, 'untracked'],
    ['passive exposure only', entry({ timesSeen: 10, ease: known + 1 }), 'untracked'],
    ['explicit Unknown', entry({ claim: 'unknown' }), 'unknown'],
    ['negative active evidence', entry({ hasActiveEvidence: true }), 'unknown'],
    ['Learning', entry({ ease: learning, hasActiveEvidence: true }), 'learning'],
    ['Known', entry({ ease: known, hasActiveEvidence: true }), 'known'],
    ['claim overrides Known evidence', entry({ ease: known, hasActiveEvidence: true, claim: 'unknown' }), 'unknown'],
    ['Known claim overrides negative evidence', entry({ claim: 'known', hasActiveEvidence: true }), 'known'],
  ] as const)('%s', (_name, knowledge, expected) => {
    const data = store(knowledge);
    const state = assertParity(data, expected);
    const access = getAccessStatusSync(word, 'sense-recognition', deps(data));
    expect(access.status).toBe(state.status);
    expect(Boolean(access.untracked)).toBe(state.basis === 'unmeasured');
  });

  it('scaffold-supplied evidence cannot establish knowledge during replay', () => {
    const projected = replayKeyProjection([{ t: 1, kind: 'rating', source: 'manual', aspect: 'meaning',
      easeAfter: known, scaffolds: { translation: true } }]);
    expect(projected).toBeNull();
    assertParity(store(), 'untracked');
  });

  it('ignore and card ownership do not become epistemic evidence', () => {
    const data = store();
    data.ignoredWords[key] = { word, language: 'xx', ignoredAt: 1 };
    data.wordToCardMap[key] = ['card'];
    expect(assertParity(data, 'untracked').excluded).toBe(true);
  });

  it('Known remains Known when ignored', () => {
    const data = store(entry({ ease: known, hasActiveEvidence: true }));
    data.ignoredWords[key] = { word, language: 'xx', ignoredAt: 1 };
    expect(assertParity(data, 'known').excluded).toBe(true);
    delete data.ignoredWords[key];
    expect(assertParity(data, 'known').excluded).toBeUndefined();
  });

  it('spoken Known with a missing directed spelling bridge remains lexical Known', () => {
    const data = store(entry({ access: { 'spoken-recognition': {
      status: 'known', ease: known, source: 'Manual', lastStatusChange: 1, updatedAt: 1,
    } } }));
    assertParity(data, 'known');
    const written = getAccessStatusSync(word, 'surface-recognition', deps(data));
    expect(written.untracked).toBe(true);
  });

  it('a newer spoken claim overrides the word projection in every consumer', () => {
    assertParity(store(entry({ ease: known, hasActiveEvidence: true, claim: 'known', claimAt: 1,
      access: { 'spoken-recognition': { status: 'known', ease: known, claim: 'unknown', claimAt: 2,
        source: 'Manual', lastStatusChange: 1, updatedAt: 2 } },
    })), 'unknown');
  });

  it('measured Unknown wins over passive Unknown across a form family', () => {
    const data = store(entry({ timesSeen: 1 }));
    data.wordKnowledge[`xx:${hashWordSync('variant')}`] = entry({ word: 'variant', hasActiveEvidence: true });
    const resolve = (value: string) => getComprehensiveWordStatusWithSource(value, {
      ...deps(data), getWordForms: () => [word, 'variant'],
    });
    expect(resolve(word).basis).toBe('evidence');
    const [level] = computeLevelStats(data, frequency, 'xx', known * 1000, learning * 1000, levelNames,
      undefined, undefined, resolve);
    expect(level.unknown).toBe(1);
    expect(wordSyncPoolStatus(resolve(word).status, resolve(word).basis)).toBe('0');
  });
});
