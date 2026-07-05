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
      displayName: 'lesson',
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
      displayName: 'final',
      filePath: '/final.mkv',
    });
    expect(result.subtitle).toEqual({
      content: 'final',
      filePath: '/final.ass',
    });
  });

  it('extracts a clean display name from complex release filenames', async () => {
    const video = new File(['video-bytes'], 'The.Queens.Classroom.S01E01.1080p.NF.WEB-DL.DDP2.0.x264-HBO.mkv', {
      type: 'video/x-matroska',
    });

    const result = await collectDroppedMediaFiles([video], (file) => `/videos/${file.name}`);

    expect(result.video).toBeDefined();
    expect(result.video!.fileName).toBe('The.Queens.Classroom.S01E01.1080p.NF.WEB-DL.DDP2.0.x264-HBO.mkv');
    expect(result.video!.displayName).toBe('The Queens Classroom S01E1');
    expect(result.video!.filePath).toBe('/videos/The.Queens.Classroom.S01E01.1080p.NF.WEB-DL.DDP2.0.x264-HBO.mkv');
  });

  it('passes caller language tags into display-name cleanup', async () => {
    const video = new File(['video-bytes'], 'Lesson.S01E01.fa.mp4', { type: 'video/mp4' });

    const result = await collectDroppedMediaFiles(
      [video],
      (file) => `/videos/${file.name}`,
      { languageCodes: ['fa'] },
    );

    expect(result.video?.displayName).toBe('Lesson S01E1');
  });
});
