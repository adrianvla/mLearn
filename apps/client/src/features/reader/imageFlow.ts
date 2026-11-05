import type { AnalyzedToken, DocumentRecord, OcrPage, OcrRegion, SourceAnchor } from '@mlearn/contracts';

export type ImageFit = 'contain' | 'width' | 'height';
export type PixelPoint = { readonly x: number; readonly y: number };
export type ImageFrame = PixelPoint & { readonly width: number; readonly height: number };

/** Pair the selected source page with its neighbour, never move past it when
 * changing pairing. Collation and visual direction do not change membership.
 */
export function pageSpread(page: number, total: number, paired: boolean, firstSingle: boolean): number[] {
    if (!paired || firstSingle && page === 0) return [page];
    const offset = firstSingle ? 1 : 0;
    const first = offset + 2 * Math.floor((page - offset) / 2);
    return first + 1 < total ? [first, first + 1] : [first];
}

/** The source canvas owns overflow when a user explicitly chooses width/height. */
export function imageFrame(width: number, height: number, available: ImageFrame, fit: ImageFit): ImageFrame {
    let scale: number;
    switch (fit) {
        case 'width': scale = available.width / width; break;
        case 'height': scale = available.height / height; break;
        case 'contain': scale = Math.min(available.width / width, available.height / height); break;
    }
    const displayedWidth = width * scale;
    const displayedHeight = height * scale;
    return { x: available.x + Math.max(0, (available.width - displayedWidth) / 2),
        y: available.y + Math.max(0, (available.height - displayedHeight) / 2),
        width: displayedWidth, height: displayedHeight };
}

/** Pointer coordinates enter at the rendered image boundary. Letterboxing,
 * scroll and spread placement are removed before a normalized crop is admitted.
 */
export function imageCrop(start: PixelPoint, end: PixelPoint, frame: ImageFrame) {
    const left = Math.max(frame.x, Math.min(start.x, end.x));
    const top = Math.max(frame.y, Math.min(start.y, end.y));
    const right = Math.min(frame.x + frame.width, Math.max(start.x, end.x));
    const bottom = Math.min(frame.y + frame.height, Math.max(start.y, end.y));
    if (right <= left || bottom <= top) return null;
    return { x: (left - frame.x) / frame.width, y: (top - frame.y) / frame.height,
        width: (right - left) / frame.width, height: (bottom - top) / frame.height };
}

/** The current linguistic projection is bounded independently of page evidence. */
export function imageAnalysisWindow(page: {
    readonly regions: readonly Pick<OcrRegion, 'id' | 'text' | 'readingOf'>[];
}, offset: number) {
    const regions = page.regions.filter(region => !region.readingOf && region.text.length);
    const ids: string[] = [];
    let bytes = 0;
    for (const region of regions.slice(offset)) {
        const size = new TextEncoder().encode(region.text).length;
        if (ids.length === 16 || bytes + size > 4096) break;
        ids.push(region.id); bytes += size;
    }
    return { ids, total: regions.length,
        next: ids.length && offset + ids.length < regions.length ? offset + ids.length : null };
}

export function imageAnchor(source: DocumentRecord, page: OcrPage, pageIndex: number,
    region: OcrRegion, token: AnalyzedToken): SourceAnchor {
    return { sourceId: source.id, contentRevision: source.contentRevision,
        packageId: source.packageId, packageVersion: source.packageVersion, text: region.text,
        locator: { kind: 'image', resourceId: page.resourceId, pageIndex, ocrRevision: page.ocrRevision,
            regionId: region.id, contextStart: 0, selectionStart: token.start, selectionEnd: token.end } };
}

export function imageContext(page: OcrPage, region: OcrRegion) {
    return region.contextRegionIds?.length ? region.contextRegionIds.map(id =>
        page.regions.find(value => value.id === id)?.text ?? '').join('\n') : region.text;
}
