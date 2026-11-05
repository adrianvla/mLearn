import type { AuthoredMediaId, CapturedMediaFile, MaterialMediaKind, MediaCaptureRequest } from '@mlearn/contracts';
import { RuntimeError } from '@mlearn/runtime-client';

export type PickedAuthoredMedia = {
  readonly path: string;
  readonly name: string;
  readonly kind: MaterialMediaKind;
  readonly release: () => Promise<void>;
};

export type AuthoredMediaHost = {
  readonly capture: (request: MediaCaptureRequest, signal?: AbortSignal) => Promise<{
    readonly file: CapturedMediaFile;
    readonly release: () => Promise<void>;
  }>;
  readonly pick: (kind: MaterialMediaKind) => Promise<PickedAuthoredMedia | null>;
  readonly uri: (id: AuthoredMediaId) => Promise<string>;
  readonly export: (id: AuthoredMediaId) => Promise<boolean>;
};

export type MediaCaptureTransport = {
  readonly reserve: (id: string) => Promise<void>;
  readonly capture: (id: string, request: MediaCaptureRequest) => Promise<unknown>;
  readonly cancel: (id: string) => Promise<void>;
  readonly release: (path: string) => Promise<void>;
  readonly commandId: () => string;
};

function isCapturedMedia(value: unknown): value is CapturedMediaFile {
  if (!value || typeof value !== 'object' || !('path' in value) || typeof value.path !== 'string' ||
      !('name' in value) || typeof value.name !== 'string' || !('kind' in value) ||
      !['image', 'audio', 'video'].includes(String(value.kind)) ||
      !('segment' in value) || !value.segment || typeof value.segment !== 'object') return false;
  const segment = value.segment;
  return 'sourceId' in segment && typeof segment.sourceId === 'string' &&
    'contentRevision' in segment && typeof segment.contentRevision === 'string' &&
    'startMs' in segment && typeof segment.startMs === 'number' && Number.isSafeInteger(segment.startMs) && segment.startMs >= 0 &&
    'endMs' in segment && typeof segment.endMs === 'number' && Number.isSafeInteger(segment.endMs) && segment.endMs >= segment.startMs;
}

// Subscribe before reservation. A cancelled reservation still enters the native
// method, which checks cancellation before planning/extracting and releases its slot.
export function captureAuthoredMedia(transport: MediaCaptureTransport): AuthoredMediaHost['capture'] {
  return async (request, signal) => {
    const cancelled = () => new RuntimeError('cancelled', 'Media capture cancelled.');
    if (signal?.aborted) throw cancelled();
    const id = transport.commandId();
    let reserved = false;
    let cancellation: Promise<unknown> | undefined;
    const cancel = () => {
      if (reserved && !cancellation) {
        cancellation = transport.cancel(id).then(() => null, (error: unknown) => error);
      }
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await transport.reserve(id);
      reserved = true;
      if (signal?.aborted) cancel();
      if (cancellation) {
        const error = await cancellation;
        if (error !== null) throw error;
      }
      const value = await transport.capture(id, request);
      if (!isCapturedMedia(value)) throw new RuntimeError('protocol', 'Malformed captured media output.');
      if (signal?.aborted) {
        await transport.release(value.path);
        throw cancelled();
      }
      if (value.segment.sourceId !== request.sourceId || value.segment.contentRevision !== request.contentRevision) {
        await transport.release(value.path);
        throw new RuntimeError('protocol', 'Captured media has a different source revision.');
      }
      return { file: value, release: () => transport.release(value.path) };
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (cancellation) {
        const error = await cancellation;
        if (error !== null) throw error;
      }
    }
  };
}
