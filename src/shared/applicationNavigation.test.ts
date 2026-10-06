import { describe, expect, it } from 'vitest';
import { applicationHostForPath, isApplicationNavigation, resolveApplicationDestination } from './applicationNavigation';

describe('application destinations', () => {
  it('maps every logical destination to exactly one desktop family', () => {
    for (const path of ['/', '/reader', '/video']) expect(applicationHostForPath(path)).toBe('main');
    for (const path of ['/messenger', '/messenger/memory']) expect(applicationHostForPath(path)).toBe('messenger');
    for (const path of ['/practise', '/practise/material', '/practise/words', '/evaluate/grammar/mock', '/knowledge/material']) expect(applicationHostForPath(path)).toBe('study');
    for (const path of ['/plan', '/knowledge', '/knowledge/characters', '/progress']) expect(applicationHostForPath(path)).toBe('my-learning');
    expect(applicationHostForPath('/settings')).toBe('settings');
    expect(resolveApplicationDestination('study')?.path).toBe('/practise');
    expect(resolveApplicationDestination('my-learning')?.path).toBe('/plan');
    expect(resolveApplicationDestination('main', { applicationPath: '/video' })?.path).toBe('/video');
    expect(resolveApplicationDestination('main', { applicationPath: 'https://invalid.test' })?.path).toBe('/');
  });
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
    expect(resolveApplicationDestination('flashcards', { tab: 'browse' })?.path).toBe('/practise/material');
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
