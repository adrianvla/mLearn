import { describe, expect, it } from 'vitest';
import { applicationHostForPath, isApplicationPath, resolveApplicationDestination } from './applicationNavigation';

describe('restored desktop activity identities', () => {
  it('keeps saved cards in the same native workspace as Review', () => {
    for (const tab of ['browse', 'generate', 'suggested']) {
      const destination = resolveApplicationDestination('flashcards', { tab });
      expect(destination?.path).toBe('/practise/material');
      expect(destination?.context.tab).toBe(tab);
      expect(applicationHostForPath(destination!.path)).toBe('study');
    }
    expect(applicationHostForPath('/knowledge/material')).toBe('study');
    expect(applicationHostForPath('/knowledge')).toBe('my-learning');
  });

  it('opens Messenger alongside media instead of replacing Main', () => {
    const destination = resolveApplicationDestination('conversation-agent', { returnTo: 'video' });
    expect(destination?.path).toBe('/messenger');
    expect(destination?.context.returnTo).toBe('video');
    expect(applicationHostForPath('/messenger')).toBe('messenger');
    expect(applicationHostForPath('/messenger/memory')).toBe('messenger');
    expect(applicationHostForPath('/reader')).toBe('main');
    expect(applicationHostForPath('/video')).toBe('main');
  });

  it('recognizes the material route without accepting unrelated paths', () => {
    expect(isApplicationPath('/practise/material')).toBe(true);
    expect(isApplicationPath('/settings')).toBe(true);
    expect(isApplicationPath('https://example.test/practise')).toBe(false);
    expect(isApplicationPath('/messenger-unknown')).toBe(false);
  });
});
