import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { OcrRect } from '@mlearn/contracts';

/** A cover changes presentation, never the underlying source or observation. */
export function DocumentReadingCover({ text }: { readonly text: string }) {
    const [hovered, setHovered] = useState(false);
    const [revealed, setRevealed] = useState(false);
    const visible = hovered || revealed;
    return <button type="button" aria-label={revealed ? `Hide reading annotation: ${text}` : 'Reveal reading annotation'}
        aria-pressed={revealed} title={visible ? text : undefined}
        onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }}
        onPointerLeave={() => setHovered(false)}
        onClick={() => { setHovered(false); setRevealed(value => !value); }}
        style={{ display: 'block', width: '100%', height: '100%', padding: 0, margin: 0, border: 0,
            background: visible ? 'transparent' : '#FFFFFF', cursor: 'help', pointerEvents: 'auto' }} />;
}

type Point = { readonly x: number; readonly y: number };
type Tile = { readonly uri: string; readonly destination: OcrRect; readonly serial: number };
type Desired = { readonly identity: string; readonly serial: number; readonly resourceId: string;
    readonly crop: OcrRect; readonly destination: OcrRect; readonly point: Point };
type Lens = { readonly point: Point; readonly tile: Tile | null; readonly pending: boolean; readonly failed: boolean };

/** Pixel-only source lens. Its bounded callback supplies original pixels, not
 * another DOM screenshot. Pointer work rerenders this owner, not source words.
 */
export function DocumentImageLens({ viewport, images, identity, enabled, disabled, pixels, onActiveChange, display }: {
    readonly viewport: RefObject<HTMLDivElement | null>;
    readonly images: ReadonlyMap<string, HTMLImageElement>;
    readonly identity: string;
    readonly enabled: boolean;
    readonly disabled: boolean;
    readonly pixels: (resourceId: string, crop: OcrRect) => Promise<string>;
    readonly onActiveChange: (active: boolean) => void;
    readonly display: { readonly color: string; readonly background: string; readonly border: string;
        readonly caption: { readonly fontSize: number; readonly lineHeight: number; readonly fontWeight: string } };
}) {
    const [held, setHeld] = useState(false);
    const [zoom, setZoom] = useState(2);
    const [lens, setLens] = useState<Lens | null>(null);
    const [painted, setPainted] = useState(0);
    const canvas = useRef<HTMLCanvasElement>(null);
    const pointer = useRef<Point | null>(null);
    const wanted = useRef<Desired | null>(null);
    const busy = useRef(false);
    const serial = useRef(0);
    const mounted = useRef(true);
    const scale = useRef(2);
    const active = !disabled && (enabled || held);
    const current = useRef({ identity, active, images, pixels, onActiveChange });
    current.current = { identity, active, images, pixels, onActiveChange };
    function clear() { serial.current++; wanted.current = null; setLens(null); }
    async function drain() {
        if (busy.current) return;
        busy.current = true;
        try {
            while (wanted.current && mounted.current) {
                const request = wanted.current; wanted.current = null;
                try {
                    const uri = await current.current.pixels(request.resourceId, request.crop);
                    if (mounted.current && current.current.active && request.identity === current.current.identity
                        && request.serial === serial.current)
                        setLens({ point: request.point, tile: { uri, destination: request.destination, serial: request.serial }, pending: false, failed: false });
                } catch {
                    if (mounted.current && current.current.active && request.identity === current.current.identity
                        && request.serial === serial.current)
                        setLens({ point: request.point, tile: null, pending: false, failed: true });
                }
            }
        } finally { busy.current = false; }
    }
    function request(point: Point) {
        pointer.current = point;
        if (!current.current.active) return;
        const sequence = ++serial.current;
        wanted.current = null;
        const source = [...current.current.images].find(([, image]) => {
            const bounds = image.getBoundingClientRect();
            return image.naturalWidth > 0 && bounds.width > 0 && bounds.height > 0 && point.x >= bounds.x && point.x <= bounds.right
                && point.y >= bounds.y && point.y <= bounds.bottom;
        });
        if (!source) { setLens({ point, tile: null, pending: false, failed: false }); return; }
        const [resourceId, image] = source;
        const bounds = image.getBoundingClientRect();
        const width = 200 / bounds.width / scale.current, height = 200 / bounds.height / scale.current;
        const x = (point.x - bounds.x) / bounds.width - width / 2;
        const y = (point.y - bounds.y) / bounds.height - height / 2;
        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(1, x + width), bottom = Math.min(1, y + height);
        const crop = { x: left, y: top, width: right - left, height: bottom - top };
        const destination = { x: (left - x) / width, y: (top - y) / height,
            width: crop.width / width, height: crop.height / height };
        wanted.current = { identity: current.current.identity, serial: sequence, resourceId, crop, destination, point };
        setLens({ point, tile: null, pending: true, failed: false });
        void drain();
    }
    useEffect(() => {
        current.current.onActiveChange(active);
        scale.current = 2; setZoom(2);
        if (!active) clear();
        else if (pointer.current) request(pointer.current);
    }, [active, identity]);
    useEffect(() => {
        const node = viewport.current;
        if (!node) return;
        const editable = (target: EventTarget | null) => target instanceof Element
            && !!target.closest('input,textarea,select,[contenteditable="true"]');
        const down = (event: KeyboardEvent) => {
            if (!disabled && !event.repeat && event.key.toLowerCase() === 'z' && !event.ctrlKey && !event.altKey
                && !event.shiftKey && !event.metaKey && !editable(event.target)) {
                event.preventDefault(); setHeld(true);
            }
        };
        const up = (event: KeyboardEvent) => { if (event.key.toLowerCase() === 'z') setHeld(false); };
        const release = () => { setHeld(false); clear(); };
        const move = (event: PointerEvent) => request({ x: event.clientX, y: event.clientY });
        const start = (event: PointerEvent) => {
            if (!current.current.active) return;
            if (event.pointerType !== 'mouse') {
                node.setPointerCapture(event.pointerId); event.preventDefault();
            }
            request({ x: event.clientX, y: event.clientY });
        };
        const end = (event: PointerEvent) => {
            if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
        };
        const wheel = (event: WheelEvent) => {
            if (!current.current.active) return;
            event.preventDefault();
            scale.current = Math.max(1.5, Math.min(6, scale.current + (event.deltaY > 0 ? -0.25 : 0.25)));
            setZoom(scale.current);
            if (pointer.current) request(pointer.current);
        };
        window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release);
        document.addEventListener('visibilitychange', release);
        node.addEventListener('pointermove', move); node.addEventListener('pointerdown', start, true);
        node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end);
        node.addEventListener('wheel', wheel, { passive: false });
        return () => {
            window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release);
            document.removeEventListener('visibilitychange', release);
            node.removeEventListener('pointermove', move); node.removeEventListener('pointerdown', start, true);
            node.removeEventListener('pointerup', end); node.removeEventListener('pointercancel', end);
            node.removeEventListener('wheel', wheel);
        };
    }, [viewport, identity, disabled]);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; wanted.current = null; }; }, []);
    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element || !lens) return;
        const size = Math.ceil(200 * window.devicePixelRatio);
        element.width = size; element.height = size;
        const context = element.getContext('2d');
        if (!context) return;
        context.fillStyle = '#666666'; context.fillRect(0, 0, size, size);
        setPainted(0);
        if (!lens.tile) return;
        let live = true;
        const image = new Image();
        image.onload = () => {
            if (!live) return;
            const box = lens.tile!.destination;
            context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
            context.drawImage(image, box.x * size, box.y * size, box.width * size, box.height * size);
            setPainted(lens.tile!.serial);
        };
        image.onerror = () => { if (live) setLens(value => value ? { ...value, tile: null, failed: true } : value); };
        image.src = lens.tile.uri;
        return () => { live = false; image.onload = null; image.onerror = null; };
    }, [lens]);
    if (!active || !lens) return null;
    const pending = lens.pending || !!lens.tile && painted !== lens.tile.serial;
    return <div role="img" aria-label="Source image magnifier" aria-busy={pending}
        style={{ position: 'fixed', left: lens.point.x - 100, top: lens.point.y - 100, width: 200, height: 200,
            borderRadius: '50%', overflow: 'hidden', pointerEvents: 'none', zIndex: 1000,
            border: `2px solid ${display.border}`, boxShadow: '0 4px 20px #00000080', boxSizing: 'border-box' }}>
        <canvas ref={canvas} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }} />
        <span style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap',
            padding: '2px 8px', borderRadius: 4, background: display.background, color: display.color,
            fontSize: display.caption.fontSize, lineHeight: `${display.caption.lineHeight}px`,
            fontWeight: display.caption.fontWeight === '700' ? 700 : 400 }}>
            {pending ? 'Loading pixels…' : lens.failed ? 'Pixels unavailable' : `${zoom.toFixed(1)}×`}
        </span>
        <span aria-hidden="true" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            color: '#FFFFFF', textShadow: '0 0 2px #000000' }}>+</span>
    </div>;
}
