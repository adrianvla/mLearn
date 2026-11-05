import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import type { ThemeDocument } from '@mlearn/contracts';
import { initialTheme, resolveTheme, type ResolvedTheme } from './theme';

const breakpoints = { compact: 0, medium: 700, wide: 1100 };
type Breakpoints = typeof breakpoints;
declare module 'react-native-unistyles' {
  export interface UnistylesThemes { active: ResolvedTheme }
  export interface UnistylesBreakpoints extends Breakpoints {}
}

StyleSheet.configure({
  themes: { active: resolveTheme(initialTheme) },
  // CSS-vars mode substitutes strings but drops theme listeners for literal
  // numbers. Recompute styles so accepted textScale and radius updates apply.
  settings: { initialTheme: 'active', CSSVars: false },
  breakpoints,
});

/** Apply only an accepted document, or a clearly labelled unsaved preview. */
export function applyTheme(document: ThemeDocument): void {
  UnistylesRuntime.updateTheme('active', () => resolveTheme(document));
}
