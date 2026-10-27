import test from 'node:test';
import assert from 'node:assert/strict';
import type { OcrPage, OcrProvider, OcrRequest } from '@mlearn/contracts';
import { isOcrPage, RuntimeError } from '@mlearn/runtime-client';
import { createImageOcrHost, type ImageOcrTransport } from '../../apps/client/src/host/imageOcr';

const provider: OcrProvider = {
    id: 'test-provider', label: 'Test provider', revision: '1', availability: 'ready',
    languages: ['test-language'], scripts: [], languageProvenance: 'test SDK', reason: null,
};
const request: OcrRequest = {
    requestId: 'df08a23d-e7df-46fa-9332-8acf25d933f5', sourceId: 'original-book', contentRevision: 'original-bytes',
    resourceId: 'page-2', providerId: provider.id, recognitionLanguages: ['test-language'], crop: null,
};
const page: OcrPage = {
    sourceId: request.sourceId, contentRevision: request.contentRevision, resourceId: request.resourceId,
    ocrRevision: 1, provider, width: 400, height: 800, crop: null, regions: [],
};
function host(overrides: Partial<ImageOcrTransport> = {}) {
    return createImageOcrHost({
        reserve: async () => {}, cancel: async () => {}, providers: async () => [provider],
        recognize: async () => ({ type: 'ocr_page', page }), uri: async () => 'data:image/png;base64,',
        ...overrides,
    });
}

test('a successful empty native recognition remains empty with its actual source provenance', async () => {
    // Given a completed native page with no recognized regions.
    const native = host();
    // When the validated committed page crosses the host boundary.
    const result = await native.recognize(request);
    // Then no text, hit target or confidence is invented to fill the empty page.
    assert.deepEqual(result, page);
});

test('recognition for a different original page is rejected rather than displayed as current', async () => {
    // Given a stale result belonging to another resource in the same book.
    const native = host({ recognize: async () => ({ type: 'ocr_page', page: { ...page, resourceId: 'page-1' } }) });
    // When it crosses the selected page boundary, then publication fails explicitly.
    await assert.rejects(native.recognize(request),
        (cause: unknown) => cause instanceof RuntimeError && cause.code === 'protocol');
});

test('cancellation racing native reservation drains that reservation without publishing a result', { timeout: 5000 }, async () => {
    // Given a reservation that has entered native code but has not yet returned.
    let entered: () => void = () => {};
    let admit: () => void = () => {};
    const enteredNative = new Promise<void>(resolve => { entered = resolve; });
    const admission = new Promise<void>(resolve => { admit = resolve; });
    let reserved = false;
    let cancelled = false;
    const native = host({
        reserve: async () => { entered(); await admission; reserved = true; },
        cancel: async () => { cancelled = true; },
        recognize: async () => {
            // Like the real native method's finally path, execution retires its slot.
            reserved = false;
            if (cancelled) throw new Error('Native request cancelled');
            return { type: 'ocr_page', page };
        },
    });
    const controller = new AbortController();
    const pending = native.recognize(request, controller.signal);
    const rejection = assert.rejects(pending,
        (cause: unknown) => cause instanceof RuntimeError && cause.code === 'cancelled');
    // When cancellation occurs before reservation's reply, then completion is rejected
    // and the native owner is available rather than leaking a reserved request.
    await enteredNative;
    controller.abort();
    admit();
    await rejection;
    assert.equal(cancelled, true);
    assert.equal(reserved, false);
});

test('provider geometry is bounded before it can become a source hit target', () => {
    // Given valid source-local provider observations and two hostile variants.
    const region = { id: 'line-1', text: '東京', quad: {
        topLeft: { x: 0.2, y: 0.1 }, topRight: { x: 0.3, y: 0.1 },
        bottomRight: { x: 0.3, y: 0.4 }, bottomLeft: { x: 0.2, y: 0.4 },
    }, candidates: [{ text: '東京', confidence: 0.8 }], language: null, orientation: null, readingOf: null };
    const valid = { ...page, regions: [region] };
    // When results are admitted, then a non-finite polygon or duplicate source ID
    // cannot create an ambiguous region even if the surrounding response is valid.
    assert.equal(isOcrPage(valid), true);
    assert.equal(isOcrPage({ ...page, regions: [region, region] }), false);
    assert.equal(isOcrPage({ ...page, regions: [{ ...region, quad: {
        ...region.quad, topRight: { x: Number.NaN, y: 0.1 },
    } }] }), false);
});

test('source display forwards the original crop and rejects non-raster or unbounded native output', async () => {
    // Given an authorized display transport, independent of inference.
    const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const uri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    const observed: unknown[] = [];
    const native = host({ uri: async (...args) => { observed.push(args); return uri; } });
    // When the original-pixel lens requests a crop, then its source coordinates
    // reach the host unchanged and invalid input never starts native decoding.
    assert.equal(await native.uri(page.sourceId, page.resourceId, crop), uri);
    assert.deepEqual(observed, [[page.sourceId, page.resourceId, crop]]);
    await assert.rejects(native.uri(page.sourceId, page.resourceId, { ...crop, width: 1 }),
        (cause: unknown) => cause instanceof RuntimeError && cause.code === 'invalid_request');
    assert.equal(observed.length, 1);
    for (const invalid of ['https://outside.invalid/image.png', 'data:image/svg+xml,<svg/>',
        'data:image/png;base64,', 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024)]) {
        await assert.rejects(host({ uri: async () => invalid }).uri(page.sourceId, page.resourceId),
            (cause: unknown) => cause instanceof RuntimeError && cause.code === 'protocol');
    }
});
