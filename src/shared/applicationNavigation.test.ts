import { describe, expect, it } from 'vitest';
import { isApplicationNavigation, resolveApplicationDestination } from './applicationNavigation';

describe('application destinations', () => {
  it('keeps ordinary destinations stable and separates checks from practice', () => {
    expect(resolveApplicationDestination('flashcards')?.path).toBe('/practise');
    expect(resolveApplicationDestination('level-study')?.path).toBe('/plan');
    expect(resolveApplicationDestination('level-study', { activity: 'assessment' })?.path).toBe('/evaluate/words');
    expect(resolveApplicationDestination('level-study', { activity: 'practice', material: { words: ['x'] } }))
      .toEqual({ path: '/practise/words', context: { activity: 'practice', material: { words: ['x'] } } });
    expect(resolveApplicationDestination('level-study', { activity: 'grammar', patterns: ['x'] })?.path).toBe('/practise/grammar');
    expect(resolveApplicationDestination('level-study', { activity: 'grammar', purpose: 'evaluate', patterns: ['x'] })?.path).toBe('/evaluate/grammar');
  });
  it('opens Messenger regardless of provider readiness and keeps saved management distinct', () => {
    expect(resolveApplicationDestination('conversation-agent')?.path).toBe('/messenger');
    expect(resolveApplicationDestination('flashcards', { tab: 'browse' })?.path).toBe('/knowledge/material');
    expect(resolveApplicationDestination('character-grid')?.path).toBe('/knowledge/characters');
  });
  it('redirects legacy pairing to real connections and retains recovery context', () => {
    expect(resolveApplicationDestination('connect-qr')).toEqual({ path: '/settings', context: { section: 'connection' } });
    expect(resolveApplicationDestination('settings', { section: 'general' })).toEqual({ path: '/settings', context: { section: 'general' } });
  });
  it('generic opens carry no stale start or resume request', () => {
    resolveApplicationDestination('flashcards', { activity: 'review', session: { requestId: 'old' } });
    expect(resolveApplicationDestination('flashcards')).toEqual({ path: '/practise', context: {} });
  });
  it('accepts immersion and Home navigation while refusing external destinations', () => {
    for (const path of ['/', '/reader', '/video']) expect(isApplicationNavigation({ applicationNavigation: { path, requestId: 'native' } })).toBe(true);
    expect(isApplicationNavigation({ applicationNavigation: { path: 'https://example.com', requestId: 'native' } })).toBe(false);
  });
  it('preserves native boundaries', () => {
    for (const type of ['overlay', 'word-definition', 'welcome', 'plugin-host', 'diagnostics']) {
      expect(resolveApplicationDestination(type)).toBeNull();
    }
  });
});
