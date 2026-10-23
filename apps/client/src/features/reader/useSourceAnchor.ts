import { useEffect, useRef, type RefObject } from 'react';
import { Platform, type View } from 'react-native';
import type { TextAnchor, TextBounds } from '@mlearn/ui/inline-word';

type Canvas = { readonly measure: (request: number) => unknown; readonly restoreFocus: () => void };

/** The one native/DOM coordinate and lifetime boundary for Reader source words. */
export function useSourceAnchor(identity: string, container: RefObject<View | null>, canvas: RefObject<Canvas | null>) {
    const active = useRef(identity); active.current = identity;
    const occurrence = useRef(0);
    const subscribers = useRef(new Set<() => void>());
    const measurements = useRef(new Map<number, (bounds: TextBounds) => void>());
    const sequence = useRef(0);
    useEffect(() => {
        active.current = identity;
        measurements.current.clear(); subscribers.current.clear();
        return () => {
            // A new render has already fenced old callbacks. Do not let the
            // preceding passive cleanup erase that identity before a child's
            // ready effect publishes unchanged source pixels for the new OCR.
            if (active.current === identity) active.current = '';
            measurements.current.clear(); subscribers.current.clear();
        };
    }, [identity]);
    function adapt(bounds: TextBounds, publish: (bounds: TextBounds) => void) {
        if (Platform.OS === 'web') publish(bounds);
        else container.current?.measureInWindow((x, y) => {
            if (active.current === identity) publish({ ...bounds, x: x + bounds.x, y: y + bounds.y });
        });
    }
    function anchor(bounds: TextBounds): TextAnchor {
        const selected = occurrence.current;
        const owns = () => active.current === identity && occurrence.current === selected;
        return {
            ...bounds,
            measure: publish => {
                if (!owns()) return;
                measurements.current.clear();
                const request = ++sequence.current;
                measurements.current.set(request, publish);
                canvas.current?.measure(request);
            },
            subscribe: listener => {
                if (!owns()) return () => {};
                subscribers.current.add(listener);
                return () => { subscribers.current.delete(listener); measurements.current.clear(); };
            },
            restoreFocus: () => { if (owns()) canvas.current?.restoreFocus(); },
        };
    }
    function notify() { for (const listener of subscribers.current) listener(); }
    return {
        active, notify,
        activate(selected: number, bounds: TextBounds, publish: (anchor: TextAnchor) => void) {
            occurrence.current = selected;
            adapt(bounds, measured => {
                if (occurrence.current === selected) publish(anchor(measured));
            });
        },
        measured(selected: number, request: number, bounds: TextBounds) {
            if (active.current !== identity || occurrence.current !== selected) return;
            adapt(bounds, measured => {
                if (occurrence.current !== selected) return;
                if (request === 0) notify();
                else {
                    const publish = measurements.current.get(request);
                    measurements.current.delete(request); publish?.(measured);
                }
            });
        },
    };
}
