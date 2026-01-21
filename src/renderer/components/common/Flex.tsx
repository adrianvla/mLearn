/**
 * Flex Layout Utility Components
 * Provides consistent flexbox patterns across the app
 */

import { Component, JSX, splitProps } from 'solid-js';

type FlexAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
type FlexJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
type FlexDirection = 'row' | 'column' | 'row-reverse' | 'column-reverse';
type FlexWrap = 'wrap' | 'nowrap' | 'wrap-reverse';

export interface FlexProps extends JSX.HTMLAttributes<HTMLDivElement> {
  /** Flex direction */
  direction?: FlexDirection;
  /** Align items */
  align?: FlexAlign;
  /** Justify content */
  justify?: FlexJustify;
  /** Gap between items (CSS value or number in rem) */
  gap?: string | number;
  /** Whether to wrap items */
  wrap?: FlexWrap | boolean;
  /** Whether to grow to fill container */
  grow?: boolean;
  /** Inline flex instead of block */
  inline?: boolean;
  /** Children */
  children?: JSX.Element;
}

const alignMap: Record<FlexAlign, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const justifyMap: Record<FlexJustify, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

/**
 * Generic Flex container component
 */
export const Flex: Component<FlexProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'direction',
    'align',
    'justify',
    'gap',
    'wrap',
    'grow',
    'inline',
    'children',
    'style',
  ]);

  const computedStyle = (): JSX.CSSProperties => {
    const baseStyle: JSX.CSSProperties = {
      display: local.inline ? 'inline-flex' : 'flex',
    };

    if (local.direction) {
      baseStyle['flex-direction'] = local.direction;
    }

    if (local.align) {
      baseStyle['align-items'] = alignMap[local.align];
    }

    if (local.justify) {
      baseStyle['justify-content'] = justifyMap[local.justify];
    }

    if (local.gap !== undefined) {
      baseStyle.gap = typeof local.gap === 'number' ? `${local.gap}rem` : local.gap;
    }

    if (local.wrap) {
      baseStyle['flex-wrap'] = typeof local.wrap === 'boolean' ? 'wrap' : local.wrap;
    }

    if (local.grow) {
      baseStyle['flex-grow'] = '1';
    }

    // Merge with any provided style
    const providedStyle = local.style;
    if (typeof providedStyle === 'string') {
      return baseStyle;
    } else if (providedStyle) {
      return { ...baseStyle, ...providedStyle };
    }

    return baseStyle;
  };

  return (
    <div {...rest} style={computedStyle()}>
      {local.children}
    </div>
  );
};

/**
 * Horizontal flex row (shorthand for Flex with direction="row")
 */
export const Row: Component<Omit<FlexProps, 'direction'>> = (props) => {
  return <Flex direction="row" {...props} />;
};

/**
 * Vertical flex column (shorthand for Flex with direction="column")
 */
export const Column: Component<Omit<FlexProps, 'direction'>> = (props) => {
  return <Flex direction="column" {...props} />;
};

/**
 * Centered flex container (both axes)
 */
export const Center: Component<Omit<FlexProps, 'align' | 'justify'>> = (props) => {
  return <Flex align="center" justify="center" {...props} />;
};

/**
 * Spacer component to fill available space in a flex container
 */
export const Spacer: Component = () => {
  return <div style={{ flex: '1' }} />;
};

export default Flex;
