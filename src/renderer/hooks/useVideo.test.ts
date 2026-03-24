import { createRoot } from 'solid-js';
import { useVideo, useVideoKeyboard } from './useVideo';

function createMockVideoElement(): HTMLVideoElement {
  const el = document.createElement('video');
  el.play = vi.fn().mockResolvedValue(undefined);
  el.pause = vi.fn();
  el.load = vi.fn();
  return el;
}

describe('useVideo', () => {
  describe('initial state', () => {
    it('has correct default values', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(video.state.currentTime).toBe(0);
        expect(video.state.duration).toBe(0);
        expect(video.state.isPlaying).toBe(false);
        expect(video.state.isMuted).toBe(false);
        expect(video.state.volume).toBe(1);
        expect(video.state.playbackRate).toBe(1);
        expect(video.state.isLoaded).toBe(false);
        expect(video.state.isPiP).toBe(false);
        expect(video.state.isFullscreen).toBe(false);
        dispose();
      });
    });

    it('videoSrc defaults to empty string', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(video.videoSrc()).toBe('');
        dispose();
      });
    });
  });

  describe('attachVideo', () => {
    it('adds event listeners to video element', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        const addSpy = vi.spyOn(el, 'addEventListener');

        video.attachVideo(el);

        expect(addSpy).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith('durationchange', expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith('play', expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith('pause', expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith('volumechange', expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith('loadeddata', expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith('enterpictureinpicture', expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith('leavepictureinpicture', expect.any(Function));

        dispose();
      });
    });

    it('adds fullscreenchange listener to document', () => {
      const docSpy = vi.spyOn(document, 'addEventListener');

      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        expect(docSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));

        dispose();
      });
    });

    it('detaches previous element before attaching new one', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el1 = createMockVideoElement();
        const el2 = createMockVideoElement();
        const removeSpy = vi.spyOn(el1, 'removeEventListener');

        video.attachVideo(el1);
        video.attachVideo(el2);

        expect(removeSpy).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('play', expect.any(Function));

        dispose();
      });
    });
  });

  describe('detachVideo', () => {
    it('removes event listeners from video element', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        const removeSpy = vi.spyOn(el, 'removeEventListener');

        video.attachVideo(el);
        video.detachVideo();

        expect(removeSpy).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('durationchange', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('play', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('pause', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('volumechange', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('loadeddata', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('enterpictureinpicture', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('leavepictureinpicture', expect.any(Function));

        dispose();
      });
    });

    it('removes fullscreenchange listener from document on detach', () => {
      const docRemoveSpy = vi.spyOn(document, 'removeEventListener');

      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);
        video.detachVideo();

        expect(docRemoveSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));

        dispose();
      });
    });

    it('is a no-op when no video is attached', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(() => video.detachVideo()).not.toThrow();
        dispose();
      });
    });
  });

  describe('event handlers update state', () => {
    it('timeupdate updates currentTime from element', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'currentTime', { value: 42.5, writable: true, configurable: true });
        el.dispatchEvent(new Event('timeupdate'));

        expect(video.state.currentTime).toBe(42.5);
        dispose();
      });
    });

    it('durationchange updates duration from element', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'duration', { value: 120, writable: true, configurable: true });
        el.dispatchEvent(new Event('durationchange'));

        expect(video.state.duration).toBe(120);
        dispose();
      });
    });

    it('play event sets isPlaying to true', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        el.dispatchEvent(new Event('play'));

        expect(video.state.isPlaying).toBe(true);
        dispose();
      });
    });

    it('pause event sets isPlaying to false', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        el.dispatchEvent(new Event('play'));
        el.dispatchEvent(new Event('pause'));

        expect(video.state.isPlaying).toBe(false);
        dispose();
      });
    });

    it('volumechange updates volume and isMuted from element', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'volume', { value: 0.5, writable: true, configurable: true });
        Object.defineProperty(el, 'muted', { value: true, writable: true, configurable: true });
        el.dispatchEvent(new Event('volumechange'));

        expect(video.state.volume).toBe(0.5);
        expect(video.state.isMuted).toBe(true);
        dispose();
      });
    });

    it('loadeddata sets isLoaded to true and updates duration', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'duration', { value: 200, writable: true, configurable: true });
        el.dispatchEvent(new Event('loadeddata'));

        expect(video.state.isLoaded).toBe(true);
        expect(video.state.duration).toBe(200);
        dispose();
      });
    });

    it('enterpictureinpicture sets isPiP to true', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        el.dispatchEvent(new Event('enterpictureinpicture'));

        expect(video.state.isPiP).toBe(true);
        dispose();
      });
    });

    it('leavepictureinpicture sets isPiP to false', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        el.dispatchEvent(new Event('enterpictureinpicture'));
        el.dispatchEvent(new Event('leavepictureinpicture'));

        expect(video.state.isPiP).toBe(false);
        dispose();
      });
    });

    it('fullscreenchange reflects document.fullscreenElement', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(document, 'fullscreenElement', {
          value: el,
          writable: true,
          configurable: true,
        });
        document.dispatchEvent(new Event('fullscreenchange'));

        expect(video.state.isFullscreen).toBe(true);

        Object.defineProperty(document, 'fullscreenElement', {
          value: null,
          writable: true,
          configurable: true,
        });
        document.dispatchEvent(new Event('fullscreenchange'));

        expect(video.state.isFullscreen).toBe(false);

        dispose();
      });
    });
  });

  describe('playback controls', () => {
    it('play() calls element.play()', async () => {
      await createRoot(async (dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        await video.play();

        expect(el.play).toHaveBeenCalled();
        dispose();
      });
    });

    it('pause() calls element.pause()', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        video.pause();

        expect(el.pause).toHaveBeenCalled();
        dispose();
      });
    });

    it('togglePlay calls play when not playing', async () => {
      await createRoot(async (dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        await video.togglePlay();

        expect(el.play).toHaveBeenCalled();
        dispose();
      });
    });

    it('togglePlay calls pause when playing', async () => {
      await createRoot(async (dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        el.dispatchEvent(new Event('play'));
        await video.togglePlay();

        expect(el.pause).toHaveBeenCalled();
        dispose();
      });
    });

    it('play() is a no-op when no video attached', async () => {
      await createRoot(async (dispose) => {
        const video = useVideo();
        await expect(video.play()).resolves.toBeUndefined();
        dispose();
      });
    });

    it('pause() is a no-op when no video attached', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(() => video.pause()).not.toThrow();
        dispose();
      });
    });
  });

  describe('seek', () => {
    it('seek sets currentTime on element', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'duration', { value: 100, writable: true, configurable: true });
        el.dispatchEvent(new Event('durationchange'));

        video.seek(50);

        expect(el.currentTime).toBe(50);
        dispose();
      });
    });

    it('seek clamps to 0 when given negative value', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'duration', { value: 100, writable: true, configurable: true });
        el.dispatchEvent(new Event('durationchange'));

        video.seek(-10);

        expect(el.currentTime).toBe(0);
        dispose();
      });
    });

    it('seek clamps to duration when given value exceeding it', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'duration', { value: 100, writable: true, configurable: true });
        el.dispatchEvent(new Event('durationchange'));

        video.seek(200);

        expect(el.currentTime).toBe(100);
        dispose();
      });
    });

    it('seekRelative adjusts currentTime by delta', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'duration', { value: 100, writable: true, configurable: true });
        el.dispatchEvent(new Event('durationchange'));

        Object.defineProperty(el, 'currentTime', { value: 30, writable: true, configurable: true });
        el.dispatchEvent(new Event('timeupdate'));

        video.seekRelative(5);

        expect(el.currentTime).toBe(35);
        dispose();
      });
    });

    it('seek is a no-op when no video attached', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(() => video.seek(10)).not.toThrow();
        dispose();
      });
    });
  });

  describe('volume controls', () => {
    it('setVolume sets element.volume', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        video.setVolume(0.5);

        expect(el.volume).toBe(0.5);
        dispose();
      });
    });

    it('setVolume clamps to 0 when given negative value', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        video.setVolume(-0.5);

        expect(el.volume).toBe(0);
        dispose();
      });
    });

    it('setVolume clamps to 1 when given value over 1', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        video.setVolume(1.5);

        expect(el.volume).toBe(1);
        dispose();
      });
    });

    it('toggleMute flips element.muted', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        expect(el.muted).toBe(false);
        video.toggleMute();
        expect(el.muted).toBe(true);
        video.toggleMute();
        expect(el.muted).toBe(false);

        dispose();
      });
    });

    it('setVolume is a no-op when no video attached', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(() => video.setVolume(0.5)).not.toThrow();
        dispose();
      });
    });

    it('toggleMute is a no-op when no video attached', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(() => video.toggleMute()).not.toThrow();
        dispose();
      });
    });
  });

  describe('playback rate', () => {
    it('setPlaybackRate sets rate on element and state', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        video.setPlaybackRate(1.5);

        expect(el.playbackRate).toBe(1.5);
        expect(video.state.playbackRate).toBe(1.5);
        dispose();
      });
    });

    it('setPlaybackRate is a no-op when no video attached', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(() => video.setPlaybackRate(2)).not.toThrow();
        dispose();
      });
    });
  });

  describe('togglePiP', () => {
    it('calls requestPictureInPicture when PiP is not active and enabled', async () => {
      await createRoot(async (dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        el.requestPictureInPicture = vi.fn().mockResolvedValue(undefined);
        video.attachVideo(el);

        Object.defineProperty(document, 'pictureInPictureElement', {
          value: null,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(document, 'pictureInPictureEnabled', {
          value: true,
          writable: true,
          configurable: true,
        });

        await video.togglePiP();

        expect(el.requestPictureInPicture).toHaveBeenCalled();
        dispose();
      });
    });

    it('calls exitPictureInPicture when PiP is active', async () => {
      await createRoot(async (dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(document, 'pictureInPictureElement', {
          value: el,
          writable: true,
          configurable: true,
        });
        document.exitPictureInPicture = vi.fn().mockResolvedValue(undefined);

        await video.togglePiP();

        expect(document.exitPictureInPicture).toHaveBeenCalled();
        dispose();
      });
    });

    it('togglePiP is a no-op when no video attached', async () => {
      await createRoot(async (dispose) => {
        const video = useVideo();
        await expect(video.togglePiP()).resolves.toBeUndefined();
        dispose();
      });
    });
  });

  describe('toggleFullscreen', () => {
    it('calls requestFullscreen on parentElement when not in fullscreen', async () => {
      await createRoot(async (dispose) => {
        const video = useVideo();
        const container = document.createElement('div');
        const el = createMockVideoElement();
        container.appendChild(el);
        container.requestFullscreen = vi.fn().mockResolvedValue(undefined);
        video.attachVideo(el);

        Object.defineProperty(document, 'fullscreenElement', {
          value: null,
          writable: true,
          configurable: true,
        });

        await video.toggleFullscreen();

        expect(container.requestFullscreen).toHaveBeenCalled();
        dispose();
      });
    });

    it('calls exitFullscreen when already in fullscreen', async () => {
      await createRoot(async (dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        const mockEl = document.createElement('div');
        Object.defineProperty(document, 'fullscreenElement', {
          value: mockEl,
          writable: true,
          configurable: true,
        });
        document.exitFullscreen = vi.fn().mockResolvedValue(undefined);

        await video.toggleFullscreen();

        expect(document.exitFullscreen).toHaveBeenCalled();
        dispose();
      });
    });
  });

  describe('loading', () => {
    it('loadVideo sets src on element and resets state', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        el.dispatchEvent(new Event('play'));
        expect(video.state.isPlaying).toBe(true);

        video.loadVideo('video.mp4');

        expect(video.videoSrc()).toBe('video.mp4');
        expect(video.state.isLoaded).toBe(false);
        expect(video.state.currentTime).toBe(0);
        expect(el.load).toHaveBeenCalled();
        dispose();
      });
    });

    it('loadVideo sets videoSrc even without attached element', () => {
      createRoot((dispose) => {
        const video = useVideo();

        video.loadVideo('some-video.mp4');

        expect(video.videoSrc()).toBe('some-video.mp4');
        expect(video.state.isLoaded).toBe(false);
        dispose();
      });
    });

    it('loadVideoFile creates an object URL and loads the video', () => {
      const mockUrl = 'blob:mock-url-123';
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockUrl);

      createRoot((dispose) => {
        const video = useVideo();
        const file = new File(['content'], 'test.mp4', { type: 'video/mp4' });

        video.loadVideoFile(file);

        expect(createObjectURLSpy).toHaveBeenCalledWith(file);
        expect(video.videoSrc()).toBe(mockUrl);

        dispose();
      });

      createObjectURLSpy.mockRestore();
    });
  });

  describe('formatTime', () => {
    it('formats seconds without hours as MM:SS', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(video.formatTime(65)).toBe('1:05');
        dispose();
      });
    });

    it('formats seconds with hours as H:MM:SS', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(video.formatTime(3661)).toBe('1:01:01');
        dispose();
      });
    });

    it('formats zero as 0:00', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(video.formatTime(0)).toBe('0:00');
        dispose();
      });
    });

    it('returns 00:00 for NaN', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(video.formatTime(NaN)).toBe('00:00');
        dispose();
      });
    });

    it('returns 00:00 for Infinity', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(video.formatTime(Infinity)).toBe('00:00');
        dispose();
      });
    });

    it('formats minutes correctly with zero-padded seconds', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(video.formatTime(125)).toBe('2:05');
        dispose();
      });
    });
  });

  describe('computed memos', () => {
    it('formattedCurrentTime reflects state.currentTime', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'currentTime', { value: 65, writable: true, configurable: true });
        el.dispatchEvent(new Event('timeupdate'));

        expect(video.formattedCurrentTime()).toBe('1:05');
        dispose();
      });
    });

    it('formattedDuration reflects state.duration', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'duration', { value: 3600, writable: true, configurable: true });
        el.dispatchEvent(new Event('durationchange'));

        expect(video.formattedDuration()).toBe('1:00:00');
        dispose();
      });
    });

    it('progress returns 0 when duration is 0', () => {
      createRoot((dispose) => {
        const video = useVideo();
        expect(video.progress()).toBe(0);
        dispose();
      });
    });

    it('progress computes percentage correctly', () => {
      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        video.attachVideo(el);

        Object.defineProperty(el, 'duration', { value: 100, writable: true, configurable: true });
        el.dispatchEvent(new Event('durationchange'));

        Object.defineProperty(el, 'currentTime', { value: 25, writable: true, configurable: true });
        el.dispatchEvent(new Event('timeupdate'));

        expect(video.progress()).toBe(25);
        dispose();
      });
    });
  });

  describe('cleanup', () => {
    it('detaches video element on dispose', () => {
      let removeSpy: ReturnType<typeof vi.spyOn>;

      createRoot((dispose) => {
        const video = useVideo();
        const el = createMockVideoElement();
        removeSpy = vi.spyOn(el, 'removeEventListener');
        video.attachVideo(el);
        dispose();

        expect(removeSpy).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('play', expect.any(Function));
      });
    });
  });
});

describe('useVideoKeyboard', () => {
  function setupKeyboard() {
    let video: ReturnType<typeof useVideo>;
    let dispose: () => void;

    createRoot((d) => {
      video = useVideo();
      dispose = d;
      const el = createMockVideoElement();
      el.play = vi.fn().mockResolvedValue(undefined);
      el.pause = vi.fn();
      video.attachVideo(el);
      useVideoKeyboard(video);
    });

    return { video: video!, dispose: dispose! };
  }

  function fireKey(code: string, extra: Partial<KeyboardEventInit> = {}) {
    document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...extra }));
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Space calls togglePlay', () => {
    const { video, dispose } = setupKeyboard();
    const toggleSpy = vi.spyOn(video, 'togglePlay');

    fireKey('Space');

    expect(toggleSpy).toHaveBeenCalled();
    dispose();
  });

  it('ArrowLeft seeks -5 seconds', () => {
    const { video, dispose } = setupKeyboard();
    const seekSpy = vi.spyOn(video, 'seekRelative');

    fireKey('ArrowLeft');

    expect(seekSpy).toHaveBeenCalledWith(-5);
    dispose();
  });

  it('Shift+ArrowLeft seeks -10 seconds', () => {
    const { video, dispose } = setupKeyboard();
    const seekSpy = vi.spyOn(video, 'seekRelative');

    fireKey('ArrowLeft', { shiftKey: true });

    expect(seekSpy).toHaveBeenCalledWith(-10);
    dispose();
  });

  it('ArrowRight seeks +5 seconds', () => {
    const { video, dispose } = setupKeyboard();
    const seekSpy = vi.spyOn(video, 'seekRelative');

    fireKey('ArrowRight');

    expect(seekSpy).toHaveBeenCalledWith(5);
    dispose();
  });

  it('Shift+ArrowRight seeks +10 seconds', () => {
    const { video, dispose } = setupKeyboard();
    const seekSpy = vi.spyOn(video, 'seekRelative');

    fireKey('ArrowRight', { shiftKey: true });

    expect(seekSpy).toHaveBeenCalledWith(10);
    dispose();
  });

  it('ArrowUp increases volume by 0.1', () => {
    const { video, dispose } = setupKeyboard();
    const volumeSpy = vi.spyOn(video, 'setVolume');

    fireKey('ArrowUp');

    expect(volumeSpy).toHaveBeenCalledWith(video.state.volume + 0.1);
    dispose();
  });

  it('ArrowDown decreases volume by 0.1', () => {
    const { video, dispose } = setupKeyboard();
    const volumeSpy = vi.spyOn(video, 'setVolume');

    fireKey('ArrowDown');

    expect(volumeSpy).toHaveBeenCalledWith(video.state.volume - 0.1);
    dispose();
  });

  it('KeyM calls toggleMute', () => {
    const { video, dispose } = setupKeyboard();
    const muteSpy = vi.spyOn(video, 'toggleMute');

    fireKey('KeyM');

    expect(muteSpy).toHaveBeenCalled();
    dispose();
  });

  it('KeyF calls toggleFullscreen', () => {
    const { video, dispose } = setupKeyboard();
    const fsSpy = vi.spyOn(video, 'toggleFullscreen');

    fireKey('KeyF');

    expect(fsSpy).toHaveBeenCalled();
    dispose();
  });

  it('Ctrl+KeyP calls togglePiP', () => {
    const { video, dispose } = setupKeyboard();
    const pipSpy = vi.spyOn(video, 'togglePiP');

    fireKey('KeyP', { ctrlKey: true });

    expect(pipSpy).toHaveBeenCalled();
    dispose();
  });

  it('Meta+KeyP calls togglePiP', () => {
    const { video, dispose } = setupKeyboard();
    const pipSpy = vi.spyOn(video, 'togglePiP');

    fireKey('KeyP', { metaKey: true });

    expect(pipSpy).toHaveBeenCalled();
    dispose();
  });

  it('KeyP without Ctrl/Meta does not call togglePiP', () => {
    const { video, dispose } = setupKeyboard();
    const pipSpy = vi.spyOn(video, 'togglePiP');

    fireKey('KeyP');

    expect(pipSpy).not.toHaveBeenCalled();
    dispose();
  });

  it('Shift+Comma decreases playback rate by 0.25', () => {
    const { video, dispose } = setupKeyboard();
    const rateSpy = vi.spyOn(video, 'setPlaybackRate');

    fireKey('Comma', { shiftKey: true });

    expect(rateSpy).toHaveBeenCalledWith(0.75);
    dispose();
  });

  it('Shift+Period increases playback rate by 0.25', () => {
    const { video, dispose } = setupKeyboard();
    const rateSpy = vi.spyOn(video, 'setPlaybackRate');

    fireKey('Period', { shiftKey: true });

    expect(rateSpy).toHaveBeenCalledWith(1.25);
    dispose();
  });

  it('Comma without Shift does not change playback rate', () => {
    const { video, dispose } = setupKeyboard();
    const rateSpy = vi.spyOn(video, 'setPlaybackRate');

    fireKey('Comma');

    expect(rateSpy).not.toHaveBeenCalled();
    dispose();
  });

  it('ignores keydown when focused on input element', () => {
    const { video, dispose } = setupKeyboard();
    const toggleSpy = vi.spyOn(video, 'togglePlay');

    const input = document.createElement('input');
    document.body.appendChild(input);

    input.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    );

    expect(toggleSpy).not.toHaveBeenCalled();
    dispose();
  });

  it('ignores keydown when focused on textarea element', () => {
    const { video, dispose } = setupKeyboard();
    const toggleSpy = vi.spyOn(video, 'togglePlay');

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    );

    expect(toggleSpy).not.toHaveBeenCalled();
    dispose();
  });

  it('removes keydown listener on dispose', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    createRoot((dispose) => {
      const video = useVideo();
      useVideoKeyboard(video);
      dispose();

      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });
});
