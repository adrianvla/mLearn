import { StyleSheet } from 'react-native-unistyles';
import { Platform } from 'react-native';
import type {} from '@mlearn/theme/runtime';
import type { ResolvedTheme } from '@mlearn/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'media' | 'mediaFloating' | 'mediaSelect' | 'mediaSync' | 'pill' | 'navigation' | 'segment' | 'select' | 'disclosure' | 'preview' | 'sourcePreview' | 'dictionary';
export type ButtonTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info';
export type ButtonSize = 'default' | 'compact' | 'row';

export function buttonForeground(theme: ResolvedTheme, variant: ButtonVariant, tone: ButtonTone, selected = false) {
  return variant === 'pill' || tone === 'warning' ? theme.pills[tone].text
    : (variant === 'navigation' || variant === 'segment') && !selected ? theme.colors.muted
    : variant === 'sourcePreview' ? theme.colors.muted
    : variant === 'dictionary' || variant === 'mediaSync' ? theme.media.muted
    : variant === 'media' || variant === 'mediaFloating' || variant === 'mediaSelect' || variant === 'disclosure' ? theme.media.text : theme.colors.text;
}

export default StyleSheet.create(theme => ({
  root: (variant: ButtonVariant, size: ButtonSize, tone: ButtonTone, selected: boolean, iconOnly: boolean) => {
    const transparent = variant === 'quiet' || variant === 'navigation' || variant === 'segment' || variant === 'disclosure' || variant === 'mediaSelect' || variant === 'mediaSync'
      || variant === 'media' && iconOnly;
    const borderless = variant === 'segment' || variant === 'navigation' && size === 'row' || variant === 'dictionary' || variant === 'pill' || variant === 'quiet' || variant === 'disclosure' || variant === 'mediaSelect' || variant === 'mediaSync'
      || variant === 'media' && iconOnly;
    const selectedSurface = selected && (variant === 'quiet' || variant === 'secondary' || variant === 'navigation' || variant === 'segment');
    return {
      minHeight: variant === 'sourcePreview' ? 160 : size === 'row' ? 72 : 44,
      width: variant === 'sourcePreview' ? '100%' : variant === 'dictionary' ? 300 : undefined,
      minWidth: variant === 'mediaSelect' ? 56 : variant === 'select' ? 166 : iconOnly || Platform.OS !== 'web' ? 44 : undefined,
      paddingVertical: theme.spacing.small,
      paddingHorizontal: variant === 'dictionary' ? theme.spacing.comfortable : variant === 'disclosure' ? 0 : iconOnly ? theme.spacing.small
        : size === 'compact' ? theme.spacing.compact : theme.spacing.medium,
      justifyContent: variant === 'navigation' || variant === 'disclosure' ? 'flex-start'
        : variant === 'select' || variant === 'dictionary' ? 'space-between' : 'center',
      alignItems: 'center', alignSelf: variant === 'mediaFloating' ? 'flex-start' : undefined,
      flexDirection: variant === 'sourcePreview' ? 'column' : 'row', gap: theme.spacing.small, maxWidth: '100%',
      borderRadius: variant === 'preview' ? 999 : variant === 'pill' ? theme.radius + 4 : theme.radius,
      borderWidth: borderless ? 0 : 1,
      borderColor: tone === 'warning' ? theme.pills.warning.top : variant === 'navigation' && !selected ? 'transparent'
        : variant === 'preview' ? theme.controls.outline
        : variant === 'primary' ? theme.colors.accent : variant === 'media' || variant === 'mediaFloating' ? theme.media.border : theme.colors.border,
      backgroundColor: tone === 'warning' ? theme.pills.warning.surface : selected && variant === 'navigation' && size === 'row' ? theme.surfaces.secondary : selectedSurface ? theme.controls.selected
        : variant === 'preview' || variant === 'sourcePreview' ? theme.surfaces.glass
        : variant === 'select' || variant === 'secondary' ? theme.controls.field
        : transparent ? 'transparent' : variant === 'pill' ? theme.pills[tone].surface
        : variant === 'primary' ? `${theme.colors.accent.slice(0, 7)}1F`
        : variant === 'dictionary' ? theme.media.panel : theme.media.chrome,
      _web: {
        ...(variant === 'quiet' && !iconOnly ? { backdropFilter: theme.controls.backdrop,
          backgroundColor: theme.controls.quiet } : {}),
        ...(size === 'compact' ? { minHeight: 32, minWidth: iconOnly ? 32 : undefined, paddingVertical: theme.spacing.tiny }
          : variant === 'select' ? { minHeight: 36, paddingVertical: theme.spacing.tiny * 1.5 }
          : variant === 'media' || variant === 'navigation' ? { minHeight: 36, paddingVertical: theme.spacing.tiny } : {}),
        ...(variant === 'pill' ? {
          backgroundImage: `linear-gradient(${theme.pills[tone].top}, ${theme.pills[tone].surface})`,
          boxShadow: 'inset 0 1px 0 #FFFFFF08',
          ...(size === 'compact' ? { minHeight: 28, paddingVertical: 5, paddingHorizontal: 10, borderRadius: theme.radius + 2 } : {}),
        } : {}),
        ...(variant === 'dictionary' ? { minHeight: 30, paddingVertical: 0,
          backgroundColor: theme.media.translucentPanel, backdropFilter: theme.media.backdrop } : {}),
        ...(variant === 'mediaSync' ? { minHeight: 40, minWidth: iconOnly ? 40 : 100 * theme.textScale,
          paddingVertical: 5, paddingHorizontal: 5 } : {}),
        ...(variant === 'sourcePreview' ? { minHeight: 160, boxShadow: `inset 0 0 0 1px ${theme.colors.border}` } : {}),
      },
    };
  },
  label: (variant: ButtonVariant, size: ButtonSize, tone: ButtonTone, selected: boolean) => ({
    ...theme.typography[variant === 'mediaSync' ? 'subtitleOffset' : variant === 'dictionary' ? 'dictionaryMeaning' : variant === 'disclosure' ? 'inspectionBody'
      : variant === 'navigation' ? 'navigation' : variant === 'select' || variant === 'sourcePreview' ? 'caption'
      : variant === 'pill' ? size === 'compact' ? 'compactPill' : 'knowledgeAction' : variant === 'media' || variant === 'mediaFloating' || variant === 'mediaSelect' ? 'mediaAction'
      : size === 'default' ? 'action' : 'compactAction'],
    flexShrink: 1, ...(variant === 'dictionary' ? { flex: 1, minWidth: 0 } : {}),
    color: buttonForeground(theme, variant, tone, selected),
  }),
  detail: { ...theme.typography.dictionaryReading, flexShrink: 1, maxWidth: '40%', color: theme.media.muted },
  rowCopy: { flex: 1, minWidth: 0, gap: theme.spacing.tiny },
  rowHeading: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small },
  rowTitle: { ...theme.typography.listTitle, color: theme.colors.text, flex: 1, minWidth: 0 },
  rowMeta: { ...theme.typography.detail, color: theme.colors.muted, flexShrink: 0 },
  rowDetail: { ...theme.typography.caption, color: theme.colors.muted },
  disabled: { opacity: 0.5 },
  hover: (variant: ButtonVariant, tone: ButtonTone) => ({
    backgroundColor: tone === 'warning' ? theme.pills.warning.top : variant === 'primary' ? `${theme.colors.accent.slice(0, 7)}33`
      : variant === 'pill' ? theme.pills[tone].top
      : variant === 'sourcePreview' ? theme.surfaces.secondary
      : variant === 'mediaFloating' ? theme.media.border
      : variant === 'media' || variant === 'mediaSelect' || variant === 'mediaSync' || variant === 'disclosure' ? theme.media.badge : theme.controls.hover,
    _web: variant === 'pill' ? { filter: 'brightness(1.08)' } : {},
  }),
  pressed: { transform: [{ scale: 0.98 }] },
}));
