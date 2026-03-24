// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOpenWindow = vi.fn();
const mockOnLookupDeepLink = vi.fn();

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    window: {
      openWindow: mockOpenWindow,
      onLookupDeepLink: mockOnLookupDeepLink,
    },
  }),
}));

describe('wordLookupService', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  describe('openWordLookup', () => {
    it('calls getBridge().window.openWindow with WORD_DEFINITION type and the trimmed word', async () => {
      const { openWordLookup } = await import('./wordLookupService');
      openWordLookup('hello');
      expect(mockOpenWindow).toHaveBeenCalledWith({
        type: 'word-definition',
        options: { width: 480, height: 400 },
        context: { word: 'hello' },
      });
    });

    it('trims leading and trailing whitespace before opening the window', async () => {
      const { openWordLookup } = await import('./wordLookupService');
      openWordLookup('  hello  ');
      expect(mockOpenWindow).toHaveBeenCalledWith(
        expect.objectContaining({ context: { word: 'hello' } }),
      );
    });

    it('does not call openWindow when the word is empty', async () => {
      const { openWordLookup } = await import('./wordLookupService');
      openWordLookup('');
      expect(mockOpenWindow).not.toHaveBeenCalled();
    });

    it('does not call openWindow when the word is only whitespace', async () => {
      const { openWordLookup } = await import('./wordLookupService');
      openWordLookup('   ');
      expect(mockOpenWindow).not.toHaveBeenCalled();
    });

    it('passes the word unchanged when it contains no extra whitespace', async () => {
      const { openWordLookup } = await import('./wordLookupService');
      openWordLookup('世界');
      expect(mockOpenWindow).toHaveBeenCalledWith(
        expect.objectContaining({ context: { word: '世界' } }),
      );
    });
  });

  describe('initWordLookupBridge', () => {
    it('registers a deep-link listener via getBridge().window.onLookupDeepLink', async () => {
      mockOnLookupDeepLink.mockReturnValue(() => {});
      const { initWordLookupBridge } = await import('./wordLookupService');
      initWordLookupBridge();
      expect(mockOnLookupDeepLink).toHaveBeenCalledOnce();
    });

    it('returns the cleanup function returned by onLookupDeepLink', async () => {
      const cleanup = vi.fn();
      mockOnLookupDeepLink.mockReturnValue(cleanup);
      const { initWordLookupBridge } = await import('./wordLookupService');
      const returned = initWordLookupBridge();
      expect(returned).toBe(cleanup);
    });

    it('only registers the listener once even when called multiple times', async () => {
      mockOnLookupDeepLink.mockReturnValue(() => {});
      const { initWordLookupBridge } = await import('./wordLookupService');
      initWordLookupBridge();
      initWordLookupBridge();
      initWordLookupBridge();
      expect(mockOnLookupDeepLink).toHaveBeenCalledOnce();
    });

    it('returns a no-op function on the second and subsequent calls', async () => {
      mockOnLookupDeepLink.mockReturnValue(() => {});
      const { initWordLookupBridge } = await import('./wordLookupService');
      initWordLookupBridge();
      const second = initWordLookupBridge();
      expect(typeof second).toBe('function');
      expect(() => second()).not.toThrow();
    });

    it('calls openWordLookup when the registered deep-link callback fires', async () => {
      let capturedCallback: ((word: string) => void) | undefined;
      mockOnLookupDeepLink.mockImplementation((cb: (word: string) => void) => {
        capturedCallback = cb;
        return () => {};
      });
      const { initWordLookupBridge } = await import('./wordLookupService');
      initWordLookupBridge();
      capturedCallback!('test');
      expect(mockOpenWindow).toHaveBeenCalledWith(
        expect.objectContaining({ context: { word: 'test' } }),
      );
    });
  });
});
