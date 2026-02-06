/**
 * Panel Component
 * Base container with optional glassmorphism styling
 *
 * For theming, use CSS variables that get overridden by theme classes.
 */

import { Component, JSX, splitProps, mergeProps } from 'solid-js';

export interface PanelProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outlined' | 'solid';
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
  border?: boolean;
  shadow?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  children?: JSX.Element;
}

export const Panel: Component<PanelProps> = (props) => {
  const merged = mergeProps(
    {
      variant: 'default' as const,
      rounded: 'lg' as const,
      border: true,
      shadow: true,
      padding: 'md' as const,
    },
    props
  );

  const [local, rest] = splitProps(merged, [
    'variant',
    'rounded',
    'border',
    'shadow',
    'padding',
    'children',
    'class',
    'style',
  ]);

  const getVariantClass = () => {
    switch (local.variant) {
      case 'elevated':
        return 'panel panel-elevated';
      case 'outlined':
        return 'panel panel-outlined';
      case 'solid':
        return 'panel panel-solid';
      default:
        return 'panel';
    }
  };

  const getRoundedClass = () => {
    switch (local.rounded) {
      case 'none':
        return 'rounded-none';
      case 'sm':
        return 'rounded-sm';
      case 'md':
        return 'rounded-md';
      case 'lg':
        return 'rounded-lg';
      case 'xl':
        return 'rounded-xl';
      case 'full':
        return 'rounded-full';
      default:
        return 'rounded-lg';
    }
  };

  const getPaddingStyle = () => {
    switch (local.padding) {
      case 'none':
        return '0';
      case 'sm':
        return '0.5rem';
      case 'md':
        return '1rem';
      case 'lg':
        return '1.5rem';
      case 'xl':
        return '2rem';
      default:
        return '1rem';
    }
  };

  const combinedStyle = () => {
    const baseStyle: JSX.CSSProperties = {
      padding: getPaddingStyle(),
    };

    if (!local.border) {
      baseStyle['border'] = 'none';
    }else{
      baseStyle['border'] = '1px solid var(--border-color)';
    }

    if (!local.shadow) {
      baseStyle['box-shadow'] = 'none';
    }

    // Merge with passed style
    if (typeof local.style === 'object') {
      return { ...baseStyle, ...local.style };
    }

    return baseStyle;
  };

  return (
    <div
      class={`${getVariantClass()} ${getRoundedClass()} ${local.class || ''}`}
      style={combinedStyle()}
      {...rest}
    >
      {local.children}
    </div>
  );
};
