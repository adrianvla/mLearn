import { StyleSheet } from 'react-native-unistyles';
import { Platform } from 'react-native';
import type {} from '@mlearn/theme/runtime';
import type { ResolvedTheme } from '@mlearn/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'media' | 'pill' | 'navigation' | 'select' | 'disclosure' | 'preview';
export type ButtonTone = 'neutral' | 'positive' | 'negative';
export type ButtonSize = 'default' | 'compact' | 'row';

export function buttonForeground(theme: ResolvedTheme, variant: ButtonVariant, tone: ButtonTone) {
  return variant === 'pill' ? theme.pills[tone].text
    : variant === 'media' || variant === 'disclosure' ? theme.media.text : theme.colors.text;
}

export default StyleSheet.create(theme => ({
  root: (variant: ButtonVariant, size: ButtonSize, tone: ButtonTone, selected: boolean, iconOnly: boolean) => {
    const transparent = variant === 'quiet' || variant === 'navigation' || variant === 'disclosure'
      || variant === 'media' && iconOnly;
    const borderless = variant === 'pill' || variant === 'quiet' || variant === 'disclosure'
      || variant === 'media' && iconOnly;
    const selectedSurface = selected && (variant === 'quiet' || variant === 'secondary' || variant === 'navigation');
    return {
      minHeight: size === 'row' ? 72 : 44,
      minWidth: variant === 'select' ? 140 : iconOnly || Platform.OS !== 'web' ? 44 : undefined,
      paddingVertical: theme.spacing.small,
      paddingHorizontal: variant === 'disclosure' ? 0 : iconOnly ? theme.spacing.small
        : size === 'compact' ? theme.spacing.compact : theme.spacing.medium,
      justifyContent: variant === 'navigation' || variant === 'disclosure' ? 'flex-start'
        : variant === 'select' ? 'space-between' : 'center',
      alignItems: 'center', flexDirection: 'row', gap: theme.spacing.small, maxWidth: '100%',
      borderRadius: variant === 'preview' ? 999 : variant === 'pill' ? theme.radius + 4 : theme.radius,
      borderWidth: borderless ? 0 : 1,
      borderColor: variant === 'navigation' && !selected ? 'transparent'
        : variant === 'primary' ? theme.colors.accent : variant === 'media' ? theme.media.border : theme.colors.border,
      backgroundColor: selectedSurface ? theme.controls.selected
        : variant === 'select' || variant === 'preview' || variant === 'secondary' ? theme.controls.field
        : transparent ? 'transparent' : variant === 'pill' ? theme.pills[tone].surface
        : variant === 'primary' ? `${theme.colors.accent.slice(0, 7)}1F` : theme.media.chrome,
      _web: {
        ...(size === 'compact' ? { minHeight: 32, minWidth: iconOnly ? 32 : undefined, paddingVertical: theme.spacing.tiny }
          : variant === 'select' ? { minHeight: 36, paddingVertical: theme.spacing.tiny * 1.5 }
          : variant === 'media' ? { minHeight: 36 } : {}),
        ...(variant === 'pill' ? {
          backgroundImage: `linear-gradient(${theme.pills[tone].top}, ${theme.pills[tone].surface})`,
          boxShadow: 'inset 0 1px 0 #FFFFFF08',
        } : {}),
      },
    };
  },
  label: (variant: ButtonVariant, size: ButtonSize, tone: ButtonTone) => ({
    ...theme.typography[variant === 'disclosure' ? 'inspectionBody'
      : variant === 'navigation' ? 'navigation' : variant === 'select' ? 'caption'
      : variant === 'pill' ? 'knowledgeAction' : variant === 'media' ? 'mediaAction'
      : size === 'default' ? 'action' : 'compactAction'],
    flexShrink: 1, color: buttonForeground(theme, variant, tone),
  }),
  disabled: { opacity: 0.5 },
  hover: (variant: ButtonVariant, tone: ButtonTone) => ({
    backgroundColor: variant === 'primary' ? `${theme.colors.accent.slice(0, 7)}33`
      : variant === 'pill' ? theme.pills[tone].top
      : variant === 'media' || variant === 'disclosure' ? theme.media.badge : theme.controls.hover,
    _web: variant === 'pill' ? { filter: 'brightness(1.08)' } : {},
  }),
  pressed: { transform: [{ scale: 0.98 }] },
}));
