import test from 'node:test';
import assert from 'node:assert/strict';
import { imageAnalysisWindow, imageCrop, imageFrame, pageSpread } from '../../apps/client/src/features/reader/imageFlow';

test('pairing preserves the selected original page and visits every source once', () => {
    // Given an odd collection, with or without a single cover.
    for (const firstSingle of [false, true]) {
        // When navigating complete spreads and toggling pairing on any page.
        const visited: number[] = [];
        for (let page = 0; page < 7;) {
            const spread = pageSpread(page, 7, true, firstSingle);
            visited.push(...spread);
            page = spread[spread.length - 1] + 1;
        }
        // Then no original source is skipped or duplicated, including the last.
        assert.deepEqual(visited, [0, 1, 2, 3, 4, 5, 6]);
        for (let page = 0; page < 7; page++) {
            assert.ok(pageSpread(page, 7, true, firstSingle).includes(page));
            assert.deepEqual(pageSpread(page, 7, false, firstSingle), [page]);
        }
    }
    assert.deepEqual(pageSpread(2, 7, true, true), [1, 2]);
    assert.deepEqual(pageSpread(1, 7, true, false), [0, 1]);
});

test('crop maps from the actual letterboxed spread image, not its neighbour or viewport', () => {
    // Given the second page's displayed frame inside a wider source canvas.
    const frame = imageFrame(400, 800, { x: 500, y: 20, width: 300, height: 400 }, 'contain');
    assert.deepEqual(frame, { x: 550, y: 20, width: 200, height: 400 });
    // When a user drags backwards across its central half.
    const crop = imageCrop({ x: 700, y: 320 }, { x: 600, y: 120 }, frame);
    // Then crop coordinates remain normalized to that original upright page.
    assert.deepEqual(crop, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
});

test('crop intersects source pixels and rejects drags confined to the surrounding canvas', () => {
    // Given an image offset from canvas origin.
    const frame = { x: 100, y: 50, width: 400, height: 800 };
    // When the selection crosses its boundary or misses the image entirely.
    const crossing = imageCrop({ x: 0, y: 0 }, { x: 300, y: 450 }, frame);
    const outside = imageCrop({ x: 0, y: 0 }, { x: 80, y: 700 }, frame);
    // Then the native crop never contains letterbox pixels or a fabricated area.
    assert.deepEqual(crossing, { x: 0, y: 0, width: 0.5, height: 0.5 });
    assert.equal(outside, null);
});

test('page analysis bounds actual UTF8 bytes and does not tokenize identified publisher readings', () => {
    // Given a page larger than one native text window and a linked reading.
    const regions = Array.from({ length: 20 }, (_, index) => ({
        id: `region-${index}`, text: '東京', readingOf: index === 1 ? 'region-0' : null,
    }));
    // When preparing the visible page projection, then only actual main text
    // fits the bounded request; a second window resumes without overlap.
    const first = imageAnalysisWindow({ regions }, 0);
    assert.equal(first.ids.length, 16);
    assert.equal(first.ids.includes('region-1'), false);
    assert.equal(first.next, 16);
    assert.deepEqual(imageAnalysisWindow({ regions }, 16).ids, ['region-17', 'region-18', 'region-19']);
    const unicode = regions.slice(0, 2).map(region => ({ ...region, readingOf: null, text: '🌱'.repeat(513) }));
    assert.equal(imageAnalysisWindow({ regions: unicode }, 0).ids.length, 1);
    const oversized = [{ ...regions[0], text: 'a'.repeat(4097) }];
    assert.deepEqual(imageAnalysisWindow({ regions: oversized }, 0), { ids: [], total: 1, next: null });
});
