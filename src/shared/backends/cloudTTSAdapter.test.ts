import { CloudTTSAdapter, CloudTTSCallbacks } from './cloudTTSAdapter';

const BASE_URL = 'https://example.com';
const AUTH_TOKEN = 'test-token';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeCallbacks(): { callbacks: CloudTTSCallbacks; onAudio: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn>; onDone: ReturnType<typeof vi.fn> } {
  const onAudio = vi.fn();
  const onError = vi.fn();
  const onDone = vi.fn();
  return { callbacks: { onAudio, onError, onDone }, onAudio, onError, onDone };
}

function makeReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

function makeStreamResponse(chunks: Uint8Array[], contentType = 'audio/wav'): Response {
  const body = makeReadableStream(chunks);
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeTextResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

describe('CloudTTSAdapter', () => {
  describe('constructor', () => {
    it('strips trailing slashes from baseUrl', () => {
      const adapter = new CloudTTSAdapter('https://example.com///', AUTH_TOKEN);
      mockFetch.mockResolvedValueOnce(makeTextResponse('', 200));
      adapter.checkAvailability();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/health',
        expect.any(Object),
      );
    });
  });

  describe('streamTTS', () => {
    it('calls onAudio for each chunk and onDone on success', async () => {
      const { callbacks, onAudio, onDone, onError } = makeCallbacks();
      const chunk1 = new Uint8Array([1, 2, 3]);
      const chunk2 = new Uint8Array([4, 5, 6]);
      const streamUrl = 'https://modal.example.com/stream/abc';

      mockFetch
        .mockResolvedValueOnce(makeJsonResponse({ jobId: 'j1', token: 't', actions: { stream_url: streamUrl } }))
        .mockResolvedValueOnce(makeStreamResponse([chunk1, chunk2], 'audio/wav'));

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.streamTTS('hello', 'en', callbacks);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/api/tts/stream`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${AUTH_TOKEN}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: 'hello', language: 'en', provider: undefined }),
        }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        streamUrl,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(onAudio).toHaveBeenCalledTimes(2);
      expect(onAudio).toHaveBeenNthCalledWith(1, chunk1.buffer, 'audio/wav');
      expect(onAudio).toHaveBeenNthCalledWith(2, chunk2.buffer, 'audio/wav');
      expect(onDone).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
    });

    it('passes provider when provided', async () => {
      const { callbacks } = makeCallbacks();
      const streamUrl = 'https://modal.example.com/stream/xyz';

      mockFetch
        .mockResolvedValueOnce(makeJsonResponse({ jobId: 'j2', token: 't', actions: { stream_url: streamUrl } }))
        .mockResolvedValueOnce(makeStreamResponse([]));

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.streamTTS('test', 'ja', callbacks, 'kokoro');

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/api/tts/stream`,
        expect.objectContaining({
          body: JSON.stringify({ text: 'test', language: 'ja', provider: 'kokoro' }),
        }),
      );
    });

    it('calls onError when stream_url is null', async () => {
      const { callbacks, onError, onDone } = makeCallbacks();

      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ jobId: 'j3', token: 't', actions: { stream_url: null } }),
      );

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.streamTTS('hello', 'en', callbacks);

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('no stream_url'));
      expect(onDone).not.toHaveBeenCalled();
    });

    it('calls onError when step 1 returns non-ok status', async () => {
      const { callbacks, onError, onDone } = makeCallbacks();

      mockFetch.mockResolvedValueOnce(makeTextResponse('Bad Request', 400));

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.streamTTS('hello', 'en', callbacks);

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('400'));
      expect(onDone).not.toHaveBeenCalled();
    });

    it('calls onError when step 2 (stream fetch) fails', async () => {
      const { callbacks, onError, onDone } = makeCallbacks();
      const streamUrl = 'https://modal.example.com/stream/fail';

      mockFetch
        .mockResolvedValueOnce(makeJsonResponse({ jobId: 'j4', token: 't', actions: { stream_url: streamUrl } }))
        .mockResolvedValueOnce(makeTextResponse('Service Unavailable', 503));

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.streamTTS('hello', 'en', callbacks);

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('503'));
      expect(onDone).not.toHaveBeenCalled();
    });

    it('calls onError when response body is null', async () => {
      const { callbacks, onError, onDone } = makeCallbacks();
      const streamUrl = 'https://modal.example.com/stream/nobody';

      mockFetch
        .mockResolvedValueOnce(makeJsonResponse({ jobId: 'j5', token: 't', actions: { stream_url: streamUrl } }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.streamTTS('hello', 'en', callbacks);

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('no response body'));
      expect(onDone).not.toHaveBeenCalled();
    });

    it('calls onDone (not onError) when AbortError is thrown', async () => {
      const { callbacks, onDone, onError } = makeCallbacks();

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.streamTTS('hello', 'en', callbacks);

      expect(onDone).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
    });

    it('calls onError when a network error is thrown', async () => {
      const { callbacks, onError, onDone } = makeCallbacks();

      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.streamTTS('hello', 'en', callbacks);

      expect(onError).toHaveBeenCalledWith('Network failure');
      expect(onDone).not.toHaveBeenCalled();
    });

    it('uses default content-type audio/wav when header is missing', async () => {
      const { callbacks, onAudio } = makeCallbacks();
      const chunk = new Uint8Array([9]);
      const streamUrl = 'https://modal.example.com/stream/noct';

      const body = makeReadableStream([chunk]);
      const streamResponse = new Response(body, { status: 200 });

      mockFetch
        .mockResolvedValueOnce(makeJsonResponse({ jobId: 'j6', token: 't', actions: { stream_url: streamUrl } }))
        .mockResolvedValueOnce(streamResponse);

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.streamTTS('hello', 'en', callbacks);

      expect(onAudio).toHaveBeenCalledWith(chunk.buffer, 'audio/wav');
    });
  });

  describe('createBatchJob', () => {
    it('returns jobId and empty token on success', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ jobId: 'batch-123', actions: { listen_channel: 'ch1' } }),
      );

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      const result = await adapter.createBatchJob('hello', 'en');

      expect(result).toEqual({ jobId: 'batch-123', token: '' });
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/tts/jobs`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${AUTH_TOKEN}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: 'hello', language: 'en', provider: undefined }),
        }),
      );
    });

    it('passes provider in request body when provided', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ jobId: 'batch-456', actions: { listen_channel: 'ch2' } }),
      );

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await adapter.createBatchJob('test', 'ja', 'qwen');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/tts/jobs`,
        expect.objectContaining({
          body: JSON.stringify({ text: 'test', language: 'ja', provider: 'qwen' }),
        }),
      );
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(makeTextResponse('Internal Server Error', 500));

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      await expect(adapter.createBatchJob('hello', 'en')).rejects.toThrow('500');
    });
  });

  describe('checkAvailability', () => {
    it('returns true when health endpoint responds ok', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
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

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      const result = await adapter.checkAvailability();

      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'));

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      const result = await adapter.checkAvailability();

      expect(result).toBe(false);
    });
  });

  describe('abort', () => {
    it('aborts the active stream', async () => {
      const { callbacks, onDone } = makeCallbacks();
      const streamUrl = 'https://modal.example.com/stream/abort-me';

      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ jobId: 'ja1', token: 't', actions: { stream_url: streamUrl } }),
      );

      let resolveHang: () => void;
      const hangPromise = new Promise<never>((_, reject) => {
        resolveHang = () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        };
      });
      mockFetch.mockReturnValueOnce(hangPromise);

      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      const streamPromise = adapter.streamTTS('hello', 'en', callbacks);

      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      resolveHang!();
      await streamPromise;

      expect(onDone).toHaveBeenCalled();
    });

    it('does not throw when no stream is active', () => {
      const adapter = new CloudTTSAdapter(BASE_URL, AUTH_TOKEN);
      expect(() => adapter.abort()).not.toThrow();
    });
  });
});
