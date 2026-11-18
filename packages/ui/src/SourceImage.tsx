import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

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
const lensSize = 200;

/** Pixel-only source lens. It samples the already-decoded original page image
 * (the same element the reader shows) into its own canvas once per animation
 * frame and moves by transform: no bridge call, image decode or React render
 * per pointer move.
 */
export function DocumentImageLens({ viewport, images, identity, enabled, disabled, onActiveChange, display }: {
    readonly viewport: RefObject<HTMLDivElement | null>;
    readonly images: ReadonlyMap<string, HTMLImageElement>;
    readonly identity: string;
    readonly enabled: boolean;
    readonly disabled: boolean;
    readonly onActiveChange: (active: boolean) => void;
    readonly display: { readonly color: string; readonly background: string; readonly border: string;
        readonly caption: { readonly fontSize: number; readonly lineHeight: number; readonly fontWeight: string } };
}) {
    const [held, setHeld] = useState(false);
    const [zoom, setZoom] = useState(2);
    const [shown, setShown] = useState(false);
    const visible = useRef(false);
    const frame = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const pointer = useRef<Point | null>(null);
    const scheduled = useRef(0);
    const scale = useRef(2);
    const active = !disabled && (enabled || held);
    const current = useRef({ active, images, onActiveChange });
    current.current = { active, images, onActiveChange };
    function clear() {
        if (scheduled.current) cancelAnimationFrame(scheduled.current);
        scheduled.current = 0; visible.current = false; setShown(false);
    }
    function paint() {
        scheduled.current = 0;
        const point = pointer.current, node = frame.current, target = canvas.current;
        if (!current.current.active || !point || !node || !target) return;
        node.style.transform = `translate3d(${point.x - lensSize / 2}px,${point.y - lensSize / 2}px,0)`;
        const size = Math.ceil(lensSize * window.devicePixelRatio);
        if (target.width !== size) { target.width = size; target.height = size; }
        const context = target.getContext('2d');
        if (!context) return;
        context.fillStyle = '#666666'; context.fillRect(0, 0, size, size);
        const image = [...current.current.images.values()].find(candidate => {
            const bounds = candidate.getBoundingClientRect();
            return candidate.naturalWidth > 0 && bounds.width > 0 && bounds.height > 0 && point.x >= bounds.x
                && point.x <= bounds.right && point.y >= bounds.y && point.y <= bounds.bottom;
        });
        if (!image) return;
        const bounds = image.getBoundingClientRect();
        // The lens shows lensSize/scale CSS pixels of the page around the pointer,
        // sampled from the original's natural resolution.
        const span = lensSize / scale.current;
        const ratioX = image.naturalWidth / bounds.width, ratioY = image.naturalHeight / bounds.height;
        const sx = (point.x - bounds.x - span / 2) * ratioX, sy = (point.y - bounds.y - span / 2) * ratioY;
        const sw = span * ratioX, sh = span * ratioY;
        const left = Math.max(0, sx), top = Math.max(0, sy);
        const right = Math.min(image.naturalWidth, sx + sw), bottom = Math.min(image.naturalHeight, sy + sh);
        if (right <= left || bottom <= top) return;
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(image, left, top, right - left, bottom - top,
            (left - sx) / sw * size, (top - sy) / sh * size, (right - left) / sw * size, (bottom - top) / sh * size);
    }
    function request(point: Point) {
        pointer.current = point;
        if (!current.current.active) return;
        if (!visible.current) { visible.current = true; setShown(true); }
        if (!scheduled.current) scheduled.current = requestAnimationFrame(paint);
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
    useEffect(() => () => { if (scheduled.current) cancelAnimationFrame(scheduled.current); scheduled.current = 0; }, []);
    // First frame after the lens mounts: place and paint before the browser shows it.
    useLayoutEffect(() => { if (shown) paint(); }, [shown]);
    if (!active || !shown) return null;
    return <div ref={frame} role="img" aria-label="Source image magnifier" aria-busy={false}
        style={{ position: 'fixed', left: 0, top: 0, width: lensSize, height: lensSize, willChange: 'transform',
            borderRadius: '50%', overflow: 'hidden', pointerEvents: 'none', zIndex: 1000,
            border: `2px solid ${display.border}`, boxShadow: '0 4px 20px #00000080', boxSizing: 'border-box' }}>
        <canvas ref={canvas} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }} />
        <span style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap',
            padding: '2px 8px', borderRadius: 4, background: display.background, color: display.color,
            fontSize: display.caption.fontSize, lineHeight: `${display.caption.lineHeight}px`,
            fontWeight: display.caption.fontWeight === '700' ? 700 : 400 }}>
            {`${zoom.toFixed(1)}×`}
        </span>
        <span aria-hidden="true" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            color: '#FFFFFF', textShadow: '0 0 2px #000000' }}>+</span>
    </div>;
}
