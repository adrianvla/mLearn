import { createRoot } from 'solid-js';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useWatchTogether } from './useWatchTogether';

const mockShowToast = vi.fn();
const mockUpdateToast = vi.fn();

vi.mock('../components/common/Feedback/Toast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
  updateToast: (...args: unknown[]) => mockUpdateToast(...args),
}));

vi.mock('../context', () => ({
  useLocalization: () => ({
    t: (key: string) => key,
  }),
}));

const mockWatchTogetherSend = vi.fn();
const mockIsWatchingTogether = vi.fn();
let launchCallback: (() => void) | null = null;
let requestCallback: ((raw: unknown) => void) | null = null;
let launchCleanup: ReturnType<typeof vi.fn>;
let requestCleanup: ReturnType<typeof vi.fn>;

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    watchTogether: {
      onWatchTogetherLaunch: vi.fn((cb: () => void) => {
        launchCallback = cb;
        launchCleanup = vi.fn();
        return launchCleanup;
      }),
      onWatchTogetherRequest: vi.fn((cb: (raw: unknown) => void) => {
        requestCallback = cb;
        requestCleanup = vi.fn();
        return requestCleanup;
      }),
      watchTogetherSend: (...args: unknown[]) => mockWatchTogetherSend(...args),
      isWatchingTogether: (...args: unknown[]) => mockIsWatchingTogether(...args),
    },
  }),
}));

function createMockVideo(currentTime = 0, paused = true): HTMLVideoElement {
  return {
    currentTime,
    paused,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  } as unknown as HTMLVideoElement;
}

function createHook(videoOverride?: HTMLVideoElement | null, videoSrc = 'http://example.com/video.mp4') {
  const mockVideo = videoOverride !== undefined ? videoOverride : createMockVideo();
  return useWatchTogether({
    getVideo: () => mockVideo,
    getVideoSrc: () => videoSrc,
  });
}

describe('useWatchTogether', () => {
  beforeEach(() => {
    launchCallback = null;
    requestCallback = null;
    mockWatchTogetherSend.mockClear();
    mockIsWatchingTogether.mockClear();
  });

  describe('initial state', () => {
    it('starts with isActive false', () => {
      createRoot((dispose) => {
        const hook = createHook();
        expect(hook.isActive()).toBe(false);
        dispose();
      });
    });

    it('starts with isSuppressed false', () => {
      createRoot((dispose) => {
        const hook = createHook();
        expect(hook.isSuppressed).toBe(false);
        dispose();
      });
    });
  });

  describe('IPC listener registration', () => {
    it('registers onWatchTogetherLaunch listener on creation', () => {
      createRoot((dispose) => {
        createHook();
        expect(launchCallback).toBeTypeOf('function');
        dispose();
      });
    });

    it('registers onWatchTogetherRequest listener on creation', () => {
      createRoot((dispose) => {
        createHook();
        expect(requestCallback).toBeTypeOf('function');
        dispose();
      });
    });

    it('cleans up IPC listeners on dispose', () => {
      createRoot((dispose) => {
        createHook();
        dispose();
        expect(launchCleanup).toHaveBeenCalled();
        expect(requestCleanup).toHaveBeenCalled();
      });
    });
  });

  describe('activate / deactivate / toggle', () => {
    it('activate sets isActive to true and notifies bridge', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.activate();
        expect(hook.isActive()).toBe(true);
        expect(mockIsWatchingTogether).toHaveBeenCalled();
        dispose();
      });
    });

    it('deactivate sets isActive to false', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.activate();
        hook.deactivate();
        expect(hook.isActive()).toBe(false);
        dispose();
      });
    });

    it('toggle activates when inactive', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.toggle();
        expect(hook.isActive()).toBe(true);
        expect(mockIsWatchingTogether).toHaveBeenCalled();
        dispose();
      });
    });

    it('toggle deactivates when active', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.activate();
        mockIsWatchingTogether.mockClear();
        hook.toggle();
        expect(hook.isActive()).toBe(false);
        expect(mockIsWatchingTogether).not.toHaveBeenCalled();
        dispose();
      });
    });
  });

  describe('launch callback', () => {
    it('activates when main process fires launch callback', () => {
      createRoot((dispose) => {
        const hook = createHook();
        expect(hook.isActive()).toBe(false);
        launchCallback!();
        expect(hook.isActive()).toBe(true);
        dispose();
      });
    });
  });

  describe('outgoing messages', () => {
    it('sendPlay sends JSON with action play and time', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.activate();
        hook.sendPlay(42.5);
        expect(mockWatchTogetherSend).toHaveBeenCalledWith(
          JSON.stringify({ action: 'play', time: 42.5 }),
        );
        dispose();
      });
    });

    it('sendPause sends JSON with action pause and time', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.activate();
        hook.sendPause(10.0);
        expect(mockWatchTogetherSend).toHaveBeenCalledWith(
          JSON.stringify({ action: 'pause', time: 10.0 }),
        );
        dispose();
      });
    });

    it('sendSync sends JSON with action sync and time', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.activate();
        hook.sendSync(99.9);
        expect(mockWatchTogetherSend).toHaveBeenCalledWith(
          JSON.stringify({ action: 'sync', time: 99.9 }),
        );
        dispose();
      });
    });

    it('sendSubtitles sends subtitle HTML with size and weight', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.activate();
        hook.sendSubtitles('<span>Hello</span>', 24, 700);
        expect(mockWatchTogetherSend).toHaveBeenCalledWith(
          JSON.stringify({ action: 'subtitles', subtitle: '<span>Hello</span>', size: 24, weight: 700 }),
        );
        dispose();
      });
    });

    it('send is a no-op when inactive', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.sendPlay(10);
        hook.sendPause(20);
        hook.sendSync(30);
        hook.sendSubtitles('text', 16, 400);
        expect(mockWatchTogetherSend).not.toHaveBeenCalled();
        dispose();
      });
    });
  });

  describe('incoming messages — active', () => {
    it('play action sets currentTime and calls video.play()', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(0, true);
        const hook = createHook(mockVideo);
        hook.activate();
        requestCallback!(JSON.stringify({ action: 'play', time: 55.3 }));
        expect(mockVideo.currentTime).toBe(55.3);
        expect(mockVideo.play).toHaveBeenCalled();
        dispose();
      });
    });

    it('pause action sets currentTime and calls video.pause()', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(0, false);
        const hook = createHook(mockVideo);
        hook.activate();
        requestCallback!(JSON.stringify({ action: 'pause', time: 30.0 }));
        expect(mockVideo.currentTime).toBe(30.0);
        expect(mockVideo.pause).toHaveBeenCalled();
        dispose();
      });
    });

    it('sync action sets currentTime only', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(0, true);
        const hook = createHook(mockVideo);
        hook.activate();
        requestCallback!(JSON.stringify({ action: 'sync', time: 120.5 }));
        expect(mockVideo.currentTime).toBe(120.5);
        expect(mockVideo.play).not.toHaveBeenCalled();
        expect(mockVideo.pause).not.toHaveBeenCalled();
        dispose();
      });
    });

    it('request-response applies remote state with play', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(0, true);
        const hook = createHook(mockVideo);
        hook.activate();
        requestCallback!(JSON.stringify({
          action: 'request-response',
          time: 77.0,
          video_playing: true,
        }));
        expect(mockVideo.currentTime).toBe(77.0);
        expect(mockVideo.play).toHaveBeenCalled();
        dispose();
      });
    });

    it('request-response applies remote state without play when not playing', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(0, true);
        const hook = createHook(mockVideo);
        hook.activate();
        requestCallback!(JSON.stringify({
          action: 'request-response',
          time: 15.0,
          video_playing: false,
        }));
        expect(mockVideo.currentTime).toBe(15.0);
        expect(mockVideo.play).not.toHaveBeenCalled();
        dispose();
      });
    });

    it('unknown action (new client empty {}) responds with current video state', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(50.0, false);
        const hook = createHook(mockVideo, 'http://example.com/movie.mp4');
        hook.activate();
        mockWatchTogetherSend.mockClear();
        requestCallback!(JSON.stringify({}));
        expect(mockWatchTogetherSend).toHaveBeenCalledWith(
          JSON.stringify({
            action: 'request-response',
            url: 'http://example.com/movie.mp4',
            time: 50.0,
            video_playing: true,
          }),
        );
        dispose();
      });
    });

    it('does not crash when video is null on play action', () => {
      createRoot((dispose) => {
        const hook = createHook(null);
        hook.activate();
        expect(() => {
          requestCallback!(JSON.stringify({ action: 'play', time: 10 }));
        }).not.toThrow();
        dispose();
      });
    });

    it('does not crash when video is null on pause action', () => {
      createRoot((dispose) => {
        const hook = createHook(null);
        hook.activate();
        expect(() => {
          requestCallback!(JSON.stringify({ action: 'pause', time: 10 }));
        }).not.toThrow();
        dispose();
      });
    });

    it('does not crash when video is null on sync action', () => {
      createRoot((dispose) => {
        const hook = createHook(null);
        hook.activate();
        expect(() => {
          requestCallback!(JSON.stringify({ action: 'sync', time: 10 }));
        }).not.toThrow();
        dispose();
      });
    });

    it('does not crash when video is null on request-response action', () => {
      createRoot((dispose) => {
        const hook = createHook(null);
        hook.activate();
        expect(() => {
          requestCallback!(JSON.stringify({ action: 'request-response', time: 10, video_playing: true }));
        }).not.toThrow();
        dispose();
      });
    });

    it('does not set currentTime for sync when time is undefined', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(25.0, true);
        const hook = createHook(mockVideo);
        hook.activate();
        requestCallback!(JSON.stringify({ action: 'sync' }));
        expect(mockVideo.currentTime).toBe(25.0);
        dispose();
      });
    });
  });

  describe('incoming messages — inactive', () => {
    it('responds to empty {} from new client with current video state', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(33.0, true);
        const hook = createHook(mockVideo, 'http://example.com/series.mp4');
        expect(hook.isActive()).toBe(false);
        requestCallback!(JSON.stringify({}));
        expect(mockWatchTogetherSend).toHaveBeenCalledWith(
          JSON.stringify({
            action: 'request-response',
            url: 'http://example.com/series.mp4',
            time: 33.0,
            video_playing: false,
          }),
        );
        dispose();
      });
    });

    it('does not respond to empty {} when video is null', () => {
      createRoot((dispose) => {
        createHook(null);
        requestCallback!(JSON.stringify({}));
        expect(mockWatchTogetherSend).not.toHaveBeenCalled();
        dispose();
      });
    });

    it('ignores messages with actions when inactive', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(10, true);
        createHook(mockVideo);
        requestCallback!(JSON.stringify({ action: 'play', time: 50 }));
        expect(mockVideo.play).not.toHaveBeenCalled();
        expect(mockVideo.currentTime).toBe(10);
        dispose();
      });
    });
  });

  describe('invalid incoming data', () => {
    it('silently ignores invalid JSON', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.activate();
        expect(() => {
          requestCallback!('not valid json {{{');
        }).not.toThrow();
        dispose();
      });
    });

    it('ignores non-string incoming data', () => {
      createRoot((dispose) => {
        const hook = createHook();
        hook.activate();
        expect(() => {
          requestCallback!(12345);
        }).not.toThrow();
        expect(() => {
          requestCallback!(null);
        }).not.toThrow();
        expect(() => {
          requestCallback!(undefined);
        }).not.toThrow();
        dispose();
      });
    });
  });

  describe('isSuppressed flag', () => {
    it('is true while applying a pause command', () => {
      createRoot((dispose) => {
        const mockVideo = createMockVideo(0, false);
        let suppressedDuringPause = false;
        (mockVideo.pause as ReturnType<typeof vi.fn>).mockImplementation(() => {
          suppressedDuringPause = hook.isSuppressed;
        });
        const hook = createHook(mockVideo);
        hook.activate();
        requestCallback!(JSON.stringify({ action: 'pause', time: 5 }));
        expect(suppressedDuringPause).toBe(true);
        expect(hook.isSuppressed).toBe(false);
        dispose();
      });
    });

    it('is true while applying a play command', async () => {
      await createRoot(async (dispose) => {
        const mockVideo = createMockVideo(0, true);
        let suppressedDuringPlay = false;
        let resolvePlay!: () => void;
        const playPromise = new Promise<void>((r) => { resolvePlay = r; });
        (mockVideo.play as ReturnType<typeof vi.fn>).mockImplementation(() => {
          suppressedDuringPlay = hook.isSuppressed;
          return playPromise;
        });
        const hook = createHook(mockVideo);
        hook.activate();
        requestCallback!(JSON.stringify({ action: 'play', time: 10 }));
        expect(suppressedDuringPlay).toBe(true);
        expect(hook.isSuppressed).toBe(true);
        resolvePlay();
        await playPromise;
        await Promise.resolve();
        expect(hook.isSuppressed).toBe(false);
        dispose();
      });
    });
  });

  describe('return shape', () => {
    it('returns all expected properties and methods', () => {
      createRoot((dispose) => {
        const hook = createHook();
        expect(hook).toHaveProperty('isActive');
        expect(hook).toHaveProperty('activate');
        expect(hook).toHaveProperty('deactivate');
        expect(hook).toHaveProperty('toggle');
        expect(hook).toHaveProperty('sendPlay');
        expect(hook).toHaveProperty('sendPause');
        expect(hook).toHaveProperty('sendSync');
        expect(hook).toHaveProperty('sendSubtitles');
        expect(hook).toHaveProperty('isSuppressed');
        expect(hook.isActive).toBeTypeOf('function');
        expect(hook.activate).toBeTypeOf('function');
        expect(hook.deactivate).toBeTypeOf('function');
        expect(hook.toggle).toBeTypeOf('function');
        expect(hook.sendPlay).toBeTypeOf('function');
        expect(hook.sendPause).toBeTypeOf('function');
        expect(hook.sendSync).toBeTypeOf('function');
        expect(hook.sendSubtitles).toBeTypeOf('function');
        dispose();
      });
    });
  });

  describe('peer count and toast notifications', () => {
    beforeEach(() => {
      mockShowToast.mockClear();
      mockUpdateToast.mockClear();
    });

    it('tracks peer count from room state', () => {
      createRoot((dispose) => {
        const hook = createHook();
        expect(hook.peerCount()).toBe(0);
        dispose();
      });
    });
  });
});
