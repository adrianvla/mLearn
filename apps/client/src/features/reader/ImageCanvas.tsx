'use dom';

import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import type { ImageReaderSettings, OcrAnalysisBatch, OcrPage, OcrRect, OcrRegion } from '@mlearn/contracts';
import { DocumentImageLens, DocumentReadingCover, DocumentWord, InlineWordContent, type InlineDocumentFlow, type TextAnchor, type TextBounds } from '@mlearn/ui/document';
import { imageCrop, imageFrame } from './imageFlow';

export type ImageCanvasRef = { measure: DOMImperativeFactory[string]; restoreFocus: () => void };
export type ImageCanvasPage = { readonly resourceId: string; readonly index: number;
    readonly page: OcrPage | null; readonly batch: Pick<OcrAnalysisBatch, 'regions' | 'annotations'> | null };
export type ImageSelection = { readonly resourceId: string; readonly ocrRevision: number; readonly regionId: string;
    readonly start: number; readonly end: number };
type Display = InlineDocumentFlow & { readonly background: string; readonly fontFamily: string;
    readonly lens: Parameters<typeof DocumentImageLens>[0]['display'] };
type Natural = { readonly width: number; readonly height: number };
type Drag = { readonly resourceId: string; readonly pointer: number; readonly x: number; readonly y: number };

/** Original pixels and source-local geometry live in this narrow rendering
 * boundary. Native OCR, package interpretation and Knowledge never run here.
 */
export default function ImageCanvas({ ref, identity, sourceIdentity, pages, settings, cropMode, magnifier, selection, display,
    onReady, onImage, onInspect, onMeasured, onCrop, onMagnify, onMagnifierActive, onImageError, onThumbnail, onNavigate }: {
    readonly ref?: Ref<ImageCanvasRef>;
    readonly dom?: DOMProps;
    readonly identity: string;
    readonly sourceIdentity: string;
    readonly pages: readonly ImageCanvasPage[];
    readonly settings: ImageReaderSettings;
    readonly cropMode: boolean;
    readonly magnifier: boolean;
    readonly selection: ImageSelection | null;
    readonly display: Display;
    readonly onReady: (identity: string) => Promise<void>;
    readonly onImage: (sourceIdentity: string, resourceId: string) => Promise<string>;
    readonly onInspect: (identity: string, occurrence: number, resourceId: string, regionId: string,
        tokenStart: number, bounds: TextBounds) => Promise<void>;
    readonly onMeasured: (identity: string, occurrence: number, request: number, bounds: TextBounds) => Promise<void>;
    readonly onCrop: (identity: string, resourceId: string, crop: OcrRect) => Promise<void>;
    readonly onMagnify: (sourceIdentity: string, resourceId: string, crop: OcrRect) => Promise<string>;
    readonly onMagnifierActive: (identity: string, active: boolean) => Promise<void>;
    readonly onImageError: (identity: string, resourceId: string) => Promise<void>;
    readonly onThumbnail: (identity: string, resourceId: string, uri: string) => Promise<void>;
    readonly onNavigate: (identity: string, direction: 'previous' | 'next') => Promise<void>;
}) {
    const root = useRef<HTMLDivElement>(null);
    const images = useRef(new Map<string, HTMLImageElement>());
    const [pixels, setPixels] = useState<{ key: string; uris: Record<string, string> }>({ key: '', uris: {} });
    const [natural, setNatural] = useState<Record<string, Natural>>({});
    const [size, setSize] = useState<Natural>({ width: 1, height: 1 });
    const anchor = useRef<TextAnchor | null>(null);
    const occurrence = useRef(0);
    const unsubscribe = useRef<(() => void) | null>(null);
    const drag = useRef<Drag | null>(null);
    const [crop, setCrop] = useState<{ resourceId: string; rect: OcrRect } | null>(null);
    const [lensActive, setLensActive] = useState(false);
    const measurement = useRef<HTMLCanvasElement | null>(null);
    const imageCallbacks = useRef({ onImage, onImageError, identity });
    imageCallbacks.current = { onImage, onImageError, identity };
    const pixelKey = JSON.stringify([sourceIdentity, pages.map(page => page.resourceId)]);
    useEffect(() => {
        let live = true;
        setPixels({ key: pixelKey, uris: {} }); setNatural({});
        // Pixel data crosses the bridge once per visible source, never again
        // for an Inspector, Knowledge or OCR projection update.
        void (async () => {
            for (const page of pages) {
                try {
                    const uri = await imageCallbacks.current.onImage(sourceIdentity, page.resourceId);
                    if (live) setPixels(value => value.key === pixelKey
                        ? { key: pixelKey, uris: { ...value.uris, [page.resourceId]: uri } } : value);
                } catch {
                    if (live) void imageCallbacks.current.onImageError(imageCallbacks.current.identity, page.resourceId);
                }
                if (!live) break;
            }
        })();
        return () => { live = false; };
    }, [pixelKey]);
    useDOMImperativeHandle<ImageCanvasRef>(ref ?? null, () => ({
        measure(request) {
            if (typeof request !== 'number') return;
            const selected = occurrence.current;
            anchor.current?.measure(bounds => { void onMeasured(identity, selected, request, bounds); });
        },
        restoreFocus() { anchor.current?.restoreFocus(); },
    }), [identity, onMeasured]);
    useLayoutEffect(() => {
        const node = root.current;
        if (!node) return;
        const observer = new ResizeObserver(() => setSize({ width: node.clientWidth, height: node.clientHeight }));
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        anchor.current = null; unsubscribe.current?.(); unsubscribe.current = null;
        drag.current = null; setCrop(null);
        return () => { unsubscribe.current?.(); };
    }, [identity, cropMode]);
    useEffect(() => {
        if (pages.length && pages.every(page => images.current.get(page.resourceId)?.complete
            && (images.current.get(page.resourceId)?.naturalWidth ?? 0) > 0))
            void onReady(identity);
    }, [identity, natural, size, pages.length]);

    function activate(resourceId: string, regionId: string, start: number, selected: TextAnchor) {
        unsubscribe.current?.();
        anchor.current = selected;
        const count = ++occurrence.current;
        unsubscribe.current = selected.subscribe?.(() => selected.measure(bounds => {
            void onMeasured(identity, count, 0, bounds);
        })) ?? null;
        void onInspect(identity, count, resourceId, regionId, start, selected);
    }
    function textStyle(region: OcrRegion, width: number, height: number) {
        const vertical = region.orientation === 'topToBottom' || region.orientation?.startsWith('vertical') === true;
        const count = Math.max(1, Array.from(region.text).length);
        let fontSize = vertical ? Math.min(width, height / count) : height;
        if (!vertical) {
            measurement.current ??= document.createElement('canvas');
            const context = measurement.current.getContext('2d');
            if (context) {
                context.font = `${fontSize}px ${display.fontFamily}`;
                const measured = context.measureText(region.text).width;
                if (measured > width) fontSize *= width / measured;
            }
        }
        return { fontSize: Math.max(0.5, fontSize), writingMode: vertical
            ? region.orientation === 'vertical-lr' ? 'vertical-lr' as const : 'vertical-rl' as const
            : 'horizontal-tb' as const };
    }
    function regionFrame(region: OcrRegion, frameWidth: number, frameHeight: number) {
        const { topLeft: a, topRight: b, bottomRight: c, bottomLeft: d } = region.quad;
        const vx = { x: (b.x - a.x) * frameWidth, y: (b.y - a.y) * frameHeight };
        const vy = { x: (d.x - a.x) * frameWidth, y: (d.y - a.y) * frameHeight };
        const width = Math.hypot(vx.x, vx.y), height = Math.hypot(vy.x, vy.y);
        const determinant = vx.x * vy.y - vx.y * vy.x;
        if (width < 0.5 || height < 0.5 || Math.abs(determinant) < 0.25) return null;
        const cx = (c.x - a.x) * frameWidth, cy = (c.y - a.y) * frameHeight;
        const endX = (cx * vy.y - cy * vy.x) / determinant * width;
        const endY = (vx.x * cy - vx.y * cx) / determinant * height;
        return { width, height, style: { position: 'absolute' as const, left: a.x * frameWidth, top: a.y * frameHeight,
            width, height, transformOrigin: '0 0',
            transform: `matrix(${vx.x / width},${vx.y / width},${vy.x / height},${vy.y / height},0,0)`,
            clipPath: `polygon(0 0,${width}px 0,${endX}px ${endY}px,0 ${height}px)` } };
    }
    const ordered = settings.direction === 'rtl' ? [...pages].reverse() : pages;
    const gap = settings.collate ? 0 : 8;
    const availableWidth = Math.max(1, (size.width - gap * Math.max(0, pages.length - 1)) / Math.max(1, pages.length));
    const frames = ordered.map(page => {
        const dimensions = natural[page.resourceId] ?? { width: 1, height: 1 };
        const frame = imageFrame(dimensions.width, dimensions.height,
            { x: 0, y: 0, width: availableWidth, height: Math.max(1, size.height) }, settings.fit);
        return { page, frame };
    });
    return <div ref={root} role="document" aria-label="Image pages" tabIndex={0}
        onKeyDown={event => {
            if (event.target instanceof Element && event.target.closest('button,input,select,textarea')) return;
            const next = event.key === 'PageDown' || event.key === (settings.direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
            const previous = event.key === 'PageUp' || event.key === (settings.direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft');
            if (next || previous) { event.preventDefault(); void onNavigate(identity, next ? 'next' : 'previous'); }
        }}
        style={{ position: 'absolute', inset: 0, overflow: 'auto', background: display.background,
            color: display.color, fontFamily: display.fontFamily, overscrollBehavior: 'contain' }}>
        <div style={{ display: 'flex', minWidth: '100%', minHeight: '100%', width: 'max-content', alignItems: 'flex-start',
            gap }}>
            {frames.map(({ page, frame }) => <div key={page.resourceId}
                style={{ position: 'relative', flex: 'none', width: Math.max(availableWidth, frame.width),
                    height: Math.max(size.height, frame.height) }}>
                <div data-source-image={page.resourceId}
                    style={{ position: 'absolute', left: frame.x, top: frame.y, width: frame.width, height: frame.height,
                    overflow: 'hidden', touchAction: cropMode ? 'none' : 'auto', cursor: cropMode ? 'crosshair' : 'auto' }}
                    onPointerDown={event => {
                        if (!cropMode || event.button !== 0) return;
                        const bounds = event.currentTarget.getBoundingClientRect();
                        drag.current = { resourceId: page.resourceId, pointer: event.pointerId,
                            x: (event.clientX - bounds.x) / bounds.width, y: (event.clientY - bounds.y) / bounds.height };
                        event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
                    }}
                    onPointerMove={event => {
                        const start = drag.current;
                        if (!start || start.resourceId !== page.resourceId || start.pointer !== event.pointerId) return;
                        const bounds = event.currentTarget.getBoundingClientRect();
                        const rect = imageCrop({ x: bounds.x + start.x * bounds.width, y: bounds.y + start.y * bounds.height },
                            { x: event.clientX, y: event.clientY }, bounds);
                        setCrop(rect ? { resourceId: page.resourceId, rect } : null);
                    }}
                    onPointerUp={event => {
                        const start = drag.current;
                        if (!start || start.pointer !== event.pointerId) return;
                        drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
                        const bounds = event.currentTarget.getBoundingClientRect();
                        const rect = imageCrop({ x: bounds.x + start.x * bounds.width, y: bounds.y + start.y * bounds.height },
                            { x: event.clientX, y: event.clientY }, bounds);
                        if (rect && rect.width * bounds.width >= 3 && rect.height * bounds.height >= 3) {
                            setCrop({ resourceId: page.resourceId, rect }); void onCrop(identity, page.resourceId, rect);
                        }
                    }}
                    onPointerCancel={() => { drag.current = null; setCrop(null); }}>
                    <img ref={node => { if (node) images.current.set(page.resourceId, node); else images.current.delete(page.resourceId); }}
                        src={pixels.key === pixelKey ? pixels.uris[page.resourceId] : undefined}
                        alt={`Page ${page.index + 1}`} draggable={false}
                        onLoad={event => {
                            const node = event.currentTarget;
                            setNatural(value => ({ ...value, [page.resourceId]: { width: node.naturalWidth, height: node.naturalHeight } }));
                            const preview = document.createElement('canvas');
                            const scale = Math.min(1, 128 / node.naturalWidth, 160 / node.naturalHeight);
                            preview.width = Math.max(1, Math.round(node.naturalWidth * scale));
                            preview.height = Math.max(1, Math.round(node.naturalHeight * scale));
                            const context = preview.getContext('2d');
                            if (context) {
                                context.drawImage(node, 0, 0, preview.width, preview.height);
                                void onThumbnail(identity, page.resourceId, preview.toDataURL('image/png'));
                            }
                        }} onError={() => { void onImageError(identity, page.resourceId); }}
                        style={{ display: 'block', width: '100%', height: '100%', userSelect: 'none',
                            visibility: natural[page.resourceId] ? 'visible' : 'hidden' }} />
                    {settings.showOverlay && natural[page.resourceId] && !cropMode && !lensActive ? page.page?.regions.filter(region => !region.readingOf).map(region => {
                        const geometry = regionFrame(region, frame.width, frame.height);
                        if (!geometry) return null;
                        const analyzed = page.batch?.regions.find(item => item.regionId === region.id);
                        return <div key={region.id} data-ocr-region={region.id}
                            style={{ ...geometry.style, whiteSpace: 'pre', lineHeight: 1,
                                ...textStyle(region, geometry.width, geometry.height) }}>
                            {analyzed?.tokens.map(token => {
                                const selected = selection?.resourceId === page.resourceId && selection.ocrRevision === page.page?.ocrRevision
                                    && selection.regionId === region.id && token.end > selection.start && token.start < selection.end;
                                return token.targets.length ? <DocumentWord key={token.start} text={token.text} presentation={null}
                                    hiddenText display={display} sourceStart={token.start} highlighted={selected}
                                    status={page.batch?.annotations.find(item => item.regionId === region.id && item.tokenStart === token.start)?.status ?? 'pending'}
                                    onActivate={value => activate(page.resourceId, region.id, token.start, value)} />
                                    : <span key={token.start} style={{ color: 'transparent' }}><InlineWordContent
                                        segments={[{ text: token.text }]} documentFlow={display} sourceStart={token.start} highlighted={selected} /></span>;
                            })}
                        </div>;
                    }) : null}
                    {settings.showOverlay && natural[page.resourceId] && !cropMode
                        ? page.page?.regions.filter(region => region.readingOf).map(region => {
                            const geometry = regionFrame(region, frame.width, frame.height);
                            return geometry ? <div key={region.id} data-ocr-reading={region.id}
                                style={{ ...geometry.style, pointerEvents: 'none' }}>
                                {!settings.showAnnotations ? <DocumentReadingCover text={region.text} /> : null}
                            </div> : null;
                        }) : null}
                    {crop?.resourceId === page.resourceId ? <div aria-hidden="true" style={{
                        position: 'absolute', pointerEvents: 'none', left: `${crop.rect.x * 100}%`, top: `${crop.rect.y * 100}%`,
                        width: `${crop.rect.width * 100}%`, height: `${crop.rect.height * 100}%`,
                        boxSizing: 'border-box', border: `2px solid ${display.selectionColor}`, background: 'rgba(255,255,255,0.15)',
                    }} /> : null}
                </div>
            </div>)}
        </div>
        <DocumentImageLens viewport={root} images={images.current} identity={pixelKey} enabled={magnifier} disabled={cropMode}
            pixels={(resourceId, crop) => onMagnify(sourceIdentity, resourceId, crop)} display={display.lens}
            onActiveChange={active => { setLensActive(active); void onMagnifierActive(identity, active); }} />
    </div>;
}
