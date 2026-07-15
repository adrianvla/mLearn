/**
 * Responsive Context
 * Provides reactive viewport-based signals for responsive design.
 * Complements the static platform checks (isMobile/isDesktop) from shared/platform.ts
 * with dynamic viewport awareness.
 *
 * Usage:
 *   const { isCompact, isNarrow, breakpoint, viewportWidth } = useResponsive();
 *   <Show when={isCompact()}>...</Show>
 */

import {
  createContext,
  useContext,
  ParentComponent,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  createMemo,
  Accessor,
} from 'solid-js';
import { isMobile as isPlatformMobile, isDesktop as isPlatformDesktop } from '../../shared/platform';

/** Breakpoint thresholds (px) — consistent across the app */
export const BREAKPOINTS = {
  /** Small phones, compact views */
  sm: 480,
  /** Large phones, small tablets */
  md: 768,
  /** Tablets, narrow desktop windows */
  lg: 1024,
  /** Desktop and wider */
  xl: 1280,
} as const;

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SidebarLayout = 'drawer' | 'inline';

/** Shared responsive token used by every sidebar presentation. */
export const SIDEBAR_LAYOUT_BREAKPOINT: keyof typeof BREAKPOINTS = 'lg';

export function resolveSidebarLayout(width: number, platformMobile: boolean): SidebarLayout {
  return platformMobile || width <= BREAKPOINTS[SIDEBAR_LAYOUT_BREAKPOINT]
    ? 'drawer'
    : 'inline';
}

export interface ResponsiveContextValue {
  /** Current viewport width in pixels */
  viewportWidth: Accessor<number>;
  /** Current viewport height in pixels */
  viewportHeight: Accessor<number>;
  /** Active breakpoint name: xs | sm | md | lg | xl */
  breakpoint: Accessor<Breakpoint>;
  /** Shared sidebar presentation used by component and route styles. */
  sidebarLayout: Accessor<SidebarLayout>;
  /** True when viewport ≤ 480px (small phones) */
  isXs: Accessor<boolean>;
  /** True when viewport ≤ 768px (phones + small tablets) */
  isNarrow: Accessor<boolean>;
  /** True when viewport ≤ 1024px (tablets + narrow desktops) */
  isMedium: Accessor<boolean>;
  /**
   * True when the app should use compact/mobile layout.
   * Combines platform check (Capacitor) OR narrow viewport (≤ 768px).
   * Use this for layout decisions instead of raw isMobile().
   */
  isCompact: Accessor<boolean>;
  /** True on Capacitor platform (static) */
  isPlatformMobile: Accessor<boolean>;
  /** True on Electron platform (static) */
  isPlatformDesktop: Accessor<boolean>;
  /**
   * Returns true if viewport is at or below the given breakpoint.
   * e.g. below('md') → true when viewport ≤ 768px
   */
  below: (bp: keyof typeof BREAKPOINTS) => boolean;
  /**
   * Returns true if viewport is above the given breakpoint.
   * e.g. above('md') → true when viewport > 768px
   */
  above: (bp: keyof typeof BREAKPOINTS) => boolean;
}

const ResponsiveContext = createContext<ResponsiveContextValue>();

function resolveBreakpoint(width: number): Breakpoint {
  if (width <= BREAKPOINTS.sm) return 'xs';
  if (width <= BREAKPOINTS.md) return 'sm';
  if (width <= BREAKPOINTS.lg) return 'md';
  if (width <= BREAKPOINTS.xl) return 'lg';
  return 'xl';
}

export const ResponsiveProvider: ParentComponent = (props) => {
  const [viewportWidth, setViewportWidth] = createSignal(
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );
  const [viewportHeight, setViewportHeight] = createSignal(
    typeof window !== 'undefined' ? window.innerHeight : 800,
  );

  onMount(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    onCleanup(() => window.removeEventListener('resize', handleResize));
  });

  const breakpoint = createMemo(() => resolveBreakpoint(viewportWidth()));
  const sidebarLayout = createMemo(() => resolveSidebarLayout(viewportWidth(), isPlatformMobile()));
  const isXs = createMemo(() => viewportWidth() <= BREAKPOINTS.sm);
  const isNarrow = createMemo(() => viewportWidth() <= BREAKPOINTS.md);
  const isMedium = createMemo(() => viewportWidth() <= BREAKPOINTS.lg);
  const isCompact = createMemo(() => isPlatformMobile() || viewportWidth() <= BREAKPOINTS.md);

  createEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.sidebarLayout = sidebarLayout();
    }
  });

  onCleanup(() => {
    if (typeof document !== 'undefined') {
      delete document.documentElement.dataset.sidebarLayout;
    }
  });

  const value: ResponsiveContextValue = {
    viewportWidth,
    viewportHeight,
    breakpoint,
    sidebarLayout,
    isXs,
    isNarrow,
    isMedium,
    isCompact,
    isPlatformMobile: () => isPlatformMobile(),
    isPlatformDesktop: () => isPlatformDesktop(),
    below: (bp) => viewportWidth() <= BREAKPOINTS[bp],
    above: (bp) => viewportWidth() > BREAKPOINTS[bp],
  };

  return (
    <ResponsiveContext.Provider value={value}>
      {props.children}
    </ResponsiveContext.Provider>
  );
};

/**
 * Access viewport-reactive responsive signals.
 * Must be called within a <ResponsiveProvider>.
 */
export function useResponsive(): ResponsiveContextValue {
  const ctx = useContext(ResponsiveContext);
  if (!ctx) {
    throw new Error('useResponsive must be used within a <ResponsiveProvider>');
  }
  return ctx;
}
