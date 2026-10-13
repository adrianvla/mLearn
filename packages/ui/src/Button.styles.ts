import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
export default StyleSheet.create((theme) => ({
  root: (variant: 'primary' | 'secondary') => ({
    minHeight: 44, paddingVertical: 10, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center',
    borderRadius: theme.radius, borderWidth: 1, borderColor: variant === 'primary' ? theme.colors.accent : theme.colors.border,
    backgroundColor: variant === 'primary' ? theme.colors.accent : theme.colors.surface,
  }),
  label: (variant: 'primary' | 'secondary') => ({ fontSize: 15 * theme.textScale, fontWeight: '600', color: variant === 'primary' ? theme.colors.onAccent : theme.colors.text }),
  disabled: { opacity: 0.5 },
}));
