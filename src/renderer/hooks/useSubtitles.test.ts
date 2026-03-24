import { createRoot } from 'solid-js';
import { useSubtitles } from './useSubtitles';

const mockTokenize = vi.fn().mockResolvedValue([]);

vi.mock('../context', () => ({
  useSettings: vi.fn(() => ({
    settings: { language: 'ja', subsOffsetTime: 0 },
  })),
}));

vi.mock('./useTranslation', () => ({
  useTokenizer: vi.fn(() => ({
    tokenize: (...args: unknown[]) => mockTokenize(...args),
  })),
}));

vi.mock('../utils/subtitleParsing', () => ({
  parseSubtitle: vi.fn((text: string) => ({
    text,
    readingOverrides: [],
  })),
}));

const SRT_CONTENT = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:05,000 --> 00:00:08,000
Second subtitle

3
00:00:10,000 --> 00:00:12,000
Third subtitle
`;

const VTT_CONTENT = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello world

00:00:05.000 --> 00:00:08.000
Second subtitle
`;

const VTT_SHORT_FORMAT = `WEBVTT

01:30.000 --> 01:33.000
Short format subtitle
`;

const ASS_CONTENT = `[Script Info]
Title: Test

[V4+ Styles]
Format: Name, Fontname, Fontsize

[Events]
Format: Layer, Start, End, Style, Name, MarginV, MarginR, MarginL, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,Second subtitle
`;

describe('useSubtitles', () => {
  beforeEach(() => {
    mockTokenize.mockResolvedValue([]);
  });

  // ========================================================================
  // Initial state
  // ========================================================================

  it('starts with empty subtitles and no current subtitle', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      expect(hook.subtitles()).toEqual([]);
      expect(hook.currentSubtitle()).toBeNull();
      expect(hook.currentIndex()).toBe(-1);
      expect(hook.tokens()).toEqual([]);
      expect(hook.isTokenizing()).toBe(false);
      dispose();
    });
  });

  it('offset returns settings.subsOffsetTime', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      expect(hook.offset()).toBe(0);
      dispose();
    });
  });

  // ========================================================================
  // loadSubtitles — SRT
  // ========================================================================

  it('loadSubtitles parses SRT content and sets subtitles', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      const subs = hook.subtitles();
      expect(subs.length).toBe(3);
      expect(subs[0].text).toBe('Hello world');
      expect(subs[0].start).toBe(1);
      expect(subs[0].end).toBe(3);
      dispose();
    });
  });

  it('loadSubtitles parses SRT second and third subtitles correctly', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      const subs = hook.subtitles();
      expect(subs[1].text).toBe('Second subtitle');
      expect(subs[1].start).toBe(5);
      expect(subs[1].end).toBe(8);
      expect(subs[2].text).toBe('Third subtitle');
      expect(subs[2].start).toBe(10);
      expect(subs[2].end).toBe(12);
      dispose();
    });
  });

  it('loadSubtitles strips HTML tags from SRT text', () => {
    const srtWithTags = `1
00:00:01,000 --> 00:00:03,000
<i>Hello</i> <b>world</b>
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(srtWithTags, 'srt');
      expect(hook.subtitles()[0].text).toBe('Hello world');
      dispose();
    });
  });

  it('loadSubtitles handles multiline SRT text blocks', () => {
    const multiline = `1
00:00:01,000 --> 00:00:03,000
Line one
Line two
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(multiline, 'srt');
      expect(hook.subtitles().length).toBe(1);
      expect(hook.subtitles()[0].text).toBe('Line one\nLine two');
      dispose();
    });
  });

  // ========================================================================
  // loadSubtitles — VTT
  // ========================================================================

  it('loadSubtitles parses VTT content correctly', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(VTT_CONTENT, 'vtt');
      const subs = hook.subtitles();
      expect(subs.length).toBe(2);
      expect(subs[0].text).toBe('Hello world');
      expect(subs[0].start).toBe(1);
      expect(subs[0].end).toBe(3);
      dispose();
    });
  });

  it('loadSubtitles strips HTML tags from VTT text', () => {
    const vttWithTags = `WEBVTT

00:00:01.000 --> 00:00:03.000
<c>Hello</c> world
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(vttWithTags, 'vtt');
      expect(hook.subtitles()[0].text).toBe('Hello world');
      dispose();
    });
  });

  it('loadSubtitles parses VTT short time format (MM:SS.mmm)', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(VTT_SHORT_FORMAT, 'vtt');
      const subs = hook.subtitles();
      expect(subs.length).toBe(1);
      expect(subs[0].text).toBe('Short format subtitle');
      expect(subs[0].start).toBe(90);
      expect(subs[0].end).toBe(93);
      dispose();
    });
  });

  // ========================================================================
  // loadSubtitles — ASS
  // ========================================================================

  it('loadSubtitles parses ASS content correctly', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(ASS_CONTENT, 'ass');
      const subs = hook.subtitles();
      expect(subs.length).toBe(2);
      expect(subs[0].text).toBe('Hello world');
      expect(subs[1].text).toBe('Second subtitle');
      dispose();
    });
  });

  it('loadSubtitles strips ASS formatting tags and handles newlines', () => {
    const assWithTags = `[Script Info]
Title: Test

[Events]
Format: Layer, Start, End, Style, Name, MarginV, MarginR, MarginL, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\b1}Hello{\\b0}\\Nworld
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(assWithTags, 'ass');
      const subs = hook.subtitles();
      expect(subs.length).toBe(1);
      expect(subs[0].text).toBe('Hello\nworld');
      dispose();
    });
  });

  // ========================================================================
  // loadSubtitles — Auto-detection
  // ========================================================================

  it('auto-detects VTT via WEBVTT header', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(VTT_CONTENT);
      const subs = hook.subtitles();
      expect(subs.length).toBeGreaterThan(0);
      expect(subs[0].text).toBe('Hello world');
      dispose();
    });
  });

  it('auto-detects ASS via [Script Info] header', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(ASS_CONTENT);
      const subs = hook.subtitles();
      expect(subs.length).toBeGreaterThan(0);
      expect(subs[0].text).toBe('Hello world');
      dispose();
    });
  });

  it('auto-detects ASS via [V4+ Styles] header', () => {
    const v4Content = `[V4+ Styles]
Format: Name

[Events]
Format: Layer, Start, End, Style, Name, MarginV, MarginR, MarginL, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,V4 detected
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(v4Content);
      const subs = hook.subtitles();
      expect(subs.length).toBe(1);
      expect(subs[0].text).toBe('V4 detected');
      dispose();
    });
  });

  it('auto-detects SRT when no other markers present', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT);
      expect(hook.subtitles().length).toBe(3);
      dispose();
    });
  });

  // ========================================================================
  // loadSubtitles — Edge cases
  // ========================================================================

  it('loadSubtitles with empty content produces no subtitles', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles('', 'srt');
      expect(hook.subtitles()).toEqual([]);
      dispose();
    });
  });

  it('loadSubtitles with invalid SRT content produces no subtitles', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles('this is not valid subtitle content at all', 'srt');
      expect(hook.subtitles()).toEqual([]);
      dispose();
    });
  });

  it('loadSubtitles resets currentIndex and tokens', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      expect(hook.currentIndex()).toBe(-1);
      expect(hook.tokens()).toEqual([]);
      dispose();
    });
  });

  it('loadSubtitles replaces previously loaded subtitles', () => {
    const srt2 = `1
00:00:01,000 --> 00:00:02,000
New content
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      expect(hook.subtitles().length).toBe(3);

      hook.loadSubtitles(srt2, 'srt');
      expect(hook.subtitles().length).toBe(1);
      expect(hook.subtitles()[0].text).toBe('New content');
      dispose();
    });
  });

  it('SRT blocks with fewer than 3 lines are skipped', () => {
    const incomplete = `1
00:00:01,000 --> 00:00:03,000

2
00:00:05,000 --> 00:00:08,000
Valid line
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(incomplete, 'srt');
      expect(hook.subtitles().length).toBe(1);
      expect(hook.subtitles()[0].text).toBe('Valid line');
      dispose();
    });
  });

  // ========================================================================
  // updateTime — subtitle matching via binary search
  // ========================================================================

  it('updateTime with no subtitles sets currentIndex to -1 and clears tokens', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      await hook.updateTime(5.0);
      expect(hook.currentIndex()).toBe(-1);
      expect(hook.tokens()).toEqual([]);
      dispose();
    });
  });

  it('updateTime with matching subtitle updates currentIndex', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(2.0);
      expect(hook.currentIndex()).toBe(0);
      dispose();
    });
  });

  it('updateTime at exact start time matches subtitle', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(1.0);
      expect(hook.currentIndex()).toBe(0);
      dispose();
    });
  });

  it('updateTime at exact end time matches subtitle', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(3.0);
      expect(hook.currentIndex()).toBe(0);
      dispose();
    });
  });

  it('updateTime with non-matching time resets currentIndex to -1', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(2.0);
      expect(hook.currentIndex()).toBe(0);

      await hook.updateTime(4.0);
      expect(hook.currentIndex()).toBe(-1);
      dispose();
    });
  });

  it('updateTime before all subtitles sets index to -1', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(0.5);
      expect(hook.currentIndex()).toBe(-1);
      dispose();
    });
  });

  it('updateTime after all subtitles sets index to -1', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(20.0);
      expect(hook.currentIndex()).toBe(-1);
      dispose();
    });
  });

  it('updateTime matches second subtitle correctly', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(6.0);
      expect(hook.currentIndex()).toBe(1);
      dispose();
    });
  });

  it('updateTime matches third subtitle correctly', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(11.0);
      expect(hook.currentIndex()).toBe(2);
      dispose();
    });
  });

  it('updateTime skips tokenization when same subtitle is already current', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(2.0);
      expect(hook.currentIndex()).toBe(0);
      mockTokenize.mockClear();

      await hook.updateTime(2.5);
      expect(hook.currentIndex()).toBe(0);
      expect(mockTokenize).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('updateTime just past end time returns no match', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(3.001);
      expect(hook.currentIndex()).toBe(-1);
      dispose();
    });
  });

  // ========================================================================
  // updateTime — offset behavior
  // ========================================================================

  it('updateTime accounts for positive offset', async () => {
    const { useSettings } = await import('../context');
    vi.mocked(useSettings).mockReturnValueOnce({
      settings: { language: 'ja', subsOffsetTime: 1 },
    } as never);

    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(0.5);
      expect(hook.currentIndex()).toBe(0);
      dispose();
    });
  });

  it('updateTime accounts for negative offset', async () => {
    const { useSettings } = await import('../context');
    vi.mocked(useSettings).mockReturnValueOnce({
      settings: { language: 'ja', subsOffsetTime: -2 },
    } as never);

    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(3.0);
      expect(hook.currentIndex()).toBe(0);
      dispose();
    });
  });

  it('updateTime calls tokenize with subtitle text', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(2.0);
      expect(mockTokenize).toHaveBeenCalledWith('Hello world');
      dispose();
    });
  });

  it('updateTime uses fallback tokens when tokenize returns empty', async () => {
    mockTokenize.mockResolvedValue([]);
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(2.0);
      const tokens = hook.tokens();
      expect(tokens.length).toBe(2);
      expect(tokens[0].word).toBe('Hello');
      expect(tokens[1].word).toBe('world');
      dispose();
    });
  });

  it('updateTime uses real tokens when tokenize returns results', async () => {
    const fakeTokens = [
      { word: 'Hello', actual_word: 'Hello', type: 'noun', surface: 'Hello' },
      { word: 'world', actual_word: 'world', type: 'noun', surface: 'world' },
    ];
    mockTokenize.mockResolvedValue(fakeTokens);

    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(2.0);
      expect(hook.tokens()).toEqual(fakeTokens);
      dispose();
    });
  });

  it('updateTime uses fallback tokens when tokenize throws', async () => {
    mockTokenize.mockRejectedValue(new Error('tokenize failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(2.0);
      const tokens = hook.tokens();
      expect(tokens.length).toBe(2);
      expect(tokens[0].word).toBe('Hello');
      dispose();
    });

    consoleSpy.mockRestore();
  });

  it('updateTime sets isTokenizing during tokenization', async () => {
    let resolveTokenize!: (v: unknown[]) => void;
    mockTokenize.mockReturnValue(new Promise((r) => { resolveTokenize = r; }));

    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      const promise = hook.updateTime(2.0);
      expect(hook.isTokenizing()).toBe(true);

      resolveTokenize([]);
      await promise;
      expect(hook.isTokenizing()).toBe(false);
      dispose();
    });
  });

  it('updateTime clears tokens when moving to gap between subtitles', async () => {
    const fakeTokens = [
      { word: 'Hello', actual_word: 'Hello', type: 'noun', surface: 'Hello' },
    ];
    mockTokenize.mockResolvedValue(fakeTokens);

    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(2.0);
      expect(hook.tokens().length).toBeGreaterThan(0);

      await hook.updateTime(4.0);
      expect(hook.tokens()).toEqual([]);
      expect(hook.currentIndex()).toBe(-1);
      dispose();
    });
  });

  // ========================================================================
  // updateTime — reading overrides
  // ========================================================================

  it('updateTime applies reading overrides from parseSubtitle', async () => {
    const { parseSubtitle } = await import('../utils/subtitleParsing');
    vi.mocked(parseSubtitle).mockReturnValue({
      text: 'Hello world',
      readingOverrides: [{ word: 'Hello', reading: 'helo' }],
    });

    const fakeTokens = [
      { word: 'Hello', actual_word: 'Hello', type: 'noun', surface: 'Hello', reading: undefined as string | undefined },
    ];
    mockTokenize.mockResolvedValue(fakeTokens);

    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(2.0);
      expect(hook.tokens()[0].reading).toBe('helo');
      dispose();
    });
  });

  // ========================================================================
  // currentSubtitle memo
  // ========================================================================

  it('currentSubtitle memo returns null when currentIndex is -1', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      expect(hook.currentSubtitle()).toBeNull();
      dispose();
    });
  });

  it('currentSubtitle memo returns subtitle after updateTime', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      await hook.updateTime(6.0);
      const current = hook.currentSubtitle();
      expect(current).not.toBeNull();
      expect(current!.text).toBe('Second subtitle');
      dispose();
    });
  });

  // ========================================================================
  // clearSubtitles
  // ========================================================================

  it('clearSubtitles resets all state', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(SRT_CONTENT, 'srt');
      expect(hook.subtitles().length).toBe(3);

      hook.clearSubtitles();

      expect(hook.subtitles()).toEqual([]);
      expect(hook.currentIndex()).toBe(-1);
      expect(hook.tokens()).toEqual([]);
      expect(hook.currentSubtitle()).toBeNull();
      dispose();
    });
  });

  // ========================================================================
  // loadSubtitleFile
  // ========================================================================

  it('loadSubtitleFile reads file content and uses .srt extension', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      const file = new File([SRT_CONTENT], 'subtitles.srt', { type: 'text/plain' });
      await hook.loadSubtitleFile(file);
      expect(hook.subtitles().length).toBe(3);
      dispose();
    });
  });

  it('loadSubtitleFile with .vtt extension parses as VTT', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      const file = new File([VTT_CONTENT], 'subtitles.vtt', { type: 'text/plain' });
      await hook.loadSubtitleFile(file);
      expect(hook.subtitles().length).toBe(2);
      dispose();
    });
  });

  it('loadSubtitleFile with .ass extension parses as ASS', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      const file = new File([ASS_CONTENT], 'subtitles.ass', { type: 'text/plain' });
      await hook.loadSubtitleFile(file);
      expect(hook.subtitles().length).toBe(2);
      dispose();
    });
  });

  it('loadSubtitleFile with .ssa extension parses as ASS', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      const file = new File([ASS_CONTENT], 'subtitles.ssa', { type: 'text/plain' });
      await hook.loadSubtitleFile(file);
      expect(hook.subtitles().length).toBe(2);
      dispose();
    });
  });

  it('loadSubtitleFile with unknown extension auto-detects format', async () => {
    await createRoot(async (dispose) => {
      const hook = useSubtitles();
      const file = new File([VTT_CONTENT], 'subtitles.txt', { type: 'text/plain' });
      await hook.loadSubtitleFile(file);
      expect(hook.subtitles().length).toBe(2);
      dispose();
    });
  });

  // ========================================================================
  // ASS edge cases
  // ========================================================================

  it('ASS parser stops reading events at next section', () => {
    const assWithNextSection = `[Script Info]
Title: Test

[Events]
Format: Layer, Start, End, Style, Name, MarginV, MarginR, MarginL, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,First line

[Fonts]
fontname: Arial
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(assWithNextSection, 'ass');
      expect(hook.subtitles().length).toBe(1);
      expect(hook.subtitles()[0].text).toBe('First line');
      dispose();
    });
  });

  it('ASS parser handles text containing commas', () => {
    const assWithCommas = `[Script Info]
Title: Test

[Events]
Format: Layer, Start, End, Style, Name, MarginV, MarginR, MarginL, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello, world, again
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(assWithCommas, 'ass');
      const subs = hook.subtitles();
      expect(subs.length).toBe(1);
      expect(subs[0].text).toBe('Hello, world, again');
      dispose();
    });
  });

  // ========================================================================
  // SRT time parsing edge cases
  // ========================================================================

  it('SRT parser handles dot separator in timestamps', () => {
    const srtWithDot = `1
00:00:01.500 --> 00:00:03.500
Dot separator
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(srtWithDot, 'srt');
      const subs = hook.subtitles();
      expect(subs.length).toBe(1);
      expect(subs[0].start).toBe(1.5);
      expect(subs[0].end).toBe(3.5);
      dispose();
    });
  });

  it('SRT parser handles hour values in timestamps', () => {
    const srtWithHours = `1
01:30:00,000 --> 01:30:05,000
One hour thirty
`;
    createRoot((dispose) => {
      const hook = useSubtitles();
      hook.loadSubtitles(srtWithHours, 'srt');
      const subs = hook.subtitles();
      expect(subs.length).toBe(1);
      expect(subs[0].start).toBe(5400);
      expect(subs[0].end).toBe(5405);
      dispose();
    });
  });

  // ========================================================================
  // offset accessor
  // ========================================================================

  it('offset accessor reflects settings.subsOffsetTime value', () => {
    createRoot((dispose) => {
      const hook = useSubtitles();
      expect(typeof hook.offset()).toBe('number');
      dispose();
    });
  });
});
