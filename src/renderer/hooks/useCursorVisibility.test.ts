import { createRoot } from 'solid-js';
import { useCursorVisibility } from './useCursorVisibility';

describe('useCursorVisibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.classList.remove('hide-cursor');
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.classList.remove('hide-cursor');
  });

  it('defaults to isVisible true', () => {
    createRoot((dispose) => {
      const { isVisible } = useCursorVisibility();
      expect(isVisible()).toBe(true);
      dispose();
    });
  });

  it('does not set up listeners when disabled', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');

    createRoot((dispose) => {
      useCursorVisibility({ enabled: false });
      expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
      dispose();
    });

    addSpy.mockRestore();
  });

  it('showCursor sets isVisible to true and removes body class', () => {
    createRoot((dispose) => {
      const { showCursor, hideCursor, isVisible } = useCursorVisibility();

      hideCursor();
      expect(isVisible()).toBe(false);
      expect(document.body.classList.contains('hide-cursor')).toBe(true);

      showCursor();
      expect(isVisible()).toBe(true);
      expect(document.body.classList.contains('hide-cursor')).toBe(false);

      dispose();
    });
  });

  it('hideCursor sets isVisible to false and adds body class', () => {
    createRoot((dispose) => {
      const { hideCursor, isVisible } = useCursorVisibility();

      hideCursor();
      expect(isVisible()).toBe(false);
      expect(document.body.classList.contains('hide-cursor')).toBe(true);

      dispose();
    });
  });

  it('forceShow sets isVisible to true and does NOT schedule auto-hide', () => {
    createRoot((dispose) => {
      const { forceShow, isVisible } = useCursorVisibility({ hideDelay: 1000 });

      forceShow();
      expect(isVisible()).toBe(true);
      expect(document.body.classList.contains('hide-cursor')).toBe(false);

      vi.advanceTimersByTime(2000);
      expect(isVisible()).toBe(true);

      dispose();
    });
  });

  it('hides cursor automatically after hideDelay', () => {
    createRoot((dispose) => {
      const { isVisible, showCursor } = useCursorVisibility({ hideDelay: 1000 });

      showCursor();
      expect(isVisible()).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(isVisible()).toBe(false);
      expect(document.body.classList.contains('hide-cursor')).toBe(true);

      dispose();
    });
  });

  it('mouse movement resets the hide timer', () => {
    createRoot((dispose) => {
      const { isVisible, showCursor } = useCursorVisibility({ hideDelay: 1000 });

      showCursor();

      vi.advanceTimersByTime(800);
      expect(isVisible()).toBe(true);

      showCursor();

      vi.advanceTimersByTime(800);
      expect(isVisible()).toBe(true);

      vi.advanceTimersByTime(200);
      expect(isVisible()).toBe(false);

      dispose();
    });
  });

  it('useBodyClass=false does not touch body classes', () => {
    createRoot((dispose) => {
      const { hideCursor, showCursor } = useCursorVisibility({ useBodyClass: false });

      hideCursor();
      expect(document.body.classList.contains('hide-cursor')).toBe(false);

      showCursor();
      expect(document.body.classList.contains('hide-cursor')).toBe(false);

      dispose();
    });
  });

  it('uses custom target element when provided', () => {
    const target = document.createElement('div');

    createRoot((dispose) => {
      const { showCursor, isVisible, hideCursor } = useCursorVisibility({ target });

      hideCursor();
      expect(isVisible()).toBe(false);

      showCursor();
      expect(isVisible()).toBe(true);

      dispose();
    });
  });

  it('cleanup removes listeners and body class', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    createRoot((dispose) => {
      useCursorVisibility();

      document.body.classList.add('hide-cursor');

      dispose();

      expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(document.body.classList.contains('hide-cursor')).toBe(false);
    });

    removeSpy.mockRestore();
  });
});
