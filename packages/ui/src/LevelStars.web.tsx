import { useLayoutEffect, useRef, useState } from 'react';
import {
  LEVEL_STARS, LEVEL_STAR_PALETTE, LEVEL_STAR_PATH,
  levelStarsRank, levelStarsAvailableWidth, levelStarsCollapsed,
} from './LevelStars.types';
import type { LevelStarsProps, LevelStarsRect } from './LevelStars.types';

const resizeCallbacks = new Map<Element, Set<() => void>>();
let resizeObserver: ResizeObserver | undefined;

function observeResize(element: Element, callback: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  resizeObserver ??= new ResizeObserver(entries => {
    const pending = new Set<() => void>();
    for (const entry of entries) {
      for (const notify of resizeCallbacks.get(entry.target) ?? []) pending.add(notify);
    }
    for (const notify of pending) notify();
  });
  let callbacks = resizeCallbacks.get(element);
  if (!callbacks) {
    callbacks = new Set();
    resizeCallbacks.set(element, callbacks);
    resizeObserver.observe(element);
  }
  callbacks.add(callback);
  return () => {
    const current = resizeCallbacks.get(element);
    current?.delete(callback);
    if (current?.size === 0) {
      resizeCallbacks.delete(element);
      resizeObserver?.unobserve(element);
    }
    if (resizeCallbacks.size === 0) {
      resizeObserver?.disconnect();
      resizeObserver = undefined;
    }
  };
}

function rectangle(element: Element | null): LevelStarsRect | null {
  if (!element) return null;
  const { left, top, width, height } = element.getBoundingClientRect();
  return { x: left, y: top, width, height };
}

/**
 * Stars only: place directly inside the positioned, non-fragmented word element.
 * Its element siblings must be neighboring words; keep overflow visible and
 * reserve annotation space in the owning line. No word wrapper or hit target.
 */
export function LevelStars({ rank, label, size = 'medium', collapse = 'auto', margin = LEVEL_STARS.margin }: LevelStarsProps) {
  const root = useRef<HTMLSpanElement>(null);
  const [availableWidth, setAvailableWidth] = useState(Infinity);
  const visualRank = levelStarsRank(rank);
  const metrics = LEVEL_STARS.sizes[size];
  const collapsed = levelStarsCollapsed(collapse, visualRank * metrics.star, availableWidth);
  const palette = LEVEL_STAR_PALETTE[visualRank - 1] ?? LEVEL_STAR_PALETTE[0];

  useLayoutEffect(() => {
    const word = root.current?.parentElement;
    if (!word || collapse !== 'auto') return;
    const measure = () => {
      const bounds = rectangle(word);
      if (bounds) setAvailableWidth(levelStarsAvailableWidth({
        word: bounds,
        previous: rectangle(word.previousElementSibling),
        next: rectangle(word.nextElementSibling),
      }, margin));
    };
    measure();
    const dispose = [word, word.previousElementSibling, word.nextElementSibling]
      .filter((element): element is Element => element !== null)
      .map(element => observeResize(element, measure));
    return () => { for (const release of dispose) release(); };
  }, [visualRank, size, collapse, margin]);

  if (visualRank === 0) return null;
  return <span ref={root} role="img" aria-label={label} data-level-stars="" data-rank={visualRank}
    data-collapsed={collapsed} style={{
      position: 'absolute', bottom: LEVEL_STARS.bottom, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', width: 'max-content', justifyContent: 'center', alignItems: 'center',
      padding: LEVEL_STARS.padding, gap: 0, pointerEvents: 'none', userSelect: 'none',
      fontSize: '0.8em', textAlign: 'center',
    }}>
    {collapsed ? <span aria-hidden data-level-stars-count="" style={{
      position: 'relative', top: -metrics.star / 2, display: 'inline-block',
      color: LEVEL_STARS.baseColor, fontSize: metrics.count, lineHeight: `${metrics.star}px`,
      fontWeight: LEVEL_STARS.countWeight, opacity: LEVEL_STARS.opacity, filter: palette.filter,
    }}>{visualRank}</span> : null}
    {Array.from({ length: collapsed ? 1 : visualRank }, (_, index) => <span key={index} aria-hidden
      data-level-star="" style={{
        display: 'inline-block', position: 'relative', width: metrics.star, height: metrics.star, flexShrink: 0,
      }}>
      <svg width={metrics.star} height={metrics.star} viewBox="0 0 24 24" fill={LEVEL_STARS.baseColor}
        aria-hidden focusable="false" style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translate(-50%, -50%)',
          overflow: 'visible', opacity: LEVEL_STARS.opacity,
          filter: `${palette.filter} drop-shadow(0px 0px ${LEVEL_STARS.glow}px currentColor)`,
        }}><path d={LEVEL_STAR_PATH} /></svg>
    </span>)}
  </span>;
}
