// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startCloudDesktopLogin,
  exchangeCloudDesktopCode,
  refreshCloudSession,
  validateCloudAccessToken,
  validateAndRefreshCloudSession,
} from './cloudAuthService';
import type { Settings } from '../../shared/types';
import { DEFAULT_CLOUD_API_URL } from '../../shared/backends';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    known_ease_threshold: 2000,
    blur_words: false,
    blur_known_subtitles: false,
    blur_amount: 5,
    colour_known: '#cceec9',
    do_colour_known: true,
    do_colour_codes: true,
    colour_codes: {},
    theme: 'light',
    customColors: {},
    hover_known_get_from_dictionary: false,
    show_pos: true,
    language: 'ja',
    use_anki: false,
    flashcardSkipAnkiChoice: false,
    furigana: true,
    enable_flashcard_creation: true,
    automaticFlashcardCreation: false,
    flashcard_deck: null,
    flashcards_add_picture: true,
    getCardUrl: 'http://127.0.0.1:7752/getCard',
    tokeniserUrl: 'http://127.0.0.1:7752/tokenize',
    getTranslationUrl: 'http://127.0.0.1:7752/translate',
    ankiUrl: 'http://127.0.0.1:7753/api/fwd-to-anki',
    ankiConnectUrl: 'http://127.0.0.1:8765',
    backendMode: 'local',
    backendUrl: '',
    cloudAuthToken: '',
    cloudAuthAccessToken: '',
    cloudAuthRefreshToken: '',
    cloudAuthUserId: '',
    cloudAuthUserEmail: '',
    cloudAuthExpiresAt: 0,
    cloudAuthStatus: 'signed-out',
    nodeServerUrl: 'http://127.0.0.1:7753',
    overrideCloudEndpointUrl: false,
    cloudLoginUrl: '',
    cloudApiUrl: '',
    lastModified: 0,
    openAside: true,
    llmEnabled: true,
    ocrEnabled: true,
    subsOffsetTime: 0,
    immediateFetch: false,
    subtitleTheme: 'shadow',
    subtitle_font_size: 40,
    subtitle_font_weight: 400,
    showPitchAccent: true,
    timeWatched: 0,
    passiveEaseEnabled: false,
    passiveHoverDelayMs: 1000,
    llmProvider: 'builtin',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen3:4b',
    builtinModel: '',
    speechEnabled: false,
    autoSpeak: false,
    sttLanguage: '',
    voiceMode: 'push-to-talk',
    ttsProvider: 'kokoro',
    voiceTtsSpeed: 1.0,
    voiceAutoSendOnSilence: false,
    devMode: false,
    lowBatteryMode: false,
    llmConfigured: false,
    ocr_crop_padding: 0,
    maxNewCardsPerDay: 20,
    proportionOfExamCards: 0,
    preparedExam: 0,
    createUnseenCards: false,
    flashcardLLMExamples: false,
    newDayHour: 4,
    flashcardFlipAnimation: true,
    leechThreshold: 8,
    flashcardMediaType: 'image',
    flashcardVideoMargin: 300,
    anki_field_expression: 'Expression',
    anki_field_reading: 'Reading',
    anki_field_meaning: 'Meaning',
    anki_model_name: 'Basic',
    ankiDeckName: 'mLearn',
    ankiModelName: 'Basic',
    ankiTemplateExpression: '',
    ankiTemplateReading: '',
    ankiTemplateMeaning: '',
    ...overrides,
  } as unknown as Settings;
}

function mockOkJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockErrorJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('startCloudDesktopLogin', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('POSTs to /api/auth/desktop/init with state, codeChallenge, and codeChallengeMethod', async () => {
    mockFetch.mockResolvedValue(mockOkJson({ loginUrl: 'https://mlearn.kikan.net/login?code=abc' }));
    const settings = makeSettings();
    await startCloudDesktopLogin(settings);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_CLOUD_API_URL}/api/auth/desktop/init`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.codeChallengeMethod).toBe('S256');
    expect(typeof body.state).toBe('string');
    expect(body.state.length).toBeGreaterThan(0);
    expect(typeof body.codeChallenge).toBe('string');
    expect(body.codeChallenge.length).toBeGreaterThan(0);
  });

  it('returns state, codeVerifier, and loginUrl on success', async () => {
    const loginUrl = 'https://mlearn.kikan.net/login?code=xyz';
    mockFetch.mockResolvedValue(mockOkJson({ loginUrl }));
    const settings = makeSettings();
    const result = await startCloudDesktopLogin(settings);

    expect(result.loginUrl).toBe(loginUrl);
    expect(typeof result.state).toBe('string');
    expect(result.state.length).toBeGreaterThan(0);
    expect(typeof result.codeVerifier).toBe('string');
    expect(result.codeVerifier.length).toBeGreaterThan(0);
  });

  it('uses custom cloudApiUrl when overrideCloudEndpointUrl is true', async () => {
    const customApi = 'https://custom-api.example.com';
    mockFetch.mockResolvedValue(mockOkJson({ loginUrl: 'https://custom.example.com/login' }));
    const settings = makeSettings({ overrideCloudEndpointUrl: true, cloudApiUrl: customApi });
    await startCloudDesktopLogin(settings);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(customApi);
  });

  it('throws with server error message when response is not ok', async () => {
    mockFetch.mockResolvedValue(mockErrorJson(400, { error: 'Invalid state parameter' }));
    const settings = makeSettings();
    await expect(startCloudDesktopLogin(settings)).rejects.toThrow('Invalid state parameter');
  });

  it('throws with status code when response is not ok and no error field', async () => {
    mockFetch.mockResolvedValue(mockErrorJson(500, {}));
    const settings = makeSettings();
    await expect(startCloudDesktopLogin(settings)).rejects.toThrow('500');
  });

  it('throws when response is ok but loginUrl is missing', async () => {
    mockFetch.mockResolvedValue(mockOkJson({}));
    const settings = makeSettings();
    await expect(startCloudDesktopLogin(settings)).rejects.toThrow();
  });

  it('throws when fetch rejects (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const settings = makeSettings();
    await expect(startCloudDesktopLogin(settings)).rejects.toThrow('Network error');
  });

  it('throws when response body is not valid JSON', async () => {
    mockFetch.mockResolvedValue(new Response('not json', { status: 400 }));
    const settings = makeSettings();
    await expect(startCloudDesktopLogin(settings)).rejects.toThrow('400');
  });

  it('generates different state values on each call', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOkJson({ loginUrl: 'https://example.com/a' }))
      .mockResolvedValueOnce(mockOkJson({ loginUrl: 'https://example.com/b' }));
    const settings = makeSettings();
    const result1 = await startCloudDesktopLogin(settings);
    const result2 = await startCloudDesktopLogin(settings);

    expect(result1.state).not.toBe(result2.state);
  });

  it('generates different codeVerifier values on each call', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOkJson({ loginUrl: 'https://example.com/a' }))
      .mockResolvedValueOnce(mockOkJson({ loginUrl: 'https://example.com/b' }));
    const settings = makeSettings();
    const result1 = await startCloudDesktopLogin(settings);
    const result2 = await startCloudDesktopLogin(settings);

    expect(result1.codeVerifier).not.toBe(result2.codeVerifier);
  });

  it('codeChallenge is URL-safe base64 (no +, /, = characters)', async () => {
    mockFetch.mockResolvedValue(mockOkJson({ loginUrl: 'https://example.com/login' }));
    const settings = makeSettings();
    await startCloudDesktopLogin(settings);

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.codeChallenge).not.toMatch(/[+/=]/);
  });
});

describe('exchangeCloudDesktopCode', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('POSTs code and codeVerifier to /api/auth/desktop/exchange', async () => {
    mockFetch.mockResolvedValue(mockOkJson({
      session: { accessToken: 'access', refreshToken: 'refresh' },
      user: { id: 'user-123', email: 'user@example.com' },
    }));
    const settings = makeSettings();
    await exchangeCloudDesktopCode(settings, 'mycode', 'myverifier');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_CLOUD_API_URL}/api/auth/desktop/exchange`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.code).toBe('mycode');
    expect(body.codeVerifier).toBe('myverifier');
  });

  it('returns accessToken, refreshToken, userId, and userEmail on success', async () => {
    mockFetch.mockResolvedValue(mockOkJson({
      session: { accessToken: 'at-123', refreshToken: 'rt-456' },
      user: { id: 'uid-789', email: 'test@test.com' },
    }));
    const settings = makeSettings();
    const result = await exchangeCloudDesktopCode(settings, 'code', 'verifier');

    expect(result.accessToken).toBe('at-123');
    expect(result.refreshToken).toBe('rt-456');
    expect(result.userId).toBe('uid-789');
    expect(result.userEmail).toBe('test@test.com');
  });

  it('returns empty string for userEmail when email is null', async () => {
    mockFetch.mockResolvedValue(mockOkJson({
      session: { accessToken: 'at', refreshToken: 'rt' },
      user: { id: 'uid', email: null },
    }));
    const settings = makeSettings();
    const result = await exchangeCloudDesktopCode(settings, 'code', 'verifier');

    expect(result.userEmail).toBe('');
  });

  it('throws with server error message when response is not ok', async () => {
    mockFetch.mockResolvedValue(mockErrorJson(401, { error: 'Code expired' }));
    const settings = makeSettings();
    await expect(exchangeCloudDesktopCode(settings, 'bad-code', 'verifier')).rejects.toThrow('Code expired');
  });

  it('throws with status code when error field is absent', async () => {
    mockFetch.mockResolvedValue(mockErrorJson(500, {}));
    const settings = makeSettings();
    await expect(exchangeCloudDesktopCode(settings, 'code', 'v')).rejects.toThrow('500');
  });

  it('throws when session is missing from successful response', async () => {
    mockFetch.mockResolvedValue(mockOkJson({ user: { id: 'uid' } }));
    const settings = makeSettings();
    await expect(exchangeCloudDesktopCode(settings, 'code', 'v')).rejects.toThrow();
  });

  it('throws when accessToken is missing from session', async () => {
    mockFetch.mockResolvedValue(mockOkJson({
      session: { refreshToken: 'rt' },
      user: { id: 'uid' },
    }));
    const settings = makeSettings();
    await expect(exchangeCloudDesktopCode(settings, 'code', 'v')).rejects.toThrow();
  });

  it('throws when user.id is missing', async () => {
    mockFetch.mockResolvedValue(mockOkJson({
      session: { accessToken: 'at', refreshToken: 'rt' },
      user: {},
    }));
    const settings = makeSettings();
    await expect(exchangeCloudDesktopCode(settings, 'code', 'v')).rejects.toThrow();
  });

  it('throws on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    const settings = makeSettings();
    await expect(exchangeCloudDesktopCode(settings, 'code', 'v')).rejects.toThrow('Connection refused');
  });
});

describe('refreshCloudSession', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('throws immediately when cloudAuthRefreshToken is empty', async () => {
    const settings = makeSettings({ cloudAuthRefreshToken: '' });
    await expect(refreshCloudSession(settings)).rejects.toThrow('Missing cloud refresh token');
  });

  it('POSTs refreshToken to /api/auth/refresh', async () => {
    mockFetch.mockResolvedValue(mockOkJson({
      session: { accessToken: 'new-at', refreshToken: 'new-rt' },
    }));
    const settings = makeSettings({ cloudAuthRefreshToken: 'old-rt' });
    await refreshCloudSession(settings);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_CLOUD_API_URL}/api/auth/refresh`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.refreshToken).toBe('old-rt');
  });

  it('returns new accessToken and refreshToken on success', async () => {
    mockFetch.mockResolvedValue(mockOkJson({
      session: { accessToken: 'new-at', refreshToken: 'new-rt' },
    }));
    const settings = makeSettings({ cloudAuthRefreshToken: 'rt' });
    const result = await refreshCloudSession(settings);

    expect(result.accessToken).toBe('new-at');
    expect(result.refreshToken).toBe('new-rt');
  });

  it('returns expiresAt when provided by server', async () => {
    mockFetch.mockResolvedValue(mockOkJson({
      session: { accessToken: 'at', refreshToken: 'rt', expiresAt: 9999999 },
    }));
    const settings = makeSettings({ cloudAuthRefreshToken: 'rt' });
    const result = await refreshCloudSession(settings);

    expect(result.expiresAt).toBe(9999999);
  });

  it('returns expiresAt as undefined when not provided', async () => {
    mockFetch.mockResolvedValue(mockOkJson({
      session: { accessToken: 'at', refreshToken: 'rt' },
    }));
    const settings = makeSettings({ cloudAuthRefreshToken: 'rt' });
    const result = await refreshCloudSession(settings);

    expect(result.expiresAt).toBeUndefined();
  });

  it('throws with server error message on non-ok response', async () => {
    mockFetch.mockResolvedValue(mockErrorJson(401, { error: 'Refresh token expired' }));
    const settings = makeSettings({ cloudAuthRefreshToken: 'rt' });
    await expect(refreshCloudSession(settings)).rejects.toThrow('Refresh token expired');
  });

  it('throws with status code when no error message', async () => {
    mockFetch.mockResolvedValue(mockErrorJson(500, {}));
    const settings = makeSettings({ cloudAuthRefreshToken: 'rt' });
    await expect(refreshCloudSession(settings)).rejects.toThrow('500');
  });

  it('throws when session is missing from response', async () => {
    mockFetch.mockResolvedValue(mockOkJson({}));
    const settings = makeSettings({ cloudAuthRefreshToken: 'rt' });
    await expect(refreshCloudSession(settings)).rejects.toThrow();
  });

  it('throws when accessToken is missing from session', async () => {
    mockFetch.mockResolvedValue(mockOkJson({ session: { refreshToken: 'rt' } }));
    const settings = makeSettings({ cloudAuthRefreshToken: 'rt' });
    await expect(refreshCloudSession(settings)).rejects.toThrow();
  });

  it('throws on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));
    const settings = makeSettings({ cloudAuthRefreshToken: 'rt' });
    await expect(refreshCloudSession(settings)).rejects.toThrow('Network failure');
  });
});

describe('validateCloudAccessToken', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns false immediately when both cloudAuthAccessToken and cloudAuthToken are empty', async () => {
    const settings = makeSettings({ cloudAuthAccessToken: '', cloudAuthToken: '' });
    const result = await validateCloudAccessToken(settings);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends GET to /api/auth/me with Bearer token from cloudAuthAccessToken', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
    const settings = makeSettings({ cloudAuthAccessToken: 'my-access-token' });
    await validateCloudAccessToken(settings);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_CLOUD_API_URL}/api/auth/me`);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-access-token');
  });

  it('prefers cloudAuthAccessToken over cloudAuthToken', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
    const settings = makeSettings({ cloudAuthAccessToken: 'access-token', cloudAuthToken: 'legacy-token' });
    await validateCloudAccessToken(settings);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer access-token');
  });

  it('falls back to cloudAuthToken when cloudAuthAccessToken is empty', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
    const settings = makeSettings({ cloudAuthAccessToken: '', cloudAuthToken: 'legacy-token' });
    await validateCloudAccessToken(settings);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer legacy-token');
  });

  it('returns true when server responds with 200', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
    const settings = makeSettings({ cloudAuthAccessToken: 'token' });
    expect(await validateCloudAccessToken(settings)).toBe(true);
  });

  it('returns false when server responds with 401', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const settings = makeSettings({ cloudAuthAccessToken: 'token' });
    expect(await validateCloudAccessToken(settings)).toBe(false);
  });

  it('returns false when server responds with 403', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 403 }));
    const settings = makeSettings({ cloudAuthAccessToken: 'token' });
    expect(await validateCloudAccessToken(settings)).toBe(false);
  });

  it('returns false on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const settings = makeSettings({ cloudAuthAccessToken: 'token' });
    expect(await validateCloudAccessToken(settings)).toBe(false);
  });

  it('returns false on AbortError (timeout)', async () => {
    const abortErr = new Error('Aborted');
    abortErr.name = 'AbortError';
    mockFetch.mockRejectedValue(abortErr);
    const settings = makeSettings({ cloudAuthAccessToken: 'token' });
    expect(await validateCloudAccessToken(settings)).toBe(false);
  });
});

describe('validateAndRefreshCloudSession', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns { status: "valid" } when access token is valid', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
    const settings = makeSettings({ cloudAuthAccessToken: 'valid-token' });
    const result = await validateAndRefreshCloudSession(settings);

    expect(result.status).toBe('valid');
    expect(result.accessToken).toBeUndefined();
  });

  it('returns { status: "expired" } when token invalid and no refresh token', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const settings = makeSettings({ cloudAuthAccessToken: 'bad-token', cloudAuthRefreshToken: '' });
    const result = await validateAndRefreshCloudSession(settings);

    expect(result.status).toBe('expired');
  });

  it('returns { status: "refreshed" } with new tokens after successful refresh', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(mockOkJson({
        session: { accessToken: 'new-at', refreshToken: 'new-rt', expiresAt: 12345 },
      }));
    const settings = makeSettings({ cloudAuthAccessToken: 'expired', cloudAuthRefreshToken: 'rt' });
    const result = await validateAndRefreshCloudSession(settings);

    expect(result.status).toBe('refreshed');
    expect(result.accessToken).toBe('new-at');
    expect(result.refreshToken).toBe('new-rt');
    expect(result.expiresAt).toBe(12345);
  });

  it('returns { status: "expired" } when refresh also fails', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockRejectedValueOnce(new Error('Refresh failed'));
    const settings = makeSettings({ cloudAuthAccessToken: 'bad', cloudAuthRefreshToken: 'rt' });
    const result = await validateAndRefreshCloudSession(settings);

    expect(result.status).toBe('expired');
  });

  it('returns { status: "expired" } when token is empty and no refresh token', async () => {
    const settings = makeSettings({ cloudAuthAccessToken: '', cloudAuthToken: '', cloudAuthRefreshToken: '' });
    const result = await validateAndRefreshCloudSession(settings);

    expect(result.status).toBe('expired');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls refresh API with the stored refresh token', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(mockOkJson({
        session: { accessToken: 'at', refreshToken: 'rt2' },
      }));
    const settings = makeSettings({ cloudAuthAccessToken: 'expired', cloudAuthRefreshToken: 'my-refresh-token' });
    await validateAndRefreshCloudSession(settings);

    const [, refreshInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(refreshInit.body as string);
    expect(body.refreshToken).toBe('my-refresh-token');
  });

  it('returns { status: "expired" } when refresh returns 500 error response', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(mockErrorJson(500, { error: 'Internal server error' }));
    const settings = makeSettings({ cloudAuthAccessToken: 'bad', cloudAuthRefreshToken: 'rt' });
    const result = await validateAndRefreshCloudSession(settings);

    expect(result.status).toBe('expired');
  });
});
