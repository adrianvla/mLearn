import { View, Text as NativeText } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';

/** Static linguistic metadata, distinct from actionable Knowledge pills. */
export function Badge({ label, variant = 'partOfSpeech', selectable = false }: {
  readonly label: string;
  readonly variant?: 'reading' | 'partOfSpeech';
  readonly selectable?: boolean;
}) {
  return <View style={styles.root(variant)}><NativeText selectable={selectable} style={styles.label(variant)}>{label}</NativeText></View>;
}
const styles = StyleSheet.create(theme => ({
  root: (variant: 'reading' | 'partOfSpeech') => ({
    maxWidth: '100%',
    borderRadius: variant === 'reading' ? theme.radius + 4 : 4,
    backgroundColor: variant === 'reading' ? theme.pills.neutral.surface : theme.media.badge,
    paddingVertical: variant === 'reading' ? theme.spacing.tiny : theme.spacing.tiny * 0.75,
    paddingHorizontal: variant === 'reading' ? theme.spacing.compact : theme.spacing.small * 0.75,
    _web: variant === 'reading' ? { backgroundImage: `linear-gradient(${theme.pills.neutral.top}, ${theme.pills.neutral.surface})` } : {},
  }),
  label: (variant: 'reading' | 'partOfSpeech') => ({
    ...theme.typography[variant === 'reading' ? 'inspectionReading' : 'badge'],
    color: variant === 'reading' ? theme.pills.neutral.text : theme.media.text,
    flexShrink: 1,
  }),
}));
