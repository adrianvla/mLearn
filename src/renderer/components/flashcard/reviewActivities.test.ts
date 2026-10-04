import { fitLearningModel, learningAddress } from '../../../shared/learningModel';
import { describe, expect, it } from 'vitest';
import { eligibleReviewActivities, selectReviewActivity, activityScaffolds, activityTask } from './reviewActivities';
import type { Flashcard, LanguageData } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
const card = { id: 'one', content: { front: '表', reading: 'おもて', back: 'front', prosody: { position: 3 } } } as Flashcard;
const data = { name: 'Synthetic', learning: { reviewActivities: {
  'future::pattern': { kind: 'written-reading-recall', label: 'Pattern', prompt: 'Recall pattern', targets: ['future::pattern'] },
  'future::listen': { kind: 'audio-recognition', label: 'Listen', prompt: 'Identify word', targets: ['spoken-recognition'] },
} } } as LanguageData;
const preferences = DEFAULT_SETTINGS.reviewActivities;
const model = fitLearningModel([], 1000);
const context = { nowMs: 1000, horizonDays: 30, deferDays: 3 };
const weights = (capability: string) => ({ ...context, targetWeights: { [learningAddress({ entityId: 'entity', capability })]: 1 } });
describe('adaptive review activities', () => {
  it('uses staged cues only when useful and separates cyclic directions into different encounter choices', () => {
    const staged = { ...data, learning: { reviewActivities: {
      combined: { kind: 'written-reading-recall' as const, label: 'Combined', prompt: 'Recall', targets: ['surface-reading', 'future::pattern'], stages: [
        { id: 'pattern', kind: 'written-reading-recall' as const, label: 'Pattern', prompt: 'Pattern', targets: ['future::pattern'], suppliedAccesses: ['surface-reading'] },
        { id: 'reading', kind: 'holistic' as const, label: 'Reading', prompt: 'Reading', targets: ['surface-reading'], suppliedAccesses: [] },
      ] },
      single: data.learning!.reviewActivities!['future::pattern'],
    } } };
    const choices = eligibleReviewActivities(card, staged, { ...preferences, holistic: false }, true);
    const combined = choices.find(choice => choice.id === 'combined:0')!;
    expect(activityTask(combined).stages?.map(stage => stage.id)).toEqual(['reading', 'pattern']);
    expect(selectReviewActivity(choices, model, 'entity', context).id).toBe('combined:0');
    expect(selectReviewActivity(choices, model, 'entity', weights('future::pattern')).targets).toContain('future::pattern');
    const cyclic = { ...staged, learning: { reviewActivities: { cycle: { ...staged.learning.reviewActivities.combined,
      stages: [
        { id: 'a', kind: 'holistic' as const, label: 'A', prompt: 'A', targets: ['x:a'], suppliedAccesses: ['x:b'] },
        { id: 'b', kind: 'written-reading-recall' as const, label: 'B', prompt: 'B', targets: ['x:b'], suppliedAccesses: ['x:a'] },
      ] } } } };
    expect(eligibleReviewActivities(card, cyclic, preferences, true).filter(choice => choice.id.startsWith('cycle:')).map(choice => choice.targets)).toEqual([['x:a'], ['x:b']]);
  });
  it('selects a package-owned access from explicit outcome scope and supplies only its written cues', () => {
    const choices = eligibleReviewActivities(card, data, preferences, true);
    const selected = selectReviewActivity(choices, model, 'entity', weights('future::pattern'));
    expect(selected.id).toBe('future::pattern');
    expect(selected.targets).toEqual(['future::pattern']);
    expect(activityScaffolds(selected)['provided-access:surface-reading']).toBe(true);
    expect(activityScaffolds(selected)['provided-access:future::pattern']).toBeUndefined();
  });
  it('keeps ordinary mixed written recall when prosody is the reason for selection', () => {
    const installed: LanguageData = { name: 'Future', learning: { capabilities: {
      'sense-recognition': {}, 'surface-reading': {}, 'prosodic-pattern': {},
    }, reviewActivities: { pattern: { kind: 'written-reading-recall', label: 'Pattern', prompt: 'Recall', targets: ['prosodic-pattern'] } } } };
    const choices = eligibleReviewActivities(card, installed, preferences, false);
    const selected = selectReviewActivity(choices, model, 'entity', weights('prosodic-pattern'));
    expect(selected.kind).toBe('holistic');
    expect(selected.targets).toEqual(expect.arrayContaining(['sense-recognition', 'surface-reading', 'prosodic-pattern']));
    expect(activityScaffolds(selected)).toEqual({});
    expect(eligibleReviewActivities(card, installed, { ...preferences, holistic: false }, false)[0].kind).toBe('written-reading-recall');
  });
  it('requires actual resources, excludes disabled modes, and never substitutes text for audio', () => {
    expect(eligibleReviewActivities(card, data, preferences, false).map(a => a.kind)).not.toContain('audio-recognition');
    expect(eligibleReviewActivities({ ...card, content: { ...card.content, prosody: undefined } }, data, preferences, true).map(a => a.kind)).not.toContain('written-reading-recall');
    expect(eligibleReviewActivities(card, data, { holistic: false, focused: false, audio: true }, true).map(a => a.kind)).toEqual(['audio-recognition']);
    expect(eligibleReviewActivities(card, data, { holistic: false, focused: false, audio: true }, false)).toEqual([]);
  });
  it('changes activity with meaningful scope and preserves unknown package IDs', () => {
    const choices = eligibleReviewActivities(card, data, preferences, true);
    expect(selectReviewActivity(choices, model, 'entity', weights('spoken-recognition')).id).toBe('future::listen');
    expect(JSON.parse(JSON.stringify(choices))[1].targets).toEqual(['future::pattern']);
  });
});
