import { createRoot } from 'solid-js';
import { useFlashcardTts } from './useFlashcardTts';
import type { LanguageData } from '../../shared/types';

const mockGetFlashcardTts = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
const mockGetFlashcardTtsMeta = vi.fn().mockResolvedValue(null);
const mockTtsSpeak = vi.fn();
const mockShowToast = vi.fn();
const mockStripReadingAnnotations = vi.fn((text: string) =>
  text.replace(/<rt[^>]*>.*?<\/rt>/gi, '').replace(/<\/?ruby>/gi, '').trim(),
);
const mockJapaneseLanguage: LanguageData = {
  name: 'Japanese',
  colour_codes: {},
  settings: { fixed: {} },
    runtime: {
    tts: {
      webSpeechLang: 'ja-JP',
      webSpeechVoice: 'Kyoko',
    },
  },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
    lexemeNormalization: {
      type: 'surface-reading',
      surfaceScripts: ['Han'],
      readingScripts: ['Hira', 'Kana'],
    },
  },
};
const mockLatinLanguage: LanguageData = {
  name: 'Latin Language',
  colour_codes: {},
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Latn'] },
    lexemeNormalization: {
      type: 'identity',
    },
    readingAnnotation: {
      type: 'none',
      stripParentheticalReadings: false,
    },
  },
};
let mockCurrentLanguageData: LanguageData | null = mockJapaneseLanguage;

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    flashcards: {
      getFlashcardTts: (...args: unknown[]) => mockGetFlashcardTts(...args),
      getFlashcardTtsMeta: (...args: unknown[]) => mockGetFlashcardTtsMeta(...args),
    },
    speech: {
      ttsSpeak: (...args: unknown[]) => mockTtsSpeak(...args),
    },
  }),
}));

vi.mock('../../shared/platform', () => ({
  isElectron: vi.fn(() => true),
  isCapacitor: vi.fn(() => false),
  isDesktop: vi.fn(() => true),
  isMobile: vi.fn(() => false),
  getPlatform: vi.fn(() => 'electron'),
}));

vi.mock('../context', () => ({
  useLocalization: vi.fn(() => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
  })),
  useLanguage: vi.fn(() => ({
    langData: {
      ja: mockJapaneseLanguage,
      en: mockLatinLanguage,
    },
    currentLangData: () => mockCurrentLanguageData,
  })),
  useSettings: vi.fn(() => ({
    settings: {
      language: 'ja',
    },
  })),
}));

vi.mock('../components/common/Feedback/Toast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock('../../shared/utils/textUtils', () => ({
  stripReadingAnnotations: (...args: unknown[]) => mockStripReadingAnnotations(...args),
}));

interface MockAudio {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

let audioInstances: MockAudio[];

function setupAudioMock() {
  audioInstances = [];
  vi.stubGlobal(
    'Audio',
    function MockAudioCtor(this: MockAudio) {
      this.play = vi.fn().mockResolvedValue(undefined);
      this.pause = vi.fn();
      this.onended = null;
      this.onerror = null;
      audioInstances.push(this);
    },
  );
}

async function flush(ticks = 5) {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

describe('useFlashcardTts', () => {
  beforeEach(async () => {
    setupAudioMock();
    mockCurrentLanguageData = mockJapaneseLanguage;
    mockStripReadingAnnotations.mockImplementation((text: string) =>
      text.replace(/<rt[^>]*>.*?<\/rt>/gi, '').replace(/<\/?ruby>/gi, '').trim(),
    );
    const platform = await import('../../shared/platform');
    vi.mocked(platform.isElectron).mockReturnValue(true);
  });

  it('initial state is not playing and not generating', () => {
    createRoot((dispose) => {
      const hook = useFlashcardTts();
      expect(hook.isPlaying()).toBe(false);
      expect(hook.isGenerating()).toBe(false);
      expect(hook.playingField()).toBeNull();
      expect(hook.metadata()).toBeNull();
      dispose();
    });
  });

  it('state signal returns full object', () => {
    createRoot((dispose) => {
      const hook = useFlashcardTts();
      expect(hook.state()).toEqual({
        isPlaying: false,
        isGenerating: false,
        playingField: null,
      });
      dispose();
    });
  });

  it('playTts skips empty text', async () => {
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });
    await hook.playTts('card1', '', 'ja', 'word');
    expect(mockGetFlashcardTts).not.toHaveBeenCalled();
    dispose();
  });

  it('playTts skips dash-only text', async () => {
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });
    await hook.playTts('card1', '-', 'ja', 'word');
    expect(mockGetFlashcardTts).not.toHaveBeenCalled();
    dispose();
  });

  it('playTts skips text that becomes whitespace after strip', async () => {
    mockStripReadingAnnotations.mockReturnValueOnce('   ');
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });
    await hook.playTts('card1', '<ruby><rt>x</rt></ruby>', 'ja', 'word');
    expect(mockGetFlashcardTts).not.toHaveBeenCalled();
    dispose();
  });

  it('playTts passes the requested language metadata to reading annotation stripping', async () => {
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });
    await hook.playTts('card1', '<ruby>漢字<rt>かんじ</rt></ruby>', 'ja', 'word');
    expect(mockStripReadingAnnotations).toHaveBeenCalledWith('<ruby>漢字<rt>かんじ</rt></ruby>', mockJapaneseLanguage);
    dispose();
  });

  it('playTts uses installed card-language metadata instead of active language metadata', async () => {
    mockCurrentLanguageData = mockJapaneseLanguage;
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    await hook.playTts('card1', 'word(noun)', 'en', 'word');

    expect(mockStripReadingAnnotations).toHaveBeenCalledWith('word(noun)', mockLatinLanguage);
    dispose();
  });

  it('playTts does not fall back to current language metadata when card language metadata is unavailable', async () => {
    mockCurrentLanguageData = mockLatinLanguage;
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });
    await hook.playTts('card1', 'word(noun)', 'xx', 'word');
    expect(mockStripReadingAnnotations).toHaveBeenCalledWith('word(noun)', null);
    dispose();
  });

  it('playTts plays existing audio on electron', async () => {
    mockGetFlashcardTts.mockResolvedValueOnce('flashcard-audio://card1-word.ogg');
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    const promise = hook.playTts('card1', '食べる', 'ja', 'word');
    await flush();
    expect(audioInstances).toHaveLength(1);
    expect(hook.isPlaying()).toBe(true);
    expect(hook.playingField()).toBe('word');

    audioInstances[0].onended!();
    await promise;
    expect(hook.isPlaying()).toBe(false);
    expect(hook.playingField()).toBeNull();
    dispose();
  });

  it('playTts loads metadata in parallel with playback', async () => {
    const meta = { provider: 'kokoro', generatedAt: '2025-01-01', language: 'ja' };
    mockGetFlashcardTts.mockResolvedValueOnce('flashcard-audio://card1-word.ogg');
    mockGetFlashcardTtsMeta.mockResolvedValueOnce(meta);

    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    const promise = hook.playTts('card1', '食べる', 'ja', 'word');
    await flush();
    await vi.waitFor(() => {
      expect(hook.metadata()).toEqual(meta);
    });
    audioInstances[0].onended!();
    await promise;
    dispose();
  });

  it('playTts shows warning toast when no saved audio on electron', async () => {
    mockGetFlashcardTts.mockResolvedValueOnce(null);
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    await hook.playTts('card1', '食べる', 'ja', 'word');
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'warning' }),
    );
    expect(hook.isPlaying()).toBe(false);
    dispose();
  });

  it('playTts toast includes correct field label for word field', async () => {
    mockGetFlashcardTts.mockResolvedValueOnce(null);
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    await hook.playTts('card1', '食べる', 'ja', 'word');
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('WordTts'),
      }),
    );
    dispose();
  });

  it('playTts toast includes correct field label for example field', async () => {
    mockGetFlashcardTts.mockResolvedValueOnce(null);
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    await hook.playTts('card1', 'example text', 'ja', 'example');
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('ExampleTts'),
      }),
    );
    dispose();
  });

  it('playTts falls back to system TTS on non-electron', async () => {
    const platform = await import('../../shared/platform');
    vi.mocked(platform.isElectron).mockReturnValue(false);

    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    await hook.playTts('card1', '食べる', 'ja', 'word');
    expect(mockTtsSpeak).toHaveBeenCalledWith('食べる', 'ja', {
      speechSynthesisLang: 'ja-JP',
      speechSynthesisVoice: 'Kyoko',
    });
    expect(mockGetFlashcardTts).not.toHaveBeenCalled();
    dispose();
  });

  it('stop pauses current audio and resets state', async () => {
    mockGetFlashcardTts.mockResolvedValueOnce('flashcard-audio://card1-word.ogg');
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    hook.playTts('card1', '食べる', 'ja', 'word');
    await vi.waitFor(() => expect(audioInstances).toHaveLength(1));
    expect(hook.isPlaying()).toBe(true);

    hook.stop();
    expect(audioInstances[0].pause).toHaveBeenCalled();
    expect(audioInstances[0].onended).toBeNull();
    expect(audioInstances[0].onerror).toBeNull();
    expect(hook.isPlaying()).toBe(false);
    expect(hook.playingField()).toBeNull();
    dispose();
  });

  it('playTts stops previous audio before starting new playback', async () => {
    mockGetFlashcardTts.mockResolvedValue('flashcard-audio://card-word.ogg');
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    hook.playTts('card1', '食べる', 'ja', 'word');
    await vi.waitFor(() => expect(audioInstances).toHaveLength(1));
    const first = audioInstances[0];

    hook.playTts('card2', '読む', 'ja', 'word');
    await vi.waitFor(() => expect(audioInstances.length).toBeGreaterThanOrEqual(2));
    expect(first.pause).toHaveBeenCalled();

    audioInstances.forEach((a) => a.onended?.());
    dispose();
  });

  it('audio onerror resets playing state', async () => {
    mockGetFlashcardTts.mockResolvedValueOnce('flashcard-audio://card1-word.ogg');
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    const promise = hook.playTts('card1', '食べる', 'ja', 'word');
    await vi.waitFor(() => expect(audioInstances).toHaveLength(1));
    audioInstances[0].onerror!();
    await promise.catch(() => {});

    expect(hook.isPlaying()).toBe(false);
    expect(hook.playingField()).toBeNull();
    dispose();
  });

  it('audio.play() rejection resets state via outer catch', async () => {
    mockGetFlashcardTts.mockResolvedValueOnce('flashcard-audio://card1-word.ogg');
    setupAudioMock();
    vi.stubGlobal(
      'Audio',
      function FailAudio(this: MockAudio) {
        this.play = vi.fn().mockRejectedValue(new Error('autoplay blocked'));
        this.pause = vi.fn();
        this.onended = null;
        this.onerror = null;
        audioInstances.push(this);
      },
    );

    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    await hook.playTts('card1', '食べる', 'ja', 'word');
    expect(hook.isPlaying()).toBe(false);
    dispose();
  });

  it('bridge.getFlashcardTts rejection resets state', async () => {
    mockGetFlashcardTts.mockReset();
    mockGetFlashcardTts.mockRejectedValue(new Error('bridge error'));
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    await hook.playTts('card1', '食べる', 'ja', 'word');
    expect(hook.isPlaying()).toBe(false);
    expect(hook.isGenerating()).toBe(false);
    expect(hook.playingField()).toBeNull();
    dispose();
  });

  it('stale generation after stop creates no Audio instance', async () => {
    let resolveTts!: (v: string | null) => void;
    mockGetFlashcardTts.mockReset();
    mockGetFlashcardTts.mockImplementation(
      () => new Promise<string | null>((r) => { resolveTts = r; }),
    );

    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    const promise = hook.playTts('card1', '食べる', 'ja', 'word');
    await vi.waitFor(() => expect(mockGetFlashcardTts).toHaveBeenCalled());
    hook.stop();
    resolveTts('flashcard-audio://card1-word.ogg');
    await promise;

    expect(audioInstances).toHaveLength(0);
    expect(hook.isPlaying()).toBe(false);
    dispose();
  });

  it('playTts sets playingField before async bridge call', () => {
    mockGetFlashcardTts.mockImplementation(
      () => new Promise<string | null>(() => {}),
    );

    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    hook.playTts('card1', '食べる', 'ja', 'example');
    expect(hook.playingField()).toBe('example');
    dispose();
  });

  it('cleanup stops any playing audio', async () => {
    mockGetFlashcardTts.mockResolvedValueOnce('flashcard-audio://card1-word.ogg');
    let hook!: ReturnType<typeof useFlashcardTts>;
    let disposeFn!: () => void;
    createRoot((d) => {
      disposeFn = d;
      hook = useFlashcardTts();
    });

    hook.playTts('card1', '食べる', 'ja', 'word');
    await vi.waitFor(() => expect(audioInstances).toHaveLength(1));

    disposeFn();
    expect(audioInstances[0].pause).toHaveBeenCalled();
  });

  it('playTts for example field sets correct playingField', async () => {
    mockGetFlashcardTts.mockResolvedValueOnce('flashcard-audio://c-example.ogg');
    let hook!: ReturnType<typeof useFlashcardTts>;
    const dispose = createRoot((d) => {
      hook = useFlashcardTts();
      return d;
    });

    hook.playTts('c', 'some sentence', 'ja', 'example');
    await vi.waitFor(() => expect(audioInstances).toHaveLength(1));
    expect(hook.playingField()).toBe('example');
    audioInstances[0].onended!();
    dispose();
  });
});
