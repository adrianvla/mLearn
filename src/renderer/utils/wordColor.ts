import type { JSX } from 'solid-js';

/** Language palettes identify distinctions; theme ink keeps the word readable.
 * Resolve in CSS so an open encounter follows theme changes without a new lookup.
 * Store the expression as a custom property, including package-defined CSS colors.
 */
export function readableWordColorStyle(color: string): JSX.CSSProperties {
  return {
    '--language-word-ink': `color-mix(in srgb, ${color} 40%, var(--language-word-foreground))`,
    color: 'var(--language-word-ink)',
  };
}
