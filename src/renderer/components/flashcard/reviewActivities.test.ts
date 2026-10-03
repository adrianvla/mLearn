import { describe, expect, it } from 'vitest';
import { eligibleReviewActivities, selectReviewActivity, activityScaffolds } from './reviewActivities';
import type { Flashcard, LanguageData } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
const card = { id: 'one', content: { front: '表', reading: 'おもて', back: 'front', prosody: { position: 3 } } } as Flashcard;
const data = { name: 'Synthetic', learning: { reviewActivities: {
  'future::pattern': { kind: 'written-reading-recall', label: 'Pattern', prompt: 'Recall pattern', targets: ['future::pattern'] },
  'future::listen': { kind: 'audio-recognition', label: 'Listen', prompt: 'Identify word', targets: ['spoken-recognition'] },
} } } as LanguageData;
const preferences = DEFAULT_SETTINGS.reviewActivities;
describe('adaptive review activities', () => {
  it('uses canonical weakness instead of rotating and supplies only the written cues', () => {
    const choices = eligibleReviewActivities(card, data, preferences, true);
    const selected = selectReviewActivity(choices, capability => ({ status: capability === 'future::pattern' ? 'unknown' : 'known', ease: 0, source: 'None' }));
    expect(selected.id).toBe('future::pattern');
    expect(selected.targets).toEqual(['future::pattern']);
    expect(activityScaffolds(selected)['provided-access:surface-reading']).toBe(true);
    expect(activityScaffolds(selected)['provided-access:future::pattern']).toBeUndefined();
  });
  it('requires actual resources, excludes disabled modes, and never substitutes text for audio', () => {
    expect(eligibleReviewActivities(card, data, preferences, false).map(a => a.kind)).not.toContain('audio-recognition');
    expect(eligibleReviewActivities({ ...card, content: { ...card.content, prosody: undefined } }, data, preferences, true).map(a => a.kind)).not.toContain('written-reading-recall');
    expect(eligibleReviewActivities(card, data, { holistic: false, focused: false, audio: true }, true).map(a => a.kind)).toEqual(['audio-recognition']);
    expect(eligibleReviewActivities(card, data, { holistic: false, focused: false, audio: true }, false)).toEqual([]);
  });
  it('does not repeatedly favor a just-practiced weak target and preserves unknown package IDs', () => {
    const choices = eligibleReviewActivities(card, data, preferences, true);
    expect(selectReviewActivity(choices, capability => ({ status: 'unknown', ease: 0, source: 'None', lastStatusChange: capability === 'future::pattern' ? 1000 : undefined }), 1001).id).not.toBe('future::pattern');
    expect(JSON.parse(JSON.stringify(choices))[1].targets).toEqual(['future::pattern']);
  });
});
