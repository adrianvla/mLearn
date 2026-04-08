// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { collectDroppedMediaFiles } from './videoDropUtils';

describe('collectDroppedMediaFiles', () => {
  it('preserves subtitle data when a subtitle is dropped before the video', async () => {
    const subtitle = new File(['1\n00:00:00,000 --> 00:00:01,000\nHello'], 'lesson.en.srt', {
      type: 'text/plain',
    });
    const video = new File(['video-bytes'], 'lesson.mp4', { type: 'video/mp4' });

    const result = await collectDroppedMediaFiles([subtitle, video], (file) => {
      if (file.name === subtitle.name) {
        return '/subs/lesson.en.srt';
      }

      return '/videos/lesson.mp4';
    });

    expect(result.video).toMatchObject({
      fileName: 'lesson.mp4',
      filePath: '/videos/lesson.mp4',
    });
    expect(result.subtitle).toEqual({
      content: '1\n00:00:00,000 --> 00:00:01,000\nHello',
      filePath: '/subs/lesson.en.srt',
    });
  });

  it('ignores unrelated files and keeps the last matching video and subtitle', async () => {
    const oldVideo = new File(['old-video'], 'old.mp4', { type: 'video/mp4' });
    const finalVideo = new File(['final-video'], 'final.mkv', { type: 'video/x-matroska' });
    const firstSubtitle = new File(['first'], 'first.srt', { type: 'text/plain' });
    const finalSubtitle = new File(['final'], 'final.ass', { type: 'text/plain' });
    const image = new File(['image'], 'poster.png', { type: 'image/png' });

    const result = await collectDroppedMediaFiles(
      [oldVideo, firstSubtitle, image, finalVideo, finalSubtitle],
      (file) => `/${file.name}`,
    );

    expect(result.video).toMatchObject({
      fileName: 'final.mkv',
      filePath: '/final.mkv',
    });
    expect(result.subtitle).toEqual({
      content: 'final',
      filePath: '/final.ass',
    });
  });
});