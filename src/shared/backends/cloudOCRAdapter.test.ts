import { CloudOCRAdapter } from './cloudOCRAdapter';

const BASE_URL = 'https://example.com';
const AUTH_TOKEN = 'test-token';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeTextResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

const JOB_ID = 'ocr-job-1';
const UPLOAD_URL = 'https://storage.example.com/upload/abc';
const TRIGGER_URL = 'https://api.example.com/trigger/abc';
const LISTEN_CHANNEL = 'channel-abc';
const JOB_TOKEN = 'job-token-xyz';

const createJobResponse = {
  jobId: JOB_ID,
  token: JOB_TOKEN,
  actions: {
    upload_image: UPLOAD_URL,
    trigger_job: TRIGGER_URL,
    listen_channel: LISTEN_CHANNEL,
  },
};

const completedJobResponse = {
  job: {
    id: JOB_ID,
    type: 'ocr',
    status: 'completed',
    input_params: {},
    result: { text: 'Hello World', boxes: [] },
    error: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:01Z',
    completed_at: '2024-01-01T00:00:01Z',
  },
};

describe('CloudOCRAdapter', () => {
  describe('constructor', () => {
    it('strips trailing slashes from baseUrl', async () => {
      const adapter = new CloudOCRAdapter('https://example.com///', AUTH_TOKEN);
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      await adapter.checkAvailability();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/health',
        expect.any(Object),
      );
    });
  });

  describe('recognize', () => {
    it('completes full 4-step HATEOAS flow and returns OCR result', async () => {
      vi.useFakeTimers();

      const blob = new Blob(['image-data'], { type: 'image/png' });

      mockFetch
        .mockResolvedValueOnce(makeJsonResponse(createJobResponse))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(makeJsonResponse(completedJobResponse));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const promise = adapter.recognize(blob, 'ja');
      await vi.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result).toEqual({ text: 'Hello World', boxes: [] });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/api/ocr/jobs`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${AUTH_TOKEN}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ language: 'ja', engine: undefined, imageFormat: 'png' }),
        }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        UPLOAD_URL,
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ 'Content-Type': 'image/png' }),
          body: blob,
        }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        TRIGGER_URL,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Authorization': `Bearer ${AUTH_TOKEN}` }),
        }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        4,
        `${BASE_URL}/api/ocr/jobs/${JOB_ID}`,
        expect.objectContaining({
          headers: expect.objectContaining({ 'Authorization': `Bearer ${AUTH_TOKEN}` }),
        }),
      );

      vi.useRealTimers();
    });

    it('polls until status becomes completed after processing', async () => {
      vi.useFakeTimers();

      const blob = new Blob(['image-data'], { type: 'image/png' });
      const processingResponse = {
        job: {
          id: JOB_ID,
          type: 'ocr',
          status: 'processing',
          input_params: {},
          result: null,
          error: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          completed_at: null,
        },
      };

      mockFetch
        .mockResolvedValueOnce(makeJsonResponse(createJobResponse))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(makeJsonResponse(processingResponse))
        .mockResolvedValueOnce(makeJsonResponse(completedJobResponse));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const promise = adapter.recognize(blob, 'en');
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(750);
      const result = await promise;

      expect(result.text).toBe('Hello World');
      expect(mockFetch).toHaveBeenCalledTimes(5);

      vi.useRealTimers();
    });

    it('throws when step 1 (job creation) fails', async () => {
      const blob = new Blob(['image-data'], { type: 'image/png' });
      mockFetch.mockResolvedValueOnce(makeTextResponse('Unauthorized', 401));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      await expect(adapter.recognize(blob, 'ja')).rejects.toThrow('401');
    });

    it('throws when step 2 (image upload) fails', async () => {
      const blob = new Blob(['image-data'], { type: 'image/jpeg' });
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse(createJobResponse))
        .mockResolvedValueOnce(new Response(null, { status: 403 }));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      await expect(adapter.recognize(blob, 'ja')).rejects.toThrow('403');
    });

    it('throws when step 3 (trigger) fails', async () => {
      const blob = new Blob(['image-data'], { type: 'image/png' });
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse(createJobResponse))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(makeTextResponse('Internal Server Error', 500));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      await expect(adapter.recognize(blob, 'ja')).rejects.toThrow('500');
    });

    it('throws when poll returns failed status', async () => {
      vi.useFakeTimers();

      const blob = new Blob(['image-data'], { type: 'image/png' });
      const failedJobResponse = {
        job: {
          id: JOB_ID,
          type: 'ocr',
          status: 'failed',
          input_params: {},
          result: null,
          error: 'OCR engine error',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:01Z',
          completed_at: null,
        },
      };

      mockFetch
        .mockResolvedValueOnce(makeJsonResponse(createJobResponse))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(makeJsonResponse(failedJobResponse));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const promise = adapter.recognize(blob, 'ja');
      const rejection = expect(promise).rejects.toThrow('OCR engine error');
      await vi.advanceTimersByTimeAsync(500);
      await rejection;

      vi.useRealTimers();
    });

    it('throws on timeout after maxWaitMs', async () => {
      vi.useFakeTimers();

      const blob = new Blob(['image-data'], { type: 'image/png' });
      const processingResponse = () => makeJsonResponse({
        job: {
          id: JOB_ID,
          type: 'ocr',
          status: 'processing',
          input_params: {},
          result: null,
          error: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          completed_at: null,
        },
      });

      mockFetch
        .mockResolvedValueOnce(makeJsonResponse(createJobResponse))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockImplementation(() => Promise.resolve(processingResponse()));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const promise = adapter.recognize(blob, 'ja');
      const rejection = expect(promise).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(60_000 + 5_000);
      await rejection;

      vi.useRealTimers();
    });

    it('sends jpg imageFormat for image/jpeg blobs', async () => {
      vi.useFakeTimers();

      const blob = new Blob(['img'], { type: 'image/jpeg' });
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse(createJobResponse))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(makeJsonResponse(completedJobResponse));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const promise = adapter.recognize(blob, 'en');
      await vi.advanceTimersByTimeAsync(500);
      await promise;

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ language: 'en', engine: undefined, imageFormat: 'jpg' }) }),
      );

      vi.useRealTimers();
    });

    it('sends webp imageFormat for image/webp blobs', async () => {
      vi.useFakeTimers();

      const blob = new Blob(['img'], { type: 'image/webp' });
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse(createJobResponse))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(makeJsonResponse(completedJobResponse));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const promise = adapter.recognize(blob, 'en');
      await vi.advanceTimersByTimeAsync(500);
      await promise;

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ language: 'en', engine: undefined, imageFormat: 'webp' }) }),
      );

      vi.useRealTimers();
    });

    it('passes engine when provided', async () => {
      vi.useFakeTimers();

      const blob = new Blob(['img'], { type: 'image/png' });
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse(createJobResponse))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(makeJsonResponse(completedJobResponse));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const promise = adapter.recognize(blob, 'ja', 'manga-ocr');
      await vi.advanceTimersByTimeAsync(500);
      await promise;

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ language: 'ja', engine: 'manga-ocr', imageFormat: 'png' }) }),
      );

      vi.useRealTimers();
    });
  });

  describe('checkAvailability', () => {
    it('returns true when health endpoint responds ok', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const result = await adapter.checkAvailability();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/health`,
        expect.objectContaining({
          headers: expect.objectContaining({ 'Authorization': `Bearer ${AUTH_TOKEN}` }),
        }),
      );
    });

    it('returns false when health endpoint responds with error status', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const result = await adapter.checkAvailability();

      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const adapter = new CloudOCRAdapter(BASE_URL, AUTH_TOKEN);
      const result = await adapter.checkAvailability();

      expect(result).toBe(false);
    });
  });
});
