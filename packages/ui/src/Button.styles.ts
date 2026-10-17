import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
export default StyleSheet.create((theme) => ({
  root: (variant: 'primary' | 'secondary' | 'media') => ({
    minHeight: 44, paddingVertical: variant === 'media' ? 8 : 10, paddingHorizontal: variant === 'media' ? 14 : 18, justifyContent: 'center', alignItems: 'center',
    borderRadius: theme.radius, borderWidth: 1, borderColor: variant === 'primary' ? theme.colors.accent : variant === 'media' ? theme.media.border : theme.colors.border,
    backgroundColor: variant === 'primary' ? theme.colors.accent : variant === 'media' ? theme.media.chrome : theme.colors.surface,
    _web: variant === 'media' ? {minHeight: 36} : {},
  }),
  label: (variant: 'primary' | 'secondary' | 'media') => ({ fontSize: 15 * theme.textScale, fontWeight: '600', color: variant === 'primary' ? theme.colors.onAccent : variant === 'media' ? theme.media.text : theme.colors.text }),
  disabled: { opacity: 0.5 },
}));
