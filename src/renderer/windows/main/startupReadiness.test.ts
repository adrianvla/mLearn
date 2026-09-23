import { describe, expect, it } from 'vitest';
import { startupRendererState } from './startupReadiness';

describe('main window startup readiness', () => {
  const ready = {
    languageLoading: false,
    libraryLoading: false,
    knowledgeReady: true,
    serverStatus: 'connected' as const,
  };

  it('waits for language and library hydration before revealing the main window', () => {
    expect(startupRendererState({ ...ready, languageLoading: true })).toBe('language');
    expect(startupRendererState({ ...ready, libraryLoading: true })).toBe('library');
    expect(startupRendererState({ ...ready, knowledgeReady: false })).toBe('library');
    expect(startupRendererState({ ...ready, serverStatus: 'loading' })).toBe('backend');
    expect(startupRendererState(ready)).toBe('ready');
  });

  it('reveals the main window when its actionable error UI is ready', () => {
    expect(startupRendererState({ ...ready, serverStatus: 'error' })).toBe('ready');
  });
});
