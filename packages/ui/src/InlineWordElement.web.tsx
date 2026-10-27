// An inline HTML button is the web text-rendering boundary: it preserves
// phrasing layout while providing browser keyboard activation and real focus.
import { useLayoutEffect, useRef } from 'react';
import type { InlineWordContentProps, InlineWordProps } from './InlineWord.types';
import { LevelStars } from './LevelStars.web';

/** Static ruby is the same inline source boundary without button semantics. */
export function DocumentWordContent(props: InlineWordContentProps) {
    let sourceOffset = props.sourceStart;
    const source = (segment: InlineWordContentProps['segments'][number]) => {
        if (sourceOffset === undefined) return segment.content ?? segment.text;
        const start = sourceOffset;
        sourceOffset += new TextEncoder().encode(segment.text).length;
        return <span data-source-start={start} data-source-end={sourceOffset}
            style={{ background: props.highlighted ? props.documentFlow?.selectionColor : undefined }}>{segment.content ?? segment.text}</span>;
    };
    return <span style={{ font: 'inherit', color: props.hiddenText ? 'transparent' : 'inherit', whiteSpace: 'pre-wrap' }}>
        {props.segments.map((segment, index) => segment.reading
            ? <ruby key={index} style={{ rubyPosition: 'over', rubyAlign: 'center' }}>
                {source(segment)}<rp>(</rp><rt title={segment.reading.attribution}
                    style={{ fontSize: '0.45em', lineHeight: 1, letterSpacing: '0.05em', fontWeight: 400 }}>
                    {segment.reading.text}
                </rt><rp>)</rp>
              </ruby>
            : <span key={index}>{source(segment)}</span>)}
    </span>;
}

export function InlineWordElement({ text, children, accessibilityLabel, status, onActivate, inspectionMode = 'click',
    documentFlow, color, knownColor, level, starCollapse }: InlineWordProps & { readonly color: string; readonly knownColor: string }) {
    const ref = useRef<HTMLButtonElement>(null);
    const entered = useRef(false);
    const activatedOnHover = useRef(false);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activation = useRef(onActivate);
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
      aria-label={accessibilityLabel ?? `${text}: ${status.replaceAll('_', ' ')}`}
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
        display: level ? 'inline-block' : 'inline', position: level ? 'relative' : undefined,
        maxWidth: '100%', border: 0, padding: documentFlow ? 0 : '0 1px', margin: 0, background: 'transparent', font: 'inherit', lineHeight: 'inherit', minHeight: documentFlow ? undefined : 44, cursor: 'pointer', color: status === 'claimed_known' || status === 'assessed_known' ? knownColor : color, textDecorationLine: status === 'claimed_unknown' || status === 'assessed_unknown' || status === 'mixed' ? 'underline' : 'none', textDecorationStyle: status === 'mixed' ? 'dotted' : 'solid'
    }}>{children ?? text}{level ? <LevelStars rank={level.rank} collapse={starCollapse} label={`${level.label}. ${level.attribution}`} /> : null}</button>;
}
