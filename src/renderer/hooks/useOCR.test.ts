import { createRoot } from 'solid-js';
import {
  sendImageForOCR,
  prepareBlobForOCR,
  assertOcrLanguageDataReady,
  getOcrLanguageDataReadinessError,
  MAX_OCR_AREA,
} from './useOCR';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockCreateImageBitmap = vi.fn();
vi.stubGlobal('createImageBitmap', mockCreateImageBitmap);

const mockConvertToBlob = vi.fn();
const mockOffscreenCtx = {
  drawImage: vi.fn(),
};

class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return mockOffscreenCtx;
  }
  convertToBlob(opts?: { type?: string; quality?: number }) {
    return mockConvertToBlob(opts);
  }
}

vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);

const mockBackend = {
  ocr: vi.fn(),
};

const mockCloudRecognize = vi.fn();

vi.mock('../../shared/backends', () => ({
  getBackend: () => mockBackend,
  CloudOCRAdapter: class MockCloudOCRAdapter {
    recognize(...args: unknown[]) { return mockCloudRecognize(...args); }
  },
  resolveCloudApiUrl: () => 'https://cloud.example.com',
}));

let mockIsConnected = vi.fn(() => true);
let mockRequestAccess = vi.fn(() => Promise.resolve(true));
let mockCurrentLangData = vi.fn(() => null);

vi.mock('../context', () => ({
  useServer: () => ({ isConnected: () => mockIsConnected() }),
  useLowPowerGate: () => ({ requestAccess: (...args: unknown[]) => mockRequestAccess(...args) }),
  useLanguage: () => ({ currentLangData: () => mockCurrentLangData() }),
}));

let mockSettings: Record<string, unknown> = {
  ocrProvider: 'local',
  language: 'ja',
  cloudAuthAccessToken: '',
  cloudAuthToken: '',
};

function makeInstalledLanguageData(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Japanese',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: { scriptProfile: { acceptedScripts: ['Han', 'Hira', 'Kana'] } },
    runtime: {
      ocr: {
        recognitionEngine: 'rapidocr',
        rapidLangType: 'JAPAN',
      },
    },
    ...overrides,
  };
}

const mockEnsureCloudAccessToken = vi.fn(async () => {
  const accessToken = typeof mockSettings.cloudAuthAccessToken === 'string'
    ? mockSettings.cloudAuthAccessToken
    : '';
  const legacyToken = typeof mockSettings.cloudAuthToken === 'string'
    ? mockSettings.cloudAuthToken
    : '';

  return accessToken || legacyToken || null;
});

const mockWithCloudAuth = vi.fn(async <T>(op: (token: string) => Promise<T>) => {
  const token = await mockEnsureCloudAccessToken();
  if (!token) {
    throw new Error('Missing cloud authentication token');
  }

  return op(token);
});

vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({
    settings: mockSettings,
  }),
}));

vi.mock('../services/cloudSessionManager', () => ({
  ensureCloudAccessToken: (...args: unknown[]) => mockEnsureCloudAccessToken(...args),
  withCloudAuth: (...args: unknown[]) => mockWithCloudAuth(...args as Parameters<typeof mockWithCloudAuth>),
}));

function makePngBlob(size = 100): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/png' });
}

function makeJpegBlob(size = 100): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

function setupImageBitmapMock(width: number, height: number) {
  mockCreateImageBitmap.mockResolvedValue({ width, height, close: vi.fn() });
}

function setupTranscodeOutput(outputBlob?: Blob) {
  const blob = outputBlob ?? makePngBlob(50);
  mockConvertToBlob.mockResolvedValue(blob);
  return blob;
}

function setupBackendOCRResponse(result: { text: string; boxes?: unknown[] }) {
  mockBackend.ocr.mockResolvedValue(result);
}

function setupBackendOCRError(status: number, errorText: string) {
  mockBackend.ocr.mockRejectedValue(new Error(`OCR request failed: ${status} - ${errorText}`));
}

describe('OCR constants', () => {
  it('MAX_OCR_AREA is 3.84M pixels', () => {
    expect(MAX_OCR_AREA).toBe(1600 * 2400);
  });
});

describe('OCR language data readiness', () => {
  it('reports missing selected language data without throwing from the helper', () => {
    expect(getOcrLanguageDataReadinessError('ja', null)).toBe('Language data is required before running OCR for ja');
    expect(() => assertOcrLanguageDataReady('ja', null)).toThrow('Language data is required before running OCR for ja');
  });

  it('reports stale language data that has no OCR runtime engine', () => {
    expect(getOcrLanguageDataReadinessError('ja', {
      name: 'Unconfigured Japanese metadata',
      colour_codes: {},
      settings: { fixed: {} },
    })).toBe('OCR runtime language data is required for ja');
  });

  it('accepts installed language data with a runtime OCR engine', () => {
    const languageData = makeInstalledLanguageData();

    expect(getOcrLanguageDataReadinessError('ja', languageData)).toBeNull();
    expect(() => assertOcrLanguageDataReady('ja', languageData)).not.toThrow();
  });

  it('accepts installed language data with a custom runtime OCR engine name', () => {
    const languageData = {
      name: 'Future OCR Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          recognitionEngine: 'arabic-transformer-ocr',
        },
      },
    };

    expect(getOcrLanguageDataReadinessError('ar', languageData)).toBeNull();
    expect(() => assertOcrLanguageDataReady('ar', languageData)).not.toThrow();
  });
});

describe('prepareBlobForOCR', () => {
  beforeEach(() => {
    mockCreateImageBitmap.mockReset();
    mockConvertToBlob.mockReset();
    mockOffscreenCtx.drawImage.mockReset();
  });

  it('passes through a small PNG without transcoding', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);

    const result = await prepareBlobForOCR(blob);

    expect(result.blob).toBe(blob);
    expect(result.clientScale).toBe(1);
    expect(result.originalW).toBe(100);
    expect(result.originalH).toBe(100);
    expect(result.sentW).toBe(100);
    expect(result.sentH).toBe(100);
  });

  it('transcodes non-PNG blob to PNG', async () => {
    const jpegBlob = makeJpegBlob();
    setupImageBitmapMock(200, 200);
    const outBlob = setupTranscodeOutput();

    const result = await prepareBlobForOCR(jpegBlob);

    expect(result.blob).toBe(outBlob);
    expect(result.blob).not.toBe(jpegBlob);
    expect(result.clientScale).toBe(1);
    expect(result.originalW).toBe(200);
    expect(result.originalH).toBe(200);
  });

  it('downscales large PNG above the OCR area threshold', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(2500, 2500);
    const outBlob = setupTranscodeOutput();

    const result = await prepareBlobForOCR(blob);

    expect(result.blob).toBe(outBlob);
    expect(result.sentW).toBeLessThan(2500);
    expect(result.sentH).toBeLessThan(2500);
    expect(result.sentW * result.sentH).toBeLessThanOrEqual(MAX_OCR_AREA + 1);
  });

  it('does not downscale image under the OCR area threshold', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(1800, 1800);

    const result = await prepareBlobForOCR(blob);

    expect(result.blob).toBe(blob);
    expect(result.sentW).toBe(1800);
    expect(result.sentH).toBe(1800);
    expect(result.clientScale).toBe(1);
  });

  it('computes clientScale as targetW/originalW', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(4000, 1000);
    setupTranscodeOutput();

    const result = await prepareBlobForOCR(blob);

    const expectedScale = Math.sqrt(MAX_OCR_AREA / (4000 * 1000));
    const expectedTargetW = Math.floor(4000 * expectedScale);
    expect(result.clientScale).toBeCloseTo(expectedTargetW / 4000, 5);
  });

  it('preserves aspect ratio when downscaling', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(3000, 1000);
    setupTranscodeOutput();

    const result = await prepareBlobForOCR(blob);

    const originalRatio = 3000 / 1000;
    const sentRatio = result.sentW / result.sentH;
    expect(Math.abs(sentRatio - originalRatio)).toBeLessThan(0.01);
  });
});

describe('sendImageForOCR', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockCreateImageBitmap.mockReset();
    mockConvertToBlob.mockReset();
    mockBackend.ocr.mockReset();
  });

  it('sends the prepared image to the backend adapter', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'hello' });

    await sendImageForOCR(blob);

    expect(mockBackend.ocr).toHaveBeenCalledTimes(1);
    const [image, options] = mockBackend.ocr.mock.calls[0];
    expect(image).toBeInstanceOf(Blob);
    expect(options).toMatchObject({ language: undefined, devMode: undefined });
  });

  it('passes the learning language through to the backend adapter', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: '日本語' });

    await sendImageForOCR(blob, {
      language: 'ja',
    });

    expect(mockBackend.ocr.mock.calls[0][1]).toMatchObject({
      language: 'ja',
    });
  });

  it('passes dev detection scale options to the backend adapter', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'hello' });

    await sendImageForOCR(blob, {
      devMode: true,
      detectionScale: 50,
    });

    expect(mockBackend.ocr.mock.calls[0][1]).toMatchObject({
      devMode: true,
      detectionMaxWidth: 50,
      detectionMaxHeight: 50,
    });
  });

  it('does not apply dev detection scale when dev mode is off', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'hello' });

    await sendImageForOCR(blob, {
      detectionScale: 50,
    });

    expect(mockBackend.ocr.mock.calls[0][1]).toMatchObject({
      devMode: undefined,
    });
    expect(mockBackend.ocr.mock.calls[0][1]).not.toHaveProperty('detectionMaxWidth');
    expect(mockBackend.ocr.mock.calls[0][1]).not.toHaveProperty('detectionMaxHeight');
  });

  it('returns OCR result with text', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'detected text', boxes: [] });

    const result = await sendImageForOCR(blob);

    expect(result.text).toBe('detected text');
    expect(result.boxes).toEqual([]);
  });

  it('attaches client_scale and size metadata to result', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'ok' });

    const result = await sendImageForOCR(blob);

    expect(result.client_scale).toBe(1);
    expect(result.downscale_factor).toBe(1);
    expect(result.original_size).toEqual({ width: 100, height: 100 });
    expect(result.sent_size).toEqual({ width: 100, height: 100 });
  });

  it('attaches correct downscale metadata when image was resized', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(2000, 2000);
    setupTranscodeOutput();
    setupBackendOCRResponse({ text: 'scaled' });

    const result = await sendImageForOCR(blob);

    expect(result.client_scale).toBeLessThan(1);
    expect(result.downscale_factor).toBeGreaterThan(1);
    expect(result.original_size).toEqual({ width: 2000, height: 2000 });
    expect(result.sent_size!.width).toBeLessThan(2000);
    expect(result.sent_size!.height).toBeLessThan(2000);
  });

  it('throws on non-ok response', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRError(500, 'Internal Server Error');

    await expect(
      sendImageForOCR(blob)
    ).rejects.toThrow('OCR request failed: 500 - Internal Server Error');
  });

  it('throws on 400 response with error body', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRError(400, 'Bad image format');

    await expect(
      sendImageForOCR(blob)
    ).rejects.toThrow('OCR request failed: 400 - Bad image format');
  });
});

describe('useOCR', () => {
  let useOCR: typeof import('./useOCR').useOCR;

  beforeAll(async () => {
    const mod = await import('./useOCR');
    useOCR = mod.useOCR;
  });

  beforeEach(() => {
    mockFetch.mockReset();
    mockCreateImageBitmap.mockReset();
    mockConvertToBlob.mockReset();
    mockIsConnected = vi.fn(() => true);
    mockRequestAccess = vi.fn(() => Promise.resolve(true));
    mockCurrentLangData = vi.fn(() => makeInstalledLanguageData());
    mockCloudRecognize.mockReset();
    mockEnsureCloudAccessToken.mockClear();
    mockBackend.ocr.mockReset();
    mockSettings = {
      ocrProvider: 'local',
      language: 'ja',
      cloudAuthAccessToken: '',
      cloudAuthToken: '',
    };
  });

  it('initial state: not processing, no result, no error', () => {
    createRoot((dispose) => {
      const ocr = useOCR();
      expect(ocr.isProcessing()).toBe(false);
      expect(ocr.lastResult()).toBeNull();
      expect(ocr.error()).toBeNull();
      dispose();
    });
  });

  it('recognize with blob calls local backend and returns result', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'recognized' });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(blob);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('recognized');
      expect(ocr.lastResult()!.text).toBe('recognized');
      expect(ocr.isProcessing()).toBe(false);
      expect(ocr.error()).toBeNull();
      expect(mockBackend.ocr).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.objectContaining({ language: 'ja' }),
      );
      dispose();
    });
  });

  it('recognize sets error and returns null when not connected', async () => {
    mockIsConnected = vi.fn(() => false);

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(makePngBlob());

      expect(result).toBeNull();
      expect(ocr.error()).toBe('Backend not connected');
      expect(mockBackend.ocr).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('recognize refuses to run OCR before selected language data is loaded', async () => {
    mockCurrentLangData = vi.fn(() => null);
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(blob);

      expect(result).toBeNull();
      expect(ocr.error()).toBe('Language data is required before running OCR for ja');
      expect(mockBackend.ocr).not.toHaveBeenCalled();
      expect(mockCloudRecognize).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('recognize refuses stale language data without OCR runtime metadata', async () => {
    mockCurrentLangData = vi.fn(() => ({
      name: 'Unconfigured Japanese metadata',
      colour_codes: {},
      settings: { fixed: {} },
    }));
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(blob);

      expect(result).toBeNull();
      expect(ocr.error()).toBe('OCR runtime language data is required for ja');
      expect(mockBackend.ocr).not.toHaveBeenCalled();
      expect(mockCloudRecognize).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('recognize returns null when low power gate denies access', async () => {
    mockRequestAccess = vi.fn(() => Promise.resolve(false));

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(makePngBlob());

      expect(result).toBeNull();
      expect(mockRequestAccess).toHaveBeenCalledWith('ocr');
      expect(ocr.isProcessing()).toBe(false);
      expect(mockBackend.ocr).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('recognize sets error on backend failure', async () => {
    setupImageBitmapMock(100, 100);
    mockBackend.ocr.mockRejectedValue(new Error('Network failure'));

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(makePngBlob());

      expect(result).toBeNull();
      expect(ocr.error()).toBe('Network failure');
      expect(ocr.isProcessing()).toBe(false);
      dispose();
    });
  });

  it('recognize sets error on non-ok OCR response', async () => {
    setupImageBitmapMock(100, 100);
    setupBackendOCRError(500, 'Server died');

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(makePngBlob());

      expect(result).toBeNull();
      expect(ocr.error()).toContain('500');
      expect(ocr.isProcessing()).toBe(false);
      dispose();
    });
  });

  it('recognizeBase64 converts raw base64 to data URL then recognizes', async () => {
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'base64 result' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: vi.fn().mockResolvedValue(makePngBlob()),
    });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognizeBase64('iVBORw0KGgoAAAA');

      expect(result).not.toBeNull();
      const firstCallUrl = mockFetch.mock.calls[0][0];
      expect(firstCallUrl).toContain('data:image/png;base64,');
      dispose();
    });
  });

  it('recognizeBase64 does not double-wrap existing data URL', async () => {
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'ok' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: vi.fn().mockResolvedValue(makePngBlob()),
    });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      await ocr.recognizeBase64('data:image/png;base64,iVBORw0KGgoAAAA');

      const firstCallUrl = mockFetch.mock.calls[0][0];
      expect(firstCallUrl).toBe('data:image/png;base64,iVBORw0KGgoAAAA');
      expect(firstCallUrl).not.toContain('data:image/png;base64,data:');
      dispose();
    });
  });

  it('recognizeBlob delegates to recognize', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'blob result' });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognizeBlob(blob);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('blob result');
      dispose();
    });
  });

  it('recognizeUrl delegates to recognize with URL string', async () => {
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'url result' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: vi.fn().mockResolvedValue(makePngBlob()),
    });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognizeUrl('https://example.com/image.png');

      expect(result).not.toBeNull();
      expect(result!.text).toBe('url result');
      dispose();
    });
  });

  it('clearError resets error to null', async () => {
    mockIsConnected = vi.fn(() => false);

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      await ocr.recognize(makePngBlob());
      expect(ocr.error()).toBe('Backend not connected');

      ocr.clearError();
      expect(ocr.error()).toBeNull();
      dispose();
    });
  });

  it('clearResult resets lastResult to null', async () => {
    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'to be cleared' });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      await ocr.recognize(blob);
      expect(ocr.lastResult()).not.toBeNull();

      ocr.clearResult();
      expect(ocr.lastResult()).toBeNull();
      dispose();
    });
  });

  it('captureAndRecognize sets error when captureScreen unavailable', async () => {
    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.captureAndRecognize();

      expect(result).toBeNull();
      expect(ocr.error()).toBe('Screen capture not available');
      dispose();
    });
  });

  it('captureAndRecognize calls window.mlearn.captureScreen', async () => {
    const captureScreen = vi.fn().mockResolvedValue('iVBORw0KGgoAAAA');
    vi.stubGlobal('mlearn', { captureScreen });

    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'captured' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: vi.fn().mockResolvedValue(makePngBlob()),
    });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.captureAndRecognize();

      expect(captureScreen).toHaveBeenCalled();
      expect(result).not.toBeNull();
      dispose();
    });

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('createImageBitmap', mockCreateImageBitmap);
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
  });

  it('captureAndRecognize catches captureScreen error', async () => {
    vi.stubGlobal('mlearn', {
      captureScreen: vi.fn().mockRejectedValue(new Error('Permission denied')),
    });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.captureAndRecognize();

      expect(result).toBeNull();
      expect(ocr.error()).toBe('Permission denied');
      dispose();
    });

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('createImageBitmap', mockCreateImageBitmap);
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
  });

  it('cloud OCR uses CloudOCRAdapter when ocrProvider is cloud', async () => {
    mockSettings = {
      ocrProvider: 'cloud',
      language: 'ja',
      cloudAuthAccessToken: 'my-token',
      cloudAuthToken: '',
    };

    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    mockCloudRecognize.mockResolvedValue({ text: 'cloud result', boxes: [] });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(blob);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('cloud result');
      expect(mockCloudRecognize).toHaveBeenCalledWith(expect.any(Blob), 'ja', 'rapid');
      expect(mockFetch).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('cloud OCR requests MangaOCR when language runtime uses MangaOCR recognition', async () => {
    mockSettings = {
      ocrProvider: 'cloud',
      language: 'ja',
      cloudAuthAccessToken: 'my-token',
      cloudAuthToken: '',
    };
    mockCurrentLangData = vi.fn(() => ({
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          recognitionEngine: 'mangaocr',
        },
      },
    }));

    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    mockCloudRecognize.mockResolvedValue({ text: '漫画', boxes: [] });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(blob);

      expect(result).not.toBeNull();
      expect(mockCloudRecognize).toHaveBeenCalledWith(expect.any(Blob), 'ja', 'manga-ocr');
      dispose();
    });
  });

  it('cloud OCR refuses stale language data without OCR runtime metadata', async () => {
    mockSettings = {
      ocrProvider: 'cloud',
      language: 'ja',
      cloudAuthAccessToken: 'my-token',
      cloudAuthToken: '',
    };
    mockCurrentLangData = vi.fn(() => ({
      name: 'Unconfigured Japanese metadata',
      colour_codes: {},
      settings: { fixed: {} },
    }));

    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    mockCloudRecognize.mockResolvedValue({ text: 'should not run', boxes: [] });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(blob);

      expect(result).toBeNull();
      expect(ocr.error()).toBe('OCR runtime language data is required for ja');
      expect(mockCloudRecognize).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('cloud OCR does not check connection status', async () => {
    mockIsConnected = vi.fn(() => false);
    mockSettings = {
      ocrProvider: 'cloud',
      language: 'ja',
      cloudAuthAccessToken: 'token',
      cloudAuthToken: '',
    };

    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    mockCloudRecognize.mockResolvedValue({ text: 'cloud works offline' });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(blob);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('cloud works offline');
      dispose();
    });
  });

  it('cloud OCR does not go through low power gate', async () => {
    mockSettings = {
      ocrProvider: 'cloud',
      language: 'ja',
      cloudAuthAccessToken: 'token',
      cloudAuthToken: '',
    };

    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);
    mockCloudRecognize.mockResolvedValue({ text: 'ok' });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      await ocr.recognize(blob);

      expect(mockRequestAccess).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('cloud OCR sets error when no auth token', async () => {
    mockSettings = {
      ocrProvider: 'cloud',
      language: 'ja',
      cloudAuthAccessToken: '',
      cloudAuthToken: '',
    };

    const blob = makePngBlob();
    setupImageBitmapMock(100, 100);

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognize(blob);

      expect(result).toBeNull();
      expect(ocr.error()).toContain('authentication');
      dispose();
    });
  });

  it('recognize clears previous error on new call', async () => {
    mockIsConnected = vi.fn(() => false);

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      await ocr.recognize(makePngBlob());
      expect(ocr.error()).toBe('Backend not connected');

      mockIsConnected = vi.fn(() => true);
      setupImageBitmapMock(100, 100);
      setupBackendOCRResponse({ text: 'success' });

      const result = await ocr.recognize(makePngBlob());
      expect(result).not.toBeNull();
      expect(ocr.error()).toBeNull();
      dispose();
    });
  });

  it('recognizeFile delegates File to recognize', async () => {
    const file = new File([new Uint8Array(100)], 'test.png', { type: 'image/png' });
    setupImageBitmapMock(100, 100);
    setupBackendOCRResponse({ text: 'file result' });

    await createRoot(async (dispose) => {
      const ocr = useOCR();
      const result = await ocr.recognizeFile(file);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('file result');
      dispose();
    });
  });

});
