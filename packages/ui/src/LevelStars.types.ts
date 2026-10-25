export type LevelStarsSize = 'small' | 'medium' | 'large';
export type LevelStarsCollapse = 'auto' | 'always' | 'never';

/** All rectangles must use the same coordinate space, from the word-row owner. */
export interface LevelStarsRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LevelStarsLayout {
  readonly word: LevelStarsRect;
  readonly previous?: LevelStarsRect | null;
  readonly next?: LevelStarsRect | null;
}

export interface LevelStarsProps {
  /** Display rank, truncated and bounded to 0..7; zero renders nothing. */
  readonly rank: number;
  /** Accessible description supplied by the caller, not a language-specific label. */
  readonly label: string;
  readonly size?: LevelStarsSize;
  readonly collapse?: LevelStarsCollapse;
  /** Minimum gap retained between adjacent star rows; v2 app default is 8 px. */
  readonly margin?: number;
  /**
   * Native only: the word and its immediate siblings, updated by their row owner.
   * Omit for conservative, word-width-only auto collapse from the adornment's
   * onLayout. Missing siblings in a supplied layout mean an unbounded line edge,
   * exactly like web. Web measures its direct parent and ignores this prop.
   */
  readonly nativeLayout?: LevelStarsLayout;
}

// FrequencyStars.css and SubtitleWord.css at mlearn-ts 1ab95600bee9.
// These specialized adornment tokens are shared by both rendering boundaries.
export const LEVEL_STARS = {
  maxRank: 7, bottom: -10, padding: 5, glow: 10, margin: 8,
  baseColor: '#f00', opacity: 0.9, countWeight: '600',
  sizes: {
    small: { star: 6, count: 7 },
    medium: { star: 10, count: 9 },
    large: { star: 14, count: 12 },
  },
} as const;

// Native colors are the measured sRGB output of the corresponding CSS filter
// applied to #f00 (Chromium canvas, opaque interior pixel, before 0.9 opacity).
export const LEVEL_STAR_PALETTE = [
  { filter: 'hue-rotate(350deg) saturate(200%) brightness(170%)', color: '#ff0017' },
  { filter: 'hue-rotate(214deg) saturate(200%) brightness(170%)', color: '#0092ff' },
  { filter: 'hue-rotate(113.82deg) saturate(200%) brightness(150%)', color: '#00d300' },
  { filter: 'hue-rotate(60deg) saturate(200%) brightness(170%)', color: '#ff5a00' },
  { filter: 'hue-rotate(273deg) saturate(200%) brightness(170%)', color: '#ff00ff' },
  { filter: 'hue-rotate(57deg) saturate(200%) brightness(500%)', color: '#ffe600' },
  { filter: 'hue-rotate(57deg) saturate(0%) brightness(170%)', color: '#6e6e6e' },
] as const;

// Exact path from mlearn-ts/src/html/assets/icons/star.svg, not a font glyph.
export const LEVEL_STAR_PATH = 'M9.15316 5.40838C10.4198 3.13613 11.0531 2 12 2C12.9469 2 13.5802 3.13612 14.8468 5.40837L15.1745 5.99623C15.5345 6.64193 15.7144 6.96479 15.9951 7.17781C16.2757 7.39083 16.6251 7.4699 17.3241 7.62805L17.9605 7.77203'
  + 'C20.4201 8.32856 21.65 8.60682 21.9426 9.54773C22.2352 10.4886 21.3968 11.4691 19.7199 13.4299L19.2861 13.9372C18.8096 14.4944 18.5713 14.773 18.4641 15.1177C18.357 15.4624 18.393 15.8341 18.465 16.5776L18.5306 17.2544'
  + 'C18.7841 19.8706 18.9109 21.1787 18.1449 21.7602C17.3788 22.3417 16.2273 21.8115 13.9243 20.7512L13.3285 20.4768C12.6741 20.1755 12.3469 20.0248 12 20.0248C11.6531 20.0248 11.3259 20.1755 10.6715 20.4768L10.0757 20.7512'
  + 'C7.77268 21.8115 6.62118 22.3417 5.85515 21.7602C5.08912 21.1787 5.21588 19.8706 5.4694 17.2544L5.53498 16.5776C5.60703 15.8341 5.64305 15.4624 5.53586 15.1177C5.42868 14.773 5.19043 14.4944 4.71392 13.9372L4.2801 13.4299'
  + 'C2.60325 11.4691 1.76482 10.4886 2.05742 9.54773C2.35002 8.60682 3.57986 8.32856 6.03954 7.77203L6.67589 7.62805C7.37485 7.4699 7.72433 7.39083 8.00494 7.17781C8.28555 6.96479 8.46553 6.64194 8.82547 5.99623L9.15316 5.40838Z';

export function levelStarsRank(rank: number): number {
  return Math.min(LEVEL_STARS.maxRank, Math.max(0, Math.trunc(rank || 0)));
}

/** v2 deliberately treats a missing/off-line sibling as infinite clearance. */
export function levelStarsAvailableWidth({ word, previous, next }: LevelStarsLayout, margin = 0): number {
  const clearance = (sibling: LevelStarsRect | null | undefined, left: boolean) => {
    if (!sibling || Math.abs(sibling.y - word.y) > word.height / 2) return Infinity;
    const gap = left ? word.x - sibling.x - sibling.width : sibling.x - word.x - word.width;
    return Math.max(0, (gap - margin) / 2);
  };
  return word.width + clearance(previous, true) + clearance(next, false);
}

export function levelStarsCollapsed(mode: LevelStarsCollapse, needed: number, available: number): boolean {
  switch (mode) {
    case 'always': return true;
    case 'never': return false;
    case 'auto': return needed > available;
  }
}
