/**
 * Glass Panel Component
 * Base glassmorphism container with various styles
 */

import { Component, JSX, splitProps, mergeProps } from 'solid-js';

export interface GlassPanelProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'light' | 'dark' | 'solid';
  blur?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
  border?: boolean;
  shadow?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  children?: JSX.Element;
}

export const GlassPanel: Component<GlassPanelProps> = (props) => {
  const merged = mergeProps(
    {
      variant: 'default' as const,
      blur: 'md' as const,
      rounded: 'lg' as const,
      border: true,
      shadow: true,
      padding: 'md' as const,
    },
    props
  );

  const [local, rest] = splitProps(merged, [
    'variant',
    'blur',
    'rounded',
    'border',
    'shadow',
    'padding',
    'children',
    'class',
    'style',
  ]);

  const getBackgroundClass = () => {
    switch (local.variant) {
      case 'light':
        return 'glass-light';
      case 'dark':
        return 'glass-dark';
      case 'solid':
        return 'glass-solid';
      default:
        return 'glass';
    }
  };

  const getBlurStyle = () => {
    switch (local.blur) {
      case 'none':
        return 'none';
      case 'sm':
        return 'blur(4px)';
      case 'md':
        return 'blur(8px)';
      case 'lg':
        return 'blur(16px)';
      case 'xl':
        return 'blur(24px)';
      default:
        return 'blur(8px)';
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
      'backdrop-filter': getBlurStyle(),
      '-webkit-backdrop-filter': getBlurStyle(),
      padding: getPaddingStyle(),
    };

    if (!local.border) {
      baseStyle['border'] = 'none';
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
      class={`${getBackgroundClass()} ${getRoundedClass()} ${local.class || ''}`}
      style={combinedStyle()}
      {...rest}
    >
      {local.children}
    </div>
  );
};
