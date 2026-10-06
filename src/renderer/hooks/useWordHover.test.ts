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

describe('useWordHover lookup admission lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('admits once across source-to-popup transit and dismisses only when the popup closes', () => {
    const source = document.createElement('span');
    const onDismiss = vi.fn();
    const onAdmit = vi.fn();
    let hover!: ReturnType<typeof useWordHover>;
    let dispose!: () => void;
    createRoot((disposeRoot) => {
      hover = useWordHover({ onDismiss });
      dispose = disposeRoot;
    });

    const opened = makeHoverData({ element: source, trackPassiveHover: true });
    hover.showHover(opened);
    expect(hover.admitVisibleReveal(onAdmit)).toBe(true);
    expect(hover.admitVisibleReveal(onAdmit)).toBe(false);
    expect(onAdmit).toHaveBeenCalledOnce();

    hover.hideHover();
    vi.advanceTimersByTime(25);
    hover.cancelHide();
    hover.showHover(opened);
    expect(hover.isCurrentHover(opened)).toBe(true);
    expect(hover.admitVisibleReveal(onAdmit)).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();

    hover.hideHover();
    vi.advanceTimersByTime(50);
    expect(hover.isVisible()).toBe(false);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith(opened);
    dispose();
  });

  it('treats another occurrence and a deliberate reopen as separate interactions', () => {
    const firstSource = document.createElement('span');
    const secondSource = document.createElement('span');
    const onDismiss = vi.fn();
    const onAdmit = vi.fn();
    let hover!: ReturnType<typeof useWordHover>;
    let dispose!: () => void;
    createRoot((disposeRoot) => {
      hover = useWordHover({ onDismiss });
      dispose = disposeRoot;
    });

    const first = makeHoverData({ element: firstSource, trackPassiveHover: true });
    const second = makeHoverData({ element: secondSource, trackPassiveHover: true });
    hover.showHover(first);
    expect(hover.admitVisibleReveal(onAdmit)).toBe(true);

    hover.showHover(second);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith(first);
    expect(hover.admitVisibleReveal(onAdmit)).toBe(true);
    expect(onAdmit).toHaveBeenCalledTimes(2);

    hover.forceHide();
    expect(onDismiss).toHaveBeenCalledTimes(2);
    hover.showHover(second);
    expect(hover.admitVisibleReveal(onAdmit)).toBe(true);
    expect(onAdmit).toHaveBeenCalledTimes(3);
    dispose();
  });

  it('does not admit a source marked ineligible for passive tracking', () => {
    const source = document.createElement('span');
    const onAdmit = vi.fn();
    let hover!: ReturnType<typeof useWordHover>;
    let dispose!: () => void;
    createRoot((disposeRoot) => {
      hover = useWordHover();
      dispose = disposeRoot;
    });

    hover.showHover(makeHoverData({ element: source, trackPassiveHover: false }));
    expect(hover.admitVisibleReveal(onAdmit)).toBe(false);
    expect(onAdmit).not.toHaveBeenCalled();
    dispose();
  });

  it('updates geometry without starting a new lookup admission for the active occurrence', () => {
    const source = document.createElement('span');
    const onDismiss = vi.fn();
    const onAdmit = vi.fn();
    let hover!: ReturnType<typeof useWordHover>;
    let dispose!: () => void;
    createRoot((disposeRoot) => {
      hover = useWordHover({ onDismiss });
      dispose = disposeRoot;
    });

    const opened = makeHoverData({ element: source, trackPassiveHover: true });
    expect(hover.showHover(opened)).toBe(true);
    expect(hover.admitVisibleReveal(onAdmit)).toBe(true);
    const moved = { ...opened, position: { x: 240, y: 180 }, anchorRect: new DOMRect(220, 170, 40, 18) };
    expect(hover.showHover(moved)).toBe(false);
    expect(hover.updateHoverPosition(moved)).toBe(true);
    expect(hover.hoverData()).toMatchObject({ position: moved.position, anchorRect: moved.anchorRect });
    expect(hover.admitVisibleReveal(onAdmit)).toBe(false);
    expect(onAdmit).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    dispose();
  });

  it('does not apply geometry under a changed language or context identity', () => {
    const source = document.createElement('span');
    let hover!: ReturnType<typeof useWordHover>;
    let dispose!: () => void;
    createRoot((disposeRoot) => {
      hover = useWordHover();
      dispose = disposeRoot;
    });
    const opened = makeHoverData({ element: source, language: 'a', contextIdentity: 'first' });
    hover.showHover(opened);

    expect(hover.updateHoverPosition({ ...opened, language: 'b', position: { x: 300, y: 120 } })).toBe(false);
    expect(hover.updateHoverPosition({ ...opened, contextIdentity: 'second', position: { x: 300, y: 120 } })).toBe(false);
    expect(hover.hoverData()?.position).toEqual(opened.position);
    dispose();
  });
});
