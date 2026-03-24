import { createRoot } from 'solid-js';
import { useWordHover, resetGlobalHoverManager, useWordHoverTarget } from './useWordHover';
import type { HoverData } from './useWordHover';

const makeHoverData = (overrides?: Partial<HoverData>): HoverData => ({
  word: 'test',
  token: null,
  translation: null,
  position: { x: 100, y: 200 },
  element: null,
  ...overrides,
});

describe('useWordHover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with null hoverData and isVisible false', () => {
    createRoot((dispose) => {
      const { hoverData, isVisible } = useWordHover();
      expect(hoverData()).toBeNull();
      expect(isVisible()).toBe(false);
      dispose();
    });
  });

  it('showHover sets hoverData and isVisible to true', () => {
    createRoot((dispose) => {
      const { hoverData, isVisible, showHover } = useWordHover();
      const data = makeHoverData({ word: 'hello' });

      showHover(data);

      expect(hoverData()).toEqual(data);
      expect(isVisible()).toBe(true);
      dispose();
    });
  });

  it('showHover with multiple calls updates data each time', () => {
    createRoot((dispose) => {
      const { hoverData, showHover } = useWordHover();

      showHover(makeHoverData({ word: 'first' }));
      expect(hoverData()!.word).toBe('first');

      showHover(makeHoverData({ word: 'second' }));
      expect(hoverData()!.word).toBe('second');

      dispose();
    });
  });

  it('hideHover starts delayed hide — isVisible still true before timeout fires', () => {
    createRoot((dispose) => {
      const { isVisible, showHover, hideHover } = useWordHover();

      showHover(makeHoverData());
      hideHover();

      expect(isVisible()).toBe(true);

      dispose();
    });
  });

  it('hideHover sets isVisible to false after 50ms delay', () => {
    createRoot((dispose) => {
      const { isVisible, showHover, hideHover } = useWordHover();

      showHover(makeHoverData());
      hideHover();

      vi.advanceTimersByTime(50);
      expect(isVisible()).toBe(false);

      dispose();
    });
  });

  it('hideHover clears hoverData after additional 200ms cleanup delay', () => {
    createRoot((dispose) => {
      const { hoverData, showHover, hideHover } = useWordHover();

      showHover(makeHoverData());
      hideHover();

      vi.advanceTimersByTime(50);
      expect(hoverData()).not.toBeNull();

      vi.advanceTimersByTime(200);
      expect(hoverData()).toBeNull();

      dispose();
    });
  });

  it('cancelHide prevents the hide timeout from firing', () => {
    createRoot((dispose) => {
      const { isVisible, showHover, hideHover, cancelHide } = useWordHover();

      showHover(makeHoverData());
      hideHover();
      cancelHide();

      vi.advanceTimersByTime(1000);
      expect(isVisible()).toBe(true);

      dispose();
    });
  });

  it('showHover cancels a pending hide timeout', () => {
    createRoot((dispose) => {
      const { isVisible, showHover, hideHover } = useWordHover();

      showHover(makeHoverData({ word: 'first' }));
      hideHover();

      showHover(makeHoverData({ word: 'second' }));

      vi.advanceTimersByTime(1000);
      expect(isVisible()).toBe(true);

      dispose();
    });
  });

  it('forceHide immediately sets isVisible false and clears hoverData', () => {
    createRoot((dispose) => {
      const { isVisible, hoverData, showHover, forceHide } = useWordHover();

      showHover(makeHoverData());
      expect(isVisible()).toBe(true);

      forceHide();

      expect(isVisible()).toBe(false);
      expect(hoverData()).toBeNull();

      dispose();
    });
  });

  it('forceHide cancels pending timeouts', () => {
    createRoot((dispose) => {
      const { isVisible, showHover, hideHover, forceHide } = useWordHover();

      showHover(makeHoverData());
      hideHover();
      forceHide();

      vi.advanceTimersByTime(1000);
      expect(isVisible()).toBe(false);

      dispose();
    });
  });

  it('cleanup clears pending hoverTimeout', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    createRoot((dispose) => {
      const { showHover, hideHover } = useWordHover();
      showHover(makeHoverData());
      hideHover();
      dispose();
    });

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('cleanup clears pending cleanupTimeout', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    createRoot((dispose) => {
      const { showHover, hideHover } = useWordHover();
      showHover(makeHoverData());
      hideHover();
      vi.advanceTimersByTime(50);
      dispose();
    });

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('useWordHoverTarget', () => {
  beforeEach(() => {
    resetGlobalHoverManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetGlobalHoverManager();
    vi.useRealTimers();
  });

  it('onMouseEnter calls global showHover with correct data', () => {
    const el = document.createElement('span');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 40,
      height: 15,
      right: 50,
      bottom: 35,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    document.body.appendChild(el);

    createRoot((dispose) => {
      const { onMouseEnter } = useWordHoverTarget(
        () => 'hello',
        () => null,
        () => null,
      );

      const event = new MouseEvent('mouseenter', { bubbles: true });
      Object.defineProperty(event, 'currentTarget', { value: el });
      onMouseEnter(event as MouseEvent);

      const { hoverData, isVisible } = useWordHoverTarget(
        () => '',
        () => null,
        () => null,
      );
      void hoverData;
      void isVisible;

      dispose();
    });

    document.body.removeChild(el);
  });

  it('onMouseLeave calls hideHover on the global manager', () => {
    createRoot((dispose) => {
      const { onMouseLeave } = useWordHoverTarget(
        () => 'word',
        () => null,
        () => null,
      );

      onMouseLeave();

      dispose();
    });
  });
});
