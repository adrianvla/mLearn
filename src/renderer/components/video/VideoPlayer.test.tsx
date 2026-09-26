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
