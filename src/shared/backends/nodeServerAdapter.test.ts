import type { Settings } from '../types';
import type { FlashcardStore } from '../types';
import { HttpNodeServerAdapter, getNodeServer, resetNodeServer } from './nodeServerAdapter';

const DEFAULT_URL = 'http://127.0.0.1:7753';

function makeOkResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(null),
  } as unknown as Response;
}

const mockSettings: Settings = {
  known_ease_threshold: 0.8,
  blur_words: false,
  blur_known_subtitles: false,
  blur_amount: 5,
  colour_known: '#00ff00',
  do_colour_known: true,
  do_colour_codes: false,
  colour_codes: {} as Settings['colour_codes'],
  theme: 'dark' as Settings['theme'],
  language: 'ja',
  hover_known_get_from_dictionary: true,
  show_pos: false,
  furigana: true,
  showPitchAccent: false,
  use_anki: false,
  flashcardSkipAnkiChoice: false,
  anki_field_expression: '',
  anki_field_reading: '',
  anki_field_meaning: '',
  anki_model_name: '',
  ankiConnectUrl: '',
  ankiTemplateExpression: '',
  ankiTemplateReading: '',
  ankiTemplateMeaning: '',
  enable_flashcard_creation: true,
  automaticFlashcardCreation: false,
  flashcard_deck: null,
  flashcards_add_picture: false,
  maxNewCardsPerDay: 20,
} as unknown as Settings;

const mockStore: FlashcardStore = {
  flashcards: {},
  wordCandidates: {},
  wordToCardMap: {},
  wordStatsMap: {},
  knownUntracked: {},
  ignoredWords: {},
  wordKnowledge: {},
  grammarKnowledge: {},
  meta: {} as FlashcardStore['meta'],
  dailyStats: {},
  version: 4,
};

describe('HttpNodeServerAdapter', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    resetNodeServer();
  });

  describe('constructor', () => {
    it('strips trailing slash from baseUrl', () => {
      const adapter = new HttpNodeServerAdapter('http://192.168.1.10:7753/');
      expect(adapter.getBaseUrl()).toBe('http://192.168.1.10:7753');
    });

    it('strips multiple trailing slashes from baseUrl', () => {
      const adapter = new HttpNodeServerAdapter('http://192.168.1.10:7753///');
      expect(adapter.getBaseUrl()).toBe('http://192.168.1.10:7753');
    });

    it('leaves url without trailing slash unchanged', () => {
      const adapter = new HttpNodeServerAdapter('http://192.168.1.10:7753');
      expect(adapter.getBaseUrl()).toBe('http://192.168.1.10:7753');
    });
  });

  describe('getBaseUrl()', () => {
    it('returns the stored base url', () => {
      const adapter = new HttpNodeServerAdapter('http://10.0.0.1:7753');
      expect(adapter.getBaseUrl()).toBe('http://10.0.0.1:7753');
    });
  });

  describe('getSettings()', () => {
    it('GETs /api/settings and returns parsed Settings', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(mockSettings));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      const result = await adapter.getSettings();

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/settings`);
      expect(result).toEqual(mockSettings);
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await expect(adapter.getSettings()).rejects.toThrow('Failed to get settings: 500');
    });
  });

  describe('saveSettings(settings)', () => {
    it('POSTs /api/settings with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(null));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await adapter.saveSettings(mockSettings);

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockSettings),
      });
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(400));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await expect(adapter.saveSettings(mockSettings)).rejects.toThrow('Failed to save settings: 400');
    });
  });

  describe('getFlashcards()', () => {
    it('GETs /api/flashcards and returns FlashcardStore', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(mockStore));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      const result = await adapter.getFlashcards();

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/flashcards`);
      expect(result).toEqual(mockStore);
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(503));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await expect(adapter.getFlashcards()).rejects.toThrow('Failed to get flashcards: 503');
    });
  });

  describe('saveFlashcards(store)', () => {
    it('POSTs /api/flashcards with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(null));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await adapter.saveFlashcards(mockStore);

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/flashcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockStore),
      });
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(404));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await expect(adapter.saveFlashcards(mockStore)).rejects.toThrow('Failed to save flashcards: 404');
    });
  });

  describe('getLocalization(lang)', () => {
    it('GETs /api/localization/{lang} with URL-encoded lang', async () => {
      const locData = { hello: 'こんにちは' };
      mockFetch.mockResolvedValueOnce(makeOkResponse(locData));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      const result = await adapter.getLocalization('ja');

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/localization/ja`);
      expect(result).toEqual(locData);
    });

    it('URL-encodes lang parameter with special characters', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({}));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await adapter.getLocalization('zh-TW');

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/localization/zh-TW`);
    });

    it('URL-encodes lang with spaces', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({}));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await adapter.getLocalization('lang name');

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/localization/lang%20name`);
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(404));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await expect(adapter.getLocalization('en')).rejects.toThrow('Failed to get localization: 404');
    });
  });

  describe('getLangData(lang?)', () => {
    it('GETs /api/lang-data/{lang} when lang is provided', async () => {
      const langData = { features: ['furigana'] };
      mockFetch.mockResolvedValueOnce(makeOkResponse(langData));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      const result = await adapter.getLangData('ja');

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/lang-data/ja`);
      expect(result).toEqual(langData);
    });

    it('GETs /api/lang-data when lang is omitted', async () => {
      const langData = { default: true };
      mockFetch.mockResolvedValueOnce(makeOkResponse(langData));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      const result = await adapter.getLangData();

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/lang-data`);
      expect(result).toEqual(langData);
    });

    it('URL-encodes lang parameter with special characters', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({}));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await adapter.getLangData('zh-TW');

      expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_URL}/api/lang-data/zh-TW`);
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      await expect(adapter.getLangData('en')).rejects.toThrow('Failed to get lang data: 500');
    });
  });

  describe('ping()', () => {
    it('returns true when /api/ping responds ok', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse(null));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      const result = await adapter.ping();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${DEFAULT_URL}/api/ping`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns false when /api/ping responds not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(503));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      const result = await adapter.ping();

      expect(result).toBe(false);
    });

    it('returns false when fetch throws (network error)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      const result = await adapter.ping();

      expect(result).toBe(false);
    });

    it('returns false when fetch throws AbortError (timeout)', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);
      const adapter = new HttpNodeServerAdapter(DEFAULT_URL);

      const result = await adapter.ping();

      expect(result).toBe(false);
    });
  });
});

describe('getNodeServer()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    resetNodeServer();
  });

  it('returns an instance using the default URL when no arg provided', () => {
    const server = getNodeServer();
    expect((server as HttpNodeServerAdapter).getBaseUrl()).toBe(DEFAULT_URL);
  });

  it('returns an instance using the provided URL', () => {
    const server = getNodeServer('http://192.168.1.5:7753');
    expect((server as HttpNodeServerAdapter).getBaseUrl()).toBe('http://192.168.1.5:7753');
  });

  it('returns the same cached instance for the same URL', () => {
    const first = getNodeServer(DEFAULT_URL);
    const second = getNodeServer(DEFAULT_URL);
    expect(first).toBe(second);
  });

  it('returns the same cached instance for the default URL called twice without args', () => {
    const first = getNodeServer();
    const second = getNodeServer();
    expect(first).toBe(second);
  });

  it('returns a new instance for a different URL', () => {
    const first = getNodeServer('http://192.168.1.1:7753');
    const second = getNodeServer('http://192.168.1.2:7753');
    expect(first).not.toBe(second);
  });
});

describe('resetNodeServer()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('clears the cache so getNodeServer returns a new instance', () => {
    const before = getNodeServer();
    resetNodeServer();
    const after = getNodeServer();
    expect(before).not.toBe(after);
  });

  it('can be called multiple times without throwing', () => {
    expect(() => {
      resetNodeServer();
      resetNodeServer();
    }).not.toThrow();
  });
});
