import { useRef, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, type View } from 'react-native';
import { Button } from './Button';
import type { TextAnchor, TextBounds } from './InlineWord.types';

/** Compact dictionary content with the same focus/anchor contract as source words. */
export function DictionaryCard({ meaning, reading, onActivate, focusFallback }: {
    readonly meaning: string;
    readonly reading: string;
    readonly onActivate: (anchor: TextAnchor) => void;
    readonly focusFallback?: RefObject<View | null>;
}) {
    const ref = useRef<View>(null);
    const measure = (publish: (bounds: TextBounds) => void) =>
        ref.current?.measureInWindow((x, y, width, height) => publish({ x, y, width, height }));
    return <Button ref={ref} label={meaning} detail={reading} variant="dictionary" size="compact"
        accessibilityLabel={`${meaning} · ${reading}`}
        onPress={() => measure(bounds => onActivate({
            ...bounds, measure, restoreFocus: () => {
                const target = ref.current ?? focusFallback?.current;
                if (Platform.OS === 'web') target?.focus();
                else {
                    const tag = findNodeHandle(target ?? null);
                    if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
                }
            },
        }))} />;
}
