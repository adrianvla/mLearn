import { StyleSheet } from 'react-native-unistyles';
import { Platform } from 'react-native';
import type {} from '@mlearn/theme/runtime';
export default StyleSheet.create((theme) => ({
  root: (variant: 'primary' | 'secondary' | 'quiet' | 'media' | 'pill', size: 'default' | 'compact', tone: 'neutral' | 'positive' | 'negative', selected: boolean) => ({
    minHeight: 44, minWidth: Platform.OS === 'web' ? undefined : 44, paddingVertical: variant === 'media' ? theme.spacing.small : theme.spacing.compact, paddingHorizontal: size === 'compact' ? theme.spacing.compact : theme.spacing.medium, justifyContent: 'center', alignItems: 'center',
    borderRadius: theme.radius, borderWidth: variant === 'pill' || variant === 'quiet' ? 0 : 1, borderColor: variant === 'primary' ? theme.colors.accent : variant === 'media' ? theme.media.border : theme.colors.border,
    backgroundColor: selected && (variant === 'quiet' || variant === 'secondary') ? theme.controls.selected : variant === 'quiet' ? 'transparent' : variant === 'pill' ? theme.pills[tone].surface : variant === 'primary' ? theme.colors.accent : variant === 'media' ? theme.media.chrome : theme.colors.surface,
    maxWidth: '100%',
    _web: {
      ...(size === 'compact' ? { minHeight: 32, paddingVertical: theme.spacing.tiny } : variant === 'media' ? { minHeight: 36 } : {}),
      ...(variant === 'pill' ? {
        backgroundImage: `linear-gradient(${theme.pills[tone].top}, ${theme.pills[tone].surface})`,
        boxShadow: 'inset 0 1px 0 #FFFFFF08',
      } : {}),
    },
  }),
  label: (variant: 'primary' | 'secondary' | 'quiet' | 'media' | 'pill', size: 'default' | 'compact', tone: 'neutral' | 'positive' | 'negative') => ({
    ...theme.typography[variant === 'pill' ? 'knowledgeAction' : size === 'compact' ? 'compactAction' : 'action'],
    flexShrink: 1,
    color: variant === 'pill' ? theme.pills[tone].text : variant === 'primary' ? theme.colors.onAccent : variant === 'media' ? theme.media.text : theme.colors.text,
  }),
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
}));
