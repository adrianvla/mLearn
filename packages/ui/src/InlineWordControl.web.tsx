// An inline HTML button is the web text-rendering boundary: it preserves
// phrasing layout while providing browser keyboard activation and real focus.
import { useLayoutEffect, useRef } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import type { InlineWordContentProps, InlineWordProps } from './InlineWord.types';
import { PronunciationReading } from './PronunciationReading';

/** Static ruby is the same inline source boundary without button semantics. */
export function InlineWordContent({ segments, variant = 'body', status }: InlineWordContentProps) {
    const { theme } = useUnistyles();
    const { _web: sourceWeb, ...source } = theme.typography[variant];
    const { _web: rubyWeb, ...ruby } = theme.typography[
        variant === 'subtitle' ? 'subtitleRuby' : variant === 'inspectionTitle' ? 'inspectionRuby' : 'bodyRuby'
    ];
    return <span style={{
        ...source, ...sourceWeb, lineHeight: `${source.lineHeight}px`,
        color: status === 'claimed_known' || status === 'assessed_known' ? theme.feedback.success : variant === 'body' ? theme.colors.text : theme.media.text,
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        ...(variant === 'subtitle' ? { textShadow: `0 1px 4px ${theme.media.background}` } : {}),
    }}>{segments.map((segment, index) => segment.reading ? <ruby key={index} style={{
        display: 'inline-flex', flexDirection: 'column-reverse', alignItems: 'center', maxWidth: '100%', verticalAlign: 'bottom',
    }}>
        <span style={{ minWidth: 0, width: '100%', maxWidth: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{segment.reading.base ?? segment.text}</span><rp>(</rp><rt style={{
            ...ruby, ...rubyWeb, display: 'block', maxWidth: '100%', lineHeight: `${ruby.lineHeight}px`,
        }} title={segment.reading.attribution}>
            {segment.contour ? <PronunciationReading contour={segment.contour}
                variant={variant === 'subtitle' ? 'subtitleRuby' : variant === 'inspectionTitle' ? 'inspectionRuby' : 'bodyRuby'} /> : segment.reading.text}
        </rt><rp>)</rp>
    </ruby> : segment.contour ? <PronunciationReading key={index} contour={segment.contour}
        color={status === 'claimed_known' || status === 'assessed_known' ? theme.feedback.success : undefined}
        variant={variant === 'inspectionTitle' ? 'inspectionReading' : variant} /> : segment.text)}</span>;
}

export function InlineWordControl({ text, children, accessibilityLabel, status, onActivate, inspectionMode = 'click', variant = 'subtitle' }: InlineWordProps) {
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
        display: 'inline', maxWidth: '100%', border: 0, padding: '0 1px', margin: 0, background: 'transparent', font: 'inherit', lineHeight: 'inherit', minHeight: 44, cursor: 'pointer', color: status === 'claimed_known' || status === 'assessed_known' ? theme.feedback.success : variant === 'body' ? theme.colors.text : theme.media.text, textDecorationLine: status === 'claimed_unknown' || status === 'assessed_unknown' || status === 'mixed' ? 'underline' : 'none', textDecorationStyle: status === 'mixed' ? 'dotted' : 'solid'
    }}>{children ?? text}</button>;
}
