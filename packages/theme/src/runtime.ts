import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import type { ThemeDocument } from '@mlearn/contracts';
import { initialTheme, resolveTheme, type ResolvedTheme } from './theme';

declare module 'react-native-unistyles' {
  export interface UnistylesThemes { active: ResolvedTheme }
}

StyleSheet.configure({
  themes: { active: resolveTheme(initialTheme) },
  settings: { initialTheme: 'active' },
  breakpoints: { compact: 0, medium: 700, wide: 1100 },
});

/** Apply only an accepted document, or a clearly labelled unsaved preview. */
export function applyTheme(document: ThemeDocument): void {
  UnistylesRuntime.updateTheme('active', () => resolveTheme(document));
}
