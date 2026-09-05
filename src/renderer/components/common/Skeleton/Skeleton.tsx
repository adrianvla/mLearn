/**
 * Shared skeleton primitives — the one sanctioned placeholder vocabulary.
 *
 * Geometry-preserving placeholders for surfaces whose content is genuinely
 * not ready yet. These primitives are pure, subscription-free DOM: mounting
 * them inside a pending boundary costs nothing beyond the elements, and they
 * never invalidate reactive scopes. Compose them at the call site to sketch
 * the *shape* of upcoming content — do not mirror the final DOM structure
 * element-for-element, that couples skeletons to layout details and rots.
 *
 * Styling comes from the shared skeleton tokens (`--skeleton-base`,
 * `--skeleton-highlight`) and the global `shimmer` keyframes; motion is
 * disabled centrally for `prefers-reduced-motion` users and per-instance
 * via `animate={false}`.
 */
import { Component, For, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import './Skeleton.css';

export type SkeletonSize = 'xs' | 'sm' | 'md' | 'lg';
export type SkeletonWidth = string | number;

const staticClass = (animate: boolean | undefined): string => (animate === false ? ' skeleton--static' : '');
const extraClass = (extra: string | undefined): string => (extra ? ` ${extra}` : '');
const widthStyle = (width: SkeletonWidth | undefined): JSX.CSSProperties | undefined => (
  width === undefined ? undefined : { width: typeof width === 'number' ? `${width}px` : width }
);

/** Single placeholder line (a span) at text height. */
export const SkeletonLine: Component<{
  width?: SkeletonWidth;
  size?: SkeletonSize;
  animate?: boolean;
  class?: string;
}> = (props) => (
  <span
    class={`skeleton-line skeleton-line--${props.size ?? 'md'}${staticClass(props.animate)}${extraClass(props.class)}`}
    style={widthStyle(props.width)}
  />
);

/** Multi-line paragraph placeholder; the last line is shortened like real prose. */
export const SkeletonText: Component<{
  lines?: number;
  animate?: boolean;
  class?: string;
}> = (props) => {
  const lines = () => props.lines ?? 3;
  return (
    <span class={`skeleton-text${staticClass(props.animate)}${extraClass(props.class)}`} aria-hidden="true">
      <For each={Array.from({ length: lines() })}>
        {(_, index) => (
          <span
            class={`skeleton-line skeleton-text__line skeleton-line--md${staticClass(props.animate)}${index() === lines() - 1 ? ' skeleton-text__line--last' : ''}`}
          />
        )}
      </For>
    </span>
  );
};

/** Status-pill/badge placeholder. */
export const SkeletonPill: Component<{
  width?: SkeletonWidth;
  animate?: boolean;
  class?: string;
}> = (props) => (
  <span
    class={`skeleton-pill${staticClass(props.animate)}${extraClass(props.class)}`}
    style={widthStyle(props.width)}
  />
);

/** Small inline chunk (icon / inline value / short token). */
export const SkeletonInline: Component<{
  animate?: boolean;
  class?: string;
}> = (props) => (
  <span class={`skeleton-inline${staticClass(props.animate)}${extraClass(props.class)}`} aria-hidden="true" />
);

/** Vertical list or table-body placeholder: N stable full-width rows. */
export const SkeletonRows: Component<{
  rows?: number;
  rowHeight?: string;
  animate?: boolean;
  class?: string;
}> = (props) => (
  <span class={`skeleton-rows${staticClass(props.animate)}${extraClass(props.class)}`} aria-hidden="true">
    <For each={Array.from({ length: props.rows ?? 4 })}>
      {() => <span class="skeleton-row" style={props.rowHeight ? { height: props.rowHeight } : undefined} />}
    </For>
  </span>
);

/** Grid of uniform cells (character grids, card grids). */
export const SkeletonGrid: Component<{
  cells?: number;
  animate?: boolean;
  class?: string;
}> = (props) => (
  <span class={`skeleton-grid${staticClass(props.animate)}${extraClass(props.class)}`} aria-hidden="true">
    <For each={Array.from({ length: props.cells ?? 24 })}>
      {() => <span class="skeleton-grid__cell" />}
    </For>
  </span>
);

/** Card/panel placeholder: optional title line plus body lines. */
export const SkeletonCard: Component<{
  lines?: number;
  title?: boolean;
  animate?: boolean;
  class?: string;
}> = (props) => (
  <span class={`skeleton-card${staticClass(props.animate)}${extraClass(props.class)}`} aria-hidden="true">
    <Show when={props.title !== false}>
      <span class={`skeleton-line skeleton-card__title skeleton-line--lg${staticClass(props.animate)}`} />
    </Show>
    <For each={Array.from({ length: props.lines ?? 3 })}>
      {(_, index) => (
        <span
          class={`skeleton-line skeleton-card__line skeleton-line--md${staticClass(props.animate)}${index() === (props.lines ?? 3) - 1 ? ' skeleton-text__line--last' : ''}`}
        />
      )}
    </For>
  </span>
);

/** Row of stat-card placeholders (dashboards, summary headers). */
export const SkeletonStatGrid: Component<{
  count?: number;
  animate?: boolean;
  class?: string;
}> = (props) => (
  <span class={`skeleton-stats${staticClass(props.animate)}${extraClass(props.class)}`} aria-hidden="true">
    <For each={Array.from({ length: props.count ?? 4 })}>
      {() => <span class="skeleton-stat" />}
    </For>
  </span>
);
