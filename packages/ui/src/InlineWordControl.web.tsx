// An inline HTML button is the web text-rendering boundary: it preserves
// phrasing layout while providing browser keyboard activation and real focus.
import { useLayoutEffect, useRef } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import type { InlineWordProps } from './InlineWord.types';
export function InlineWordControl({ text, status, onActivate, inspectionMode = 'click', variant = 'subtitle' }: InlineWordProps) {
    const ref = useRef<HTMLButtonElement>(null);
    const entered = useRef(false);
    const activatedOnHover = useRef(false);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activation = useRef(onActivate);
    const { theme } = useUnistyles();
    useLayoutEffect(() => { activation.current = onActivate; }, [onActivate]);
    function cancelHoverTimer() {
        if (hoverTimer.current !== null) {
            clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
    }
    useLayoutEffect(() => () => {
        cancelHoverTimer();
        entered.current = false;
        activatedOnHover.current = false;
    }, [inspectionMode, text]);
    function activate() {
        const node = ref.current;
        if (node) {
            const r = node.getBoundingClientRect();
            activation.current({
                x: r.x, y: r.y, width: r.width, height: r.height,
                measure: publish => {
                    const current = ref.current;
                    if (current) {
                        const bounds = current.getBoundingClientRect();
                        publish({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
                    }
                },
                subscribe: onLayout => {
                    const observer = new ResizeObserver(onLayout);
                    // Caption viewport changes can move a word without resizing
                    // it. This subscription exists only while its panel is open.
                    for (let element: Element | null = node; element; element = element.parentElement)
                        observer.observe(element);
                    const onScroll = (event: Event) => {
                        if (event.target instanceof Node && event.target.contains(node)) onLayout();
                    };
                    node.ownerDocument.addEventListener('scroll', onScroll, true);
                    return () => {
                        observer.disconnect();
                        node.ownerDocument.removeEventListener('scroll', onScroll, true);
                    };
                },
                restoreFocus: () => ref.current?.focus()
            });
        }
    }
    function activateHover() {
        activatedOnHover.current = true;
        activate();
    }
    return <button
      ref={ref}
      type="button"
      aria-label={`${text}: ${status.replaceAll('_', ' ')}`}
      onPointerEnter={event => {
            if (event.pointerType !== 'mouse' || entered.current)
                return;
            entered.current = true;
            switch (inspectionMode) {
                case 'click': break;
                case 'immediate': activateHover(); break;
                case 'delayed':
                    hoverTimer.current = setTimeout(() => {
                        hoverTimer.current = null;
                        if (entered.current) activateHover();
                    }, 300);
                    break;
                // Shift is sampled at entry; no per-word global key listener.
                case 'modifier': if (event.shiftKey) activateHover(); break;
            }
        }}
      onPointerLeave={event => {
            if (event.pointerType !== 'mouse')
                return;
            cancelHoverTimer();
            entered.current = false;
            activatedOnHover.current = false;
        }}
      onPointerDown={event => {
            if (event.pointerType !== 'mouse') {
                cancelHoverTimer();
                activatedOnHover.current = false;
            }
        }}
      onClick={event => {
            cancelHoverTimer();
            // Keyboard/assistive clicks have detail 0; touch/pen presses clear
            // the mouse-hover latch above, so neither loses explicit activation.
            if (event.detail > 0 && activatedOnHover.current)
                return;
            activate();
        }}
      style={{
        display: 'inline', border: 0, padding: '0 1px', margin: 0, background: 'transparent', font: 'inherit', lineHeight: 'inherit', minHeight: 44, cursor: 'pointer', color: status === 'claimed_known' ? theme.colors.accent : variant === 'body' ? theme.colors.text : theme.media.text, textDecorationLine: status === 'claimed_unknown' || status === 'mixed' ? 'underline' : 'none', textDecorationStyle: status === 'mixed' ? 'dotted' : 'solid'
    }}>{text}</button>;
}
