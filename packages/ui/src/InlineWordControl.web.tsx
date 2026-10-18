// An inline HTML button is the web text-rendering boundary: it preserves
// phrasing layout while providing browser keyboard activation and real focus.
import { useRef } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import type { TextAnchor } from './InlineWord.types';
export function InlineWordControl({ text, status, onActivate }: {
    text: string;
    status: string;
    onActivate: (anchor: TextAnchor) => void;
}) {
    const ref = useRef<HTMLButtonElement>(null);
    const { theme } = useUnistyles();
    return <button
      ref={ref}
      type="button"
      aria-label={`${text}: ${status.replaceAll('_', ' ')}`}
      onClick={() => {
            const node = ref.current;
            if (node) {
                const r = node.getBoundingClientRect();
                onActivate({
                    x: r.x, y: r.y, width: r.width, height: r.height,
                    measure: publish => {
                        const current = ref.current;
                        if (current) {
                            const bounds = current.getBoundingClientRect();
                            publish({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
                        }
                    },
                    restoreFocus: () => ref.current?.focus()
                });
            }
        }}
      style={{
        display: 'inline', border: 0, padding: '0 1px', margin: 0, background: 'transparent', font: 'inherit', lineHeight: 'inherit', minHeight: 44, cursor: 'pointer', color: status === 'claimed_known' ? theme.colors.accent : theme.media.text, textDecorationLine: status === 'claimed_unknown' || status === 'mixed' ? 'underline' : 'none', textDecorationStyle: status === 'mixed' ? 'dotted' : 'solid'
    }}>{text}</button>;
}
