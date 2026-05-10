import { describe, expect, it } from 'vitest';
import {
  parseSRT,
  parseVTT,
  parseASS,
  detectSubtitleFormat,
  parseSubtitles,
  findCurrentSubtitle,
} from './subtitleParser';

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:04,000
First subtitle line

2
00:00:05,000 --> 00:00:07,500
Second subtitle line
with multiple lines

3
00:01:00,000 --> 00:01:05,000
Third subtitle`;

const SAMPLE_VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
First subtitle line

00:00:05.000 --> 00:00:07.500
Second subtitle line`;

const SAMPLE_ASS = `[Script Info]
Title: Test

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,First subtitle line
Dialogue: 0,0:00:05.00,0:00:07.50,Default,,0,0,0,,Second subtitle line`;

describe('subtitleParser', () => {
  describe('parseSRT', () => {
    it('parses basic SRT content', () => {
      const result = parseSRT(SAMPLE_SRT);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        start: 1,
        end: 4,
        text: 'First subtitle line',
      });
      expect(result[1]).toEqual({
        start: 5,
        end: 7.5,
        text: 'Second subtitle line\nwith multiple lines',
      });
      expect(result[2]).toEqual({
        start: 60,
        end: 65,
        text: 'Third subtitle',
      });
    });

    it('returns empty array for empty content', () => {
      expect(parseSRT('')).toHaveLength(0);
    });

    it('handles Windows line endings', () => {
      const windowsSRT = SAMPLE_SRT.replace(/\n/g, '\r\n');
      const result = parseSRT(windowsSRT);
      expect(result).toHaveLength(3);
    });
  });

  describe('parseVTT', () => {
    it('parses basic VTT content', () => {
      const result = parseVTT(SAMPLE_VTT);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        start: 1,
        end: 4,
        text: 'First subtitle line',
      });
      expect(result[1]).toEqual({
        start: 5,
        end: 7.5,
        text: 'Second subtitle line',
      });
    });

    it('handles short MM:SS.mmm format', () => {
      const shortVTT = `WEBVTT

01:00.000 --> 02:30.500
Short format`;
      const result = parseVTT(shortVTT);
      expect(result).toHaveLength(1);
      expect(result[0].start).toBe(60);
      expect(result[0].end).toBe(150.5);
    });

    it('returns empty array for empty content', () => {
      expect(parseVTT('WEBVTT\n\n')).toHaveLength(0);
    });
  });

  describe('parseASS', () => {
    it('parses basic ASS content', () => {
      const result = parseASS(SAMPLE_ASS);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        start: 1,
        end: 4,
        text: 'First subtitle line',
      });
      expect(result[1]).toEqual({
        start: 5,
        end: 7.5,
        text: 'Second subtitle line',
      });
    });

    it('handles Marked field', () => {
      const markedASS = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Marked line`;
      const result = parseASS(markedASS);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Marked line');
    });

    it('strips ASS formatting tags', () => {
      const taggedASS = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\b1}Bold{\\b0} text`;
      const result = parseASS(taggedASS);
      expect(result[0].text).toBe('Bold text');
    });
  });

  describe('detectSubtitleFormat', () => {
    it('detects VTT by WEBVTT header', () => {
      expect(detectSubtitleFormat('WEBVTT\n\n00:00 --> 00:05\nTest')).toBe('vtt');
    });

    it('detects ASS by Script Info header', () => {
      expect(detectSubtitleFormat('[Script Info]\nTitle: Test\n[Events]\n...')).toBe('ass');
    });

    it('defaults to SRT', () => {
      expect(detectSubtitleFormat('1\n00:00:01 --> 00:00:05\nTest')).toBe('srt');
    });
  });

  describe('parseSubtitles', () => {
    it('auto-detects and parses SRT', () => {
      const result = parseSubtitles(SAMPLE_SRT);
      expect(result).toHaveLength(3);
    });

    it('uses explicit format parameter', () => {
      const result = parseSubtitles(SAMPLE_VTT, 'vtt');
      expect(result).toHaveLength(2);
    });
  });

  describe('findCurrentSubtitle', () => {
    const subtitles = [
      { start: 0, end: 5, text: 'First' },
      { start: 5, end: 10, text: 'Second' },
      { start: 10, end: 15, text: 'Third' },
    ];

    it('finds subtitle at given time', () => {
      expect(findCurrentSubtitle(subtitles, 2, 0)).toEqual(subtitles[0]);
      expect(findCurrentSubtitle(subtitles, 7, 0)).toEqual(subtitles[1]);
      expect(findCurrentSubtitle(subtitles, 12, 0)).toEqual(subtitles[2]);
    });

    it('applies offset', () => {
      expect(findCurrentSubtitle(subtitles, 3, -2)).toEqual(subtitles[0]);
      expect(findCurrentSubtitle(subtitles, 7, 2)).toEqual(subtitles[1]);
    });

    it('returns null when no subtitle matches', () => {
      expect(findCurrentSubtitle(subtitles, 20, 0)).toBeNull();
      expect(findCurrentSubtitle(subtitles, -1, 0)).toBeNull();
    });

    it('returns null when time is past subtitle end', () => {
      expect(findCurrentSubtitle(subtitles, 15.1, 0)).toBeNull();
    });
  });
});