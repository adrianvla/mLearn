'use dom';

import { useEffect, useLayoutEffect, useRef, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import type { DocumentAnalysisBatch, DocumentAppearance, DocumentBlock, DocumentFlow, DocumentPosition } from '@mlearn/contracts';
import { DocumentFigure, DocumentWord, InlineDocumentBlock, InlineWordContent, type InlineDocumentFlow, type TextAnchor, type TextBounds } from '@mlearn/ui/document';
import { blockKey, byteLength, documentSegments } from './documentFlow';

export type DocumentCanvasRef = {
    measure: DOMImperativeFactory[string];
    restoreFocus: () => void;
};
export type DocumentDisplay = InlineDocumentFlow & {
    readonly background: string;
    readonly muted: string;
    readonly selection: string;
    readonly fontFamily: string;
    readonly textScale: number;
    readonly caption: Parameters<typeof DocumentFigure>[0]['caption'];
};
export type DocumentImageView = { readonly resourceId: string; readonly uri: string | null; readonly error: string };
type Selection = { readonly resource: string; readonly blockId: string; readonly start: number; readonly end: number };

/** Specialist content boundary only. No runtime client, host APIs, stores,
 * language execution or native-module scripting bridge enter this WebView.
 */
export default function DocumentCanvas({ ref, identity, parserRevision, blocks, batch, appearance, target, inspecting,
    selection, images, display, onPosition, onInspect, onMeasured, onImageError, onThumbnail, onNavigate }: {
    readonly ref?: Ref<DocumentCanvasRef>;
    readonly dom?: DOMProps;
    readonly identity: string;
    readonly parserRevision: string;
    readonly blocks: DocumentBlock[];
    readonly batch: DocumentAnalysisBatch | null;
    readonly appearance: DocumentAppearance;
    readonly target: DocumentPosition | null;
    readonly inspecting: boolean;
    readonly selection: Selection | null;
    readonly images: DocumentImageView[];
    readonly display: DocumentDisplay;
    readonly onPosition: (identity: string, position: DocumentPosition, checkpoint: boolean) => Promise<void>;
    readonly onInspect: (identity: string, occurrence: number, resource: string, blockId: string, tokenStart: number, bounds: TextBounds) => Promise<void>;
    readonly onMeasured: (identity: string, occurrence: number, request: number, bounds: TextBounds) => Promise<void>;
    readonly onImageError: (identity: string, resourceId: string) => Promise<void>;
    readonly onThumbnail: (identity: string, resourceId: string, uri: string) => Promise<void>;
    readonly onNavigate: (identity: string, direction: 'previous' | 'next') => Promise<void>;
}) {
    const viewport = useRef<HTMLDivElement>(null);
    const nodes = useRef(new Map<string, HTMLDivElement>());
    const activeAnchor = useRef<TextAnchor | null>(null);
    const activeOccurrence = useRef(0);
    const stopAnchor = useRef<(() => void) | null>(null);
    const frame = useRef<number | null>(null);
    const callback = useRef(onPosition);
    callback.current = onPosition;
    const lastPosition = useRef(target);
    const pendingCheckpoint = useRef(false);

    useDOMImperativeHandle<DocumentCanvasRef>(ref ?? null, () => ({
        measure(request) {
            if (typeof request !== 'number') return;
            const occurrence = activeOccurrence.current;
            activeAnchor.current?.measure(bounds => { void onMeasured(identity, occurrence, request, bounds); });
        },
        restoreFocus() { activeAnchor.current?.restoreFocus(); },
    }), [identity, onMeasured]);
    useEffect(() => () => {
        stopAnchor.current?.();
        if (frame.current !== null) cancelAnimationFrame(frame.current);
    }, []);
    useEffect(() => {
        stopAnchor.current?.(); stopAnchor.current = null; activeAnchor.current = null;
    }, [identity]);
    useEffect(() => {
        if (!inspecting) { stopAnchor.current?.(); stopAnchor.current = null; }
    }, [inspecting]);

    function flow(block: DocumentBlock): DocumentFlow {
        switch (appearance.writingMode) {
            case 'auto': return block.writingMode ?? 'horizontal-tb';
            case 'horizontal': return 'horizontal-tb';
            case 'vertical': return 'vertical-rl';
        }
    }
    function visibleRect(rect: DOMRect, box: DOMRect) {
        return rect.width > 0 && rect.height > 0 && rect.bottom > box.top + 1 && rect.top < box.bottom - 1
            && rect.right > box.left + 1 && rect.left < box.right - 1;
    }
    /** Find the first actually visible source scalar, not the first token or
     * display column. Range subdivision avoids one DOM node per character.
     * Reading text is excluded by traversing source-marked leaves only.
     */
    function firstVisibleText(node: Element, box: DOMRect): { offset: number; element: HTMLElement } | null {
        for (const leaf of node.querySelectorAll<HTMLElement>('[data-source-start]')) {
            const text = leaf.firstChild;
            if (!(text instanceof globalThis.Text)) continue;
            const offsets = [0];
            let units = 0;
            for (const char of text.data) { units += char.length; offsets.push(units); }
            const range = document.createRange();
            const intersects = (start: number, end: number) => {
                range.setStart(text, offsets[start]); range.setEnd(text, offsets[end]);
                return [...range.getClientRects()].some(rect => visibleRect(rect, box));
            };
            let start = 0, end = offsets.length - 1;
            if (!end || !intersects(start, end)) continue;
            while (end - start > 1) {
                const middle = Math.floor((start + end) / 2);
                if (intersects(start, middle)) end = middle;
                else start = middle;
            }
            return { offset: Number(leaf.dataset.sourceStart) + byteLength(text.data.slice(0, offsets[start])), element: leaf };
        }
        return null;
    }
    function report(checkpoint: boolean) {
        pendingCheckpoint.current ||= checkpoint;
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = null;
            const container = viewport.current;
            if (!container) return;
            const box = container.getBoundingClientRect();
            for (const block of blocks) {
                const node = nodes.current.get(blockKey(block.resource, block.id));
                if (!node || !visibleRect(node.getBoundingClientRect(), box)) continue;
                const found = firstVisibleText(node, box);
                const point = { parserRevision, resource: block.resource, blockId: block.id, offset: found?.offset ?? 0 };
                lastPosition.current = point;
                const commit = pendingCheckpoint.current; pendingCheckpoint.current = false;
                void callback.current(identity, point, commit);
                return;
            }
            pendingCheckpoint.current = false;
        });
    }
    function restore(point: DocumentPosition | null) {
        if (!point) return;
        const container = viewport.current;
        const block = nodes.current.get(blockKey(point.resource, point.blockId));
        if (!container || !block) return;
        let rect = block.getBoundingClientRect();
        for (const leaf of block.querySelectorAll<HTMLElement>('[data-source-start]')) {
            if (point.offset === 0) break;
            const start = Number(leaf.dataset.sourceStart);
            const end = Number(leaf.dataset.sourceEnd);
            if (point.offset < start || point.offset >= end) continue;
            const text = leaf.firstChild;
            if (!(text instanceof globalThis.Text)) continue;
            let bytes = start, units = 0;
            for (const char of text.data) {
                if (bytes >= point.offset) break;
                bytes += byteLength(char); units += char.length;
            }
            const range = document.createRange();
            range.setStart(text, units);
            const scalar = text.data.codePointAt(units) ?? 0;
            range.setEnd(text, Math.min(text.length, units + (scalar > 0xffff ? 2 : 1)));
            rect = range.getBoundingClientRect();
            break;
        }
        const box = container.getBoundingClientRect();
        const source = blocks.find(item => item.resource === point.resource && item.id === point.blockId);
        container.scrollTop += rect.top - box.top - 24;
        container.scrollLeft += source && flow(source) === 'vertical-rl'
            ? rect.right - box.right + 24 : rect.left - box.left - 24;
    }
    const layoutKey = JSON.stringify([identity, blocks.map(block => [block.resource, block.id]), appearance, display.textScale,
        batch?.blocks.map(block => [block.resource, block.blockId, block.start, byteLength(block.text)])]);
    useLayoutEffect(() => {
        lastPosition.current = target;
        restore(target);
        const container = viewport.current;
        if (!container) return;
        const observer = new ResizeObserver(() => { restore(lastPosition.current); report(true); });
        observer.observe(container);
        return () => observer.disconnect();
    }, [layoutKey]);
    useEffect(() => {
        const container = viewport.current;
        if (!container) return;
        const finished = () => report(true);
        container.addEventListener('scrollend', finished);
        return () => container.removeEventListener('scrollend', finished);
    }, [layoutKey]);
    function activate(resource: string, blockId: string, start: number, anchor: TextAnchor) {
        stopAnchor.current?.();
        const occurrence = ++activeOccurrence.current;
        activeAnchor.current = anchor;
        stopAnchor.current = anchor.subscribe?.(() => anchor.measure(bounds => { void onMeasured(identity, occurrence, 0, bounds); })) ?? null;
        void onInspect(identity, occurrence, resource, blockId, start,
            { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height });
    }
    const firstFlow = blocks[0] ? flow(blocks[0]) : 'horizontal-tb';
    return <div ref={viewport} role="document" aria-label="Document text" tabIndex={0}
        onScroll={() => report(false)} onPointerUp={() => report(true)} onKeyUp={() => report(true)}
        onBlur={() => report(true)}
        onKeyDown={event => {
            if (event.target !== viewport.current || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.key === 'PageDown' || event.key === 'PageUp') {
                event.preventDefault();
                const container = viewport.current;
                if (!container) return;
                const direction = event.key === 'PageDown' ? 1 : -1;
                const horizontal = firstFlow !== 'horizontal-tb';
                const before = horizontal ? container.scrollLeft : container.scrollTop;
                container.scrollBy(horizontal
                    ? { left: direction * container.clientWidth * 0.85 * (firstFlow === 'vertical-rl' ? -1 : 1) }
                    : { top: direction * container.clientHeight * 0.85 });
                if (before === (horizontal ? container.scrollLeft : container.scrollTop))
                    void onNavigate(identity, direction === 1 ? 'next' : 'previous');
                report(true);
            }
        }}
        style={{ position: 'absolute', inset: 0, overflow: 'auto', background: display.background,
            color: display.color, padding: 24, boxSizing: 'border-box', overscrollBehavior: 'contain',
            writingMode: firstFlow, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {blocks.map(block => <div key={blockKey(block.resource, block.id)}
            ref={node => { const key = blockKey(block.resource, block.id); if (node) nodes.current.set(key, node); else nodes.current.delete(key); }}
            style={{ flexShrink: 0, minWidth: 0,
                width: flow(block) === 'horizontal-tb' ? '100%' : 'max-content',
                maxWidth: flow(block) === 'horizontal-tb' ? '100%' : undefined, writingMode: flow(block),
                height: flow(block) === 'horizontal-tb' ? undefined : '100%' }}>
            {block.image ? (() => {
                const image = images.find(item => item.resourceId === block.image?.resourceId);
                return <DocumentFigure uri={image?.uri ?? null} alt={block.image.alt} error={image?.error ?? ''}
                    caption={display.caption} muted={display.muted}
                    onLoad={() => { restore(lastPosition.current); report(true); }}
                    onError={() => { if (block.image) void onImageError(identity, block.image.resourceId); }}
                    onThumbnail={uri => { if (block.image) void onThumbnail(identity, block.image.resourceId, uri); }} />;
            })() : <InlineDocumentBlock appearance={appearance} flow={flow(block)} display={display} kind={block.kind} page={block.page}>
                <InlineWordContent documentFlow={display} segments={documentSegments(block, batch?.blocks ?? []).map(segment => ({
                    text: segment.text,
                    reading: segment.reading ? { text: segment.reading.text, attribution: 'Publisher-authored reading' } : undefined,
                    content: segment.phrases.map(phrase => {
                        const token = phrase.token;
                        const selected = selection?.resource === block.resource && selection.blockId === block.id
                            && phrase.start < selection.end && phrase.end > selection.start;
                        const source = <span data-source-start={phrase.start} data-source-end={phrase.end}
                            style={{ background: selected ? display.selection : undefined }}>{phrase.text}</span>;
                        if (!token?.targets.length) return <span key={phrase.start}>{source}</span>;
                        const status = batch?.annotations.find(item => item.resource === block.resource && item.blockId === block.id
                            && item.tokenStart === token.start)?.status ?? 'untracked';
                        // Authored readings wrap occurrences; inferred readings are
                        // displayed only on a whole uncovered token.
                        return <DocumentWord key={phrase.start} text={phrase.text} display={display} highlighted={selected}
                            presentation={!segment.reading && phrase.text === token.text ? token.presentation : undefined}
                            status={status} onActivate={anchor => activate(block.resource, block.id, token.start, anchor)}
                            sourceStart={phrase.start} />;
                    }),
                }))} />
                {!block.text ? <span role="status" style={{ color: display.muted }}>Text unavailable for this source block.</span> : null}
            </InlineDocumentBlock>}
        </div>)}
    </div>;
}
