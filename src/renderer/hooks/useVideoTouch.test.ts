import { createRoot } from 'solid-js';

vi.mock('../../shared/platform', () => ({ isMobile: vi.fn(() => true) }));

interface VideoTouchTarget {
  state: { currentTime: number };
  seek: (time: number) => void;
  togglePlay: () => void;
}

const createTouchEvent = (type: string, clientX: number, clientY = 0) =>
  new TouchEvent(type, {
    touches: type === 'touchend' ? [] : [{ clientX, clientY } as Touch],
    changedTouches: [{ clientX, clientY } as Touch],
    bubbles: true,
  });

const flushMicrotasks = () => new Promise<void>((r) => queueMicrotask(r));

describe('useVideoTouch', () => {
  let video: VideoTouchTarget;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    video = {
      state: { currentTime: 100 },
      seek: vi.fn(),
      togglePlay: vi.fn(),
    };
    container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 }),
    });
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
  });

  describe('when not mobile', () => {
    it('does nothing', async () => {
      vi.resetModules();
      vi.doMock('../../shared/platform', () => ({ isMobile: vi.fn(() => false) }));

      const { useVideoTouch } = await import('./useVideoTouch');
      const addSpy = vi.spyOn(container, 'addEventListener');

      createRoot((dispose) => {
        useVideoTouch(video, () => container);
        dispose();
      });

      await flushMicrotasks();
      expect(addSpy).not.toHaveBeenCalled();
      addSpy.mockRestore();
    });
  });

  describe('when mobile', () => {
    let useVideoTouch: typeof import('./useVideoTouch')['useVideoTouch'];

    beforeEach(async () => {
      vi.resetModules();
      vi.doMock('../../shared/platform', () => ({ isMobile: vi.fn(() => true) }));
      const mod = await import('./useVideoTouch');
      useVideoTouch = mod.useVideoTouch;
    });

    it('does nothing when containerRef returns undefined', async () => {
      const addSpy = vi.spyOn(container, 'addEventListener');

      createRoot((dispose) => {
        useVideoTouch(video, () => undefined);
        dispose();
      });

      await flushMicrotasks();
      expect(addSpy).not.toHaveBeenCalled();
      addSpy.mockRestore();
    });

    it('sets up touch listeners on mount', async () => {
      const addSpy = vi.spyOn(container, 'addEventListener');

      let dispose: () => void;
      createRoot((d) => {
        dispose = d;
        useVideoTouch(video, () => container);
      });

      await flushMicrotasks();

      expect(addSpy).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true });
      expect(addSpy).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: true });
      expect(addSpy).toHaveBeenCalledWith('touchend', expect.any(Function), { passive: true });

      dispose!();
      addSpy.mockRestore();
    });

    it('swipe right seeks forward 10s', async () => {
      let dispose: () => void;
      createRoot((d) => {
        dispose = d;
        useVideoTouch(video, () => container);
      });

      await flushMicrotasks();

      container.dispatchEvent(createTouchEvent('touchstart', 50));
      container.dispatchEvent(createTouchEvent('touchmove', 120));
      container.dispatchEvent(createTouchEvent('touchend', 120));

      expect(video.seek).toHaveBeenCalledWith(110);
      dispose!();
    });

    it('swipe left seeks backward 10s', async () => {
      let dispose: () => void;
      createRoot((d) => {
        dispose = d;
        useVideoTouch(video, () => container);
      });

      await flushMicrotasks();

      container.dispatchEvent(createTouchEvent('touchstart', 150));
      container.dispatchEvent(createTouchEvent('touchmove', 80));
      container.dispatchEvent(createTouchEvent('touchend', 80));

      expect(video.seek).toHaveBeenCalledWith(90);
      dispose!();
    });

    it('swipe too short is not treated as swipe', async () => {
      let dispose: () => void;
      createRoot((d) => {
        dispose = d;
        useVideoTouch(video, () => container);
      });

      await flushMicrotasks();

      container.dispatchEvent(createTouchEvent('touchstart', 100));
      container.dispatchEvent(createTouchEvent('touchmove', 110));
      container.dispatchEvent(createTouchEvent('touchend', 110));

      expect(video.seek).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(video.togglePlay).toHaveBeenCalled();
      dispose!();
    });

    it('double tap left third seeks back 5s', async () => {
      let dispose: () => void;
      createRoot((d) => {
        dispose = d;
        useVideoTouch(video, () => container);
      });

      await flushMicrotasks();

      container.dispatchEvent(createTouchEvent('touchstart', 30));
      container.dispatchEvent(createTouchEvent('touchend', 30));

      vi.advanceTimersByTime(100);

      container.dispatchEvent(createTouchEvent('touchstart', 30));
      container.dispatchEvent(createTouchEvent('touchend', 30));

      expect(video.seek).toHaveBeenCalledWith(95);
      dispose!();
    });

    it('double tap right third seeks forward 5s', async () => {
      let dispose: () => void;
      createRoot((d) => {
        dispose = d;
        useVideoTouch(video, () => container);
      });

      await flushMicrotasks();

      container.dispatchEvent(createTouchEvent('touchstart', 250));
      container.dispatchEvent(createTouchEvent('touchend', 250));

      vi.advanceTimersByTime(100);

      container.dispatchEvent(createTouchEvent('touchstart', 250));
      container.dispatchEvent(createTouchEvent('touchend', 250));

      expect(video.seek).toHaveBeenCalledWith(105);
      dispose!();
    });

    it('double tap center toggles play', async () => {
      let dispose: () => void;
      createRoot((d) => {
        dispose = d;
        useVideoTouch(video, () => container);
      });

      await flushMicrotasks();

      container.dispatchEvent(createTouchEvent('touchstart', 150));
      container.dispatchEvent(createTouchEvent('touchend', 150));

      vi.advanceTimersByTime(100);

      container.dispatchEvent(createTouchEvent('touchstart', 150));
      container.dispatchEvent(createTouchEvent('touchend', 150));

      expect(video.togglePlay).toHaveBeenCalled();
      dispose!();
    });

    it('single tap toggles play after 300ms timeout', async () => {
      let dispose: () => void;
      createRoot((d) => {
        dispose = d;
        useVideoTouch(video, () => container);
      });

      await flushMicrotasks();

      container.dispatchEvent(createTouchEvent('touchstart', 150));
      container.dispatchEvent(createTouchEvent('touchend', 150));

      expect(video.togglePlay).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);

      expect(video.togglePlay).toHaveBeenCalledTimes(1);
      dispose!();
    });

    it('cleanup removes touch listeners', async () => {
      const removeSpy = vi.spyOn(container, 'removeEventListener');

      let dispose: () => void;
      createRoot((d) => {
        dispose = d;
        useVideoTouch(video, () => container);
      });

      await flushMicrotasks();

      dispose!();

      expect(removeSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
      removeSpy.mockRestore();
    });
  });
});
