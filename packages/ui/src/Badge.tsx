import { View, Text as NativeText } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';

/** Static linguistic metadata, distinct from actionable Knowledge pills. */
export function Badge({ label, color, variant = 'partOfSpeech', selectable = false }: {
  readonly label: string;
  readonly color?: string | null;
  readonly variant?: 'reading' | 'label' | 'partOfSpeech';
  readonly selectable?: boolean;
}) {
  return <View style={[styles.root(variant), color ? { backgroundColor: `${color}20` } : null]}>
    <NativeText selectable={selectable} style={[styles.label(variant), color ? { color } : null]}>{label}</NativeText>
  </View>;
}
const styles = StyleSheet.create(theme => ({
  root: (variant: 'reading' | 'label' | 'partOfSpeech') => ({
    maxWidth: '100%',
    borderRadius: variant === 'partOfSpeech' ? 4 : theme.radius + 4,
    backgroundColor: variant === 'reading' ? theme.pills.neutral.surface : theme.media.badge,
    paddingVertical: variant === 'partOfSpeech' ? theme.spacing.tiny * 0.75 : theme.spacing.tiny,
    paddingHorizontal: variant === 'partOfSpeech' ? theme.spacing.small * 0.75 : theme.spacing.compact,
    _web: variant === 'reading' ? { backgroundImage: `linear-gradient(${theme.pills.neutral.top}, ${theme.pills.neutral.surface})` } : {},
  }),
  label: (variant: 'reading' | 'label' | 'partOfSpeech') => ({
    ...theme.typography[variant === 'reading' ? 'inspectionReading' : variant === 'label' ? 'knowledgeAction' : 'badge'],
    color: variant === 'reading' ? theme.pills.neutral.text : theme.media.text,
    flexShrink: 1,
  }),
}));
