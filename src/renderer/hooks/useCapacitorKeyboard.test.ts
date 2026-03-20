import { createRoot } from 'solid-js';

vi.mock('../../shared/platform', () => ({ isMobile: vi.fn(() => false) }));

const mockShowListener = { remove: vi.fn() };
const mockHideListener = { remove: vi.fn() };
let showCallback: (info: { keyboardHeight: number }) => void;
let hideCallback: () => void;

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'keyboardWillShow') {
        showCallback = cb as (info: { keyboardHeight: number }) => void;
        return Promise.resolve(mockShowListener);
      }
      if (event === 'keyboardWillHide') {
        hideCallback = cb as () => void;
        return Promise.resolve(mockHideListener);
      }
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
}));

describe('useCapacitorKeyboard', () => {
  beforeEach(() => {
    document.body.classList.remove('keyboard-visible');
    document.documentElement.style.removeProperty('--keyboard-height');
  });

  describe('when not mobile', () => {
    it('does nothing — no listeners added', async () => {
      const { isMobile } = await import('../../shared/platform');
      vi.mocked(isMobile).mockReturnValue(false);

      const { useCapacitorKeyboard } = await import('./useCapacitorKeyboard');
      const { Keyboard } = await import('@capacitor/keyboard');

      createRoot((dispose) => {
        useCapacitorKeyboard();
        dispose();
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(vi.mocked(Keyboard.addListener)).not.toHaveBeenCalled();
    });
  });

  describe('when mobile', () => {
    let dispose: () => void;
    let KeyboardMock: { addListener: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      vi.resetModules();
      mockShowListener.remove.mockClear();
      mockHideListener.remove.mockClear();

      KeyboardMock = {
        addListener: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'keyboardWillShow') {
            showCallback = cb as (info: { keyboardHeight: number }) => void;
            return Promise.resolve(mockShowListener);
          }
          if (event === 'keyboardWillHide') {
            hideCallback = cb as () => void;
            return Promise.resolve(mockHideListener);
          }
          return Promise.resolve({ remove: vi.fn() });
        }),
      };

      vi.doMock('../../shared/platform', () => ({ isMobile: vi.fn(() => true) }));
      vi.doMock('@capacitor/keyboard', () => ({ Keyboard: KeyboardMock }));
    });

    afterEach(() => {
      dispose?.();
    });

    it('sets up keyboard listeners on mount', async () => {
      const { useCapacitorKeyboard } = await import('./useCapacitorKeyboard');

      createRoot((d) => {
        dispose = d;
        useCapacitorKeyboard();
      });

      await vi.waitFor(() => {
        expect(KeyboardMock.addListener).toHaveBeenCalledWith(
          'keyboardWillShow',
          expect.any(Function),
        );
        expect(KeyboardMock.addListener).toHaveBeenCalledWith(
          'keyboardWillHide',
          expect.any(Function),
        );
      });
    });

    it('keyboardWillShow adds body class and sets CSS variable', async () => {
      const { useCapacitorKeyboard } = await import('./useCapacitorKeyboard');

      createRoot((d) => {
        dispose = d;
        useCapacitorKeyboard();
      });

      await vi.waitFor(() => {
        expect(KeyboardMock.addListener).toHaveBeenCalled();
      });

      showCallback({ keyboardHeight: 300 });

      expect(document.body.classList.contains('keyboard-visible')).toBe(true);
      expect(
        document.documentElement.style.getPropertyValue('--keyboard-height'),
      ).toBe('300px');
    });

    it('keyboardWillHide removes body class and resets CSS variable', async () => {
      const { useCapacitorKeyboard } = await import('./useCapacitorKeyboard');

      createRoot((d) => {
        dispose = d;
        useCapacitorKeyboard();
      });

      await vi.waitFor(() => {
        expect(KeyboardMock.addListener).toHaveBeenCalled();
      });

      document.body.classList.add('keyboard-visible');
      document.documentElement.style.setProperty('--keyboard-height', '300px');

      hideCallback();

      expect(document.body.classList.contains('keyboard-visible')).toBe(false);
      expect(
        document.documentElement.style.getPropertyValue('--keyboard-height'),
      ).toBe('0px');
    });

    it('registers onCleanup inside async onMount (cleanup runs outside tracking scope)', async () => {
      const { useCapacitorKeyboard } = await import('./useCapacitorKeyboard');

      createRoot((d) => {
        dispose = d;
        useCapacitorKeyboard();
      });

      await vi.waitFor(() => {
        expect(KeyboardMock.addListener).toHaveBeenCalled();
      });

      dispose();
    });

    it('handles @capacitor/keyboard import failure gracefully', async () => {
      vi.resetModules();

      vi.doMock('../../shared/platform', () => ({ isMobile: vi.fn(() => true) }));
      vi.doMock('@capacitor/keyboard', () => {
        throw new Error('Module not available');
      });

      const { useCapacitorKeyboard } = await import('./useCapacitorKeyboard');

      createRoot((d) => {
        dispose = d;
        useCapacitorKeyboard();
      });

      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
