import { StyleSheet } from 'react-native-unistyles';
import { Platform } from 'react-native';
import type {} from '@mlearn/theme/runtime';
import type { ResolvedTheme } from '@mlearn/theme';
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'media' | 'pill' | 'navigation' | 'select';
export type ButtonTone = 'neutral' | 'positive' | 'negative';
export function buttonForeground(theme: ResolvedTheme, variant: ButtonVariant, tone: ButtonTone) {
  return variant === 'pill' ? theme.pills[tone].text : variant === 'media' ? theme.media.text : theme.colors.text;
}
export default StyleSheet.create((theme) => ({
  root: (variant: ButtonVariant, size: 'default' | 'compact', tone: ButtonTone, selected: boolean, iconOnly: boolean) => ({
    minHeight: 44, minWidth: variant === 'select' ? 140 : iconOnly || Platform.OS !== 'web' ? 44 : undefined, paddingVertical: theme.spacing.small, paddingHorizontal: iconOnly ? theme.spacing.small : size === 'compact' ? theme.spacing.compact : theme.spacing.medium, justifyContent: variant === 'navigation' ? 'flex-start' : variant === 'select' ? 'space-between' : 'center', alignItems: 'center', flexDirection: 'row', gap: theme.spacing.small,
    borderRadius: theme.radius, borderWidth: variant === 'pill' || variant === 'quiet' ? 0 : 1, borderColor: variant === 'navigation' && !selected ? 'transparent' : variant === 'primary' ? theme.colors.accent : variant === 'media' ? theme.media.border : theme.colors.border,
    backgroundColor: selected && (variant === 'quiet' || variant === 'secondary' || variant === 'navigation') || variant === 'select' ? theme.controls.selected : variant === 'quiet' || variant === 'navigation' ? 'transparent' : variant === 'pill' ? theme.pills[tone].surface : variant === 'primary' ? `${theme.colors.accent.slice(0, 7)}1F` : variant === 'media' ? theme.media.chrome : theme.controls.surface,
    maxWidth: '100%',
    _web: {
      ...(size === 'compact' ? { minHeight: 32, minWidth: iconOnly ? 32 : undefined, paddingVertical: theme.spacing.tiny } : variant === 'media' ? { minHeight: 36 } : {}),
      ...(variant === 'pill' ? {
        backgroundImage: `linear-gradient(${theme.pills[tone].top}, ${theme.pills[tone].surface})`,
        boxShadow: 'inset 0 1px 0 #FFFFFF08',
      } : {}),
    },
  }),
  label: (variant: ButtonVariant, size: 'default' | 'compact', tone: ButtonTone) => ({
    ...theme.typography[variant === 'navigation' ? 'navigation' : variant === 'select' ? 'body' : variant === 'pill' ? 'knowledgeAction' : variant === 'media' ? 'mediaAction' : size === 'compact' ? 'compactAction' : 'action'],
    flexShrink: 1,
    color: buttonForeground(theme, variant, tone),
  }),
  disabled: { opacity: 0.5 },
  hover: (variant: ButtonVariant, tone: ButtonTone) => ({
    backgroundColor: variant === 'primary' ? `${theme.colors.accent.slice(0, 7)}33`
      : variant === 'pill' ? theme.pills[tone].top : variant === 'media' ? theme.media.badge : theme.controls.hover,
  }),
  pressed: { transform: [{ scale: 0.98 }] },
}));
