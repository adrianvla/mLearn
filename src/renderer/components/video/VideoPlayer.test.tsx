// @vitest-environment happy-dom

import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { VideoPlayer } from './VideoPlayer';

vi.mock('../../hooks', async () => {
  const { useVideo, useVideoKeyboard } = await import('../../hooks/useVideo');
  return {
    useVideo,
    useVideoKeyboard,
    useCursorVisibility: () => ({ isVisible: () => true }),
  };
});

vi.mock('../../hooks/useVideoTouch', () => ({ useVideoTouch: () => {} }));
vi.mock('../../context', () => ({ useSettings: () => ({ settings: {} }) }));
vi.mock('../subtitle/SubtitleContainer', () => ({ SubtitleContainer: () => null }));
vi.mock('../subtitle/LiveWordTranslator', () => ({ LiveWordTranslator: () => null }));
vi.mock('./VideoControls', () => ({ VideoControls: () => null }));

it('lets a canvas click give the video keyboard ownership for Space', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => <VideoPlayer subtitles={{
    tokens: () => [],
    isTokenizing: () => false,
    observationReady: () => false,
    currentSubtitle: () => null,
    updateTime: async () => {},
  } as never} />, container);
  const video = container.querySelector('video')!;
  const play = vi.fn().mockResolvedValue(undefined);
  video.play = play;

  video.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(document.activeElement).toBe(video);
  video.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  expect(play).toHaveBeenCalledOnce();

  dispose();
  container.remove();
});

it('reports final owned playback position before releasing the departing media element', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const onBeforeDetach = vi.fn();
  const dispose = render(() => <VideoPlayer subtitles={{
    tokens: () => [], isTokenizing: () => false, observationReady: () => false,
    currentSubtitle: () => null, updateTime: async () => {},
  } as never} onBeforeDetach={onBeforeDetach} />, container);
  const video = container.querySelector('video')!;
  video.pause = vi.fn();
  video.load = vi.fn();
  Object.defineProperty(video, 'currentTime', { value: 26, configurable: true });
  Object.defineProperty(video, 'duration', { value: 223, configurable: true });
  dispose();
  expect(onBeforeDetach).toHaveBeenCalledWith({ currentTime: 26, duration: 223 });
  expect(video.pause).toHaveBeenCalled();
  expect(video.hasAttribute('src')).toBe(false);
  container.remove();
});

it('shows the media surface only after a decoded frame is available', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => <VideoPlayer subtitles={{
    tokens: () => [], isTokenizing: () => false, observationReady: () => false,
    currentSubtitle: () => null, updateTime: async () => {},
  } as never} />, container);
  const video = container.querySelector('video')!;
  expect(video.classList.contains('video-element-loading')).toBe(true);
  video.dispatchEvent(new Event('loadeddata'));
  expect(video.classList.contains('video-element-loading')).toBe(false);
  dispose();
  container.remove();
});
