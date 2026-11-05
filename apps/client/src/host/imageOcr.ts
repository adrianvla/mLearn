import type { OcrPage, OcrProvider, OcrRect, OcrRequest } from '@mlearn/contracts';
import { isOcrProvider, isOcrRect, isOcrResponse, RuntimeError } from '@mlearn/runtime-client';

export type ImageOcrHost = {
    readonly providers: () => Promise<OcrProvider[]>;
    readonly recognize: (request: OcrRequest, signal?: AbortSignal) => Promise<OcrPage>;
    readonly uri: (sourceId: string, resourceId: string, crop?: OcrRect | null) => Promise<string>;
};
export type ImageOcrTransport = {
    readonly reserve: (id: string) => Promise<void>;
    readonly recognize: (id: string, request: OcrRequest) => Promise<unknown>;
    readonly cancel: (id: string) => Promise<void>;
    readonly providers: () => Promise<unknown>;
    readonly uri: ImageOcrHost['uri'];
};

function decode(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (new TextEncoder().encode(value).length > 524288)
        throw new RuntimeError('protocol', 'Recognition response exceeds its message limit.');
    try { return JSON.parse(value); }
    catch (cause) {
        if (cause instanceof SyntaxError) throw new RuntimeError('protocol', 'Malformed recognition response.');
        throw cause;
    }
}

/** The host executes native work; only Rust's validated, persisted page escapes
 * this boundary. A reservation is drained even when cancellation races it.
 */
export function createImageOcrHost(transport: ImageOcrTransport): ImageOcrHost {
    return {
        async uri(sourceId, resourceId, crop = null) {
            if (crop !== null && !isOcrRect(crop))
                throw new RuntimeError('invalid_request', 'Invalid source image crop.');
            const value = await transport.uri(sourceId, resourceId, crop);
            if (typeof value !== 'string' || value.length > 8 * 1024 * 1024
                || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
                throw new RuntimeError('protocol', 'Malformed or unbounded source image.');
            return value;
        },
        async providers() {
            const value = decode(await transport.providers());
            if (!Array.isArray(value) || value.length > 32 || !value.every(isOcrProvider)
                || new Set(value.map(provider => provider.id)).size !== value.length)
                throw new RuntimeError('protocol', 'Malformed recognition provider capabilities.');
            return value;
        },
        async recognize(request, signal) {
            const cancelled = () => new RuntimeError('cancelled', 'Image recognition cancelled.');
            if (signal?.aborted) throw cancelled();
            let reserved = false;
            let cancellation: Promise<unknown> | undefined;
            const cancel = () => {
                if (reserved && !cancellation)
                    cancellation = transport.cancel(request.requestId).then(() => null, (cause: unknown) => cause);
            };
            signal?.addEventListener('abort', cancel, { once: true });
            try {
                await transport.reserve(request.requestId);
                reserved = true;
                if (signal?.aborted) cancel();
                const value = decode(await transport.recognize(request.requestId, request));
                if (signal?.aborted) throw cancelled();
                if (!isOcrResponse(value) || value.page.sourceId !== request.sourceId
                    || value.page.contentRevision !== request.contentRevision || value.page.resourceId !== request.resourceId
                    || value.page.provider.id !== request.providerId)
                    throw new RuntimeError('protocol', 'Recognition completed for a different source or provider.');
                return value.page;
            } catch (cause) {
                if (signal?.aborted) throw cancelled();
                throw cause;
            } finally {
                signal?.removeEventListener('abort', cancel);
                if (cancellation) {
                    const cause = await cancellation;
                    if (cause !== null) throw cause;
                }
            }
        },
    };
}
