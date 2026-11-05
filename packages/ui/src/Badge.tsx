import { View, Text as NativeText } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';

/** Static linguistic metadata, distinct from actionable Knowledge pills. */
export function Badge({ label, color, variant = 'partOfSpeech', tone = 'content', selectable = false, size = 'default' }: {
  readonly label: string;
  readonly color?: string | null;
  readonly variant?: 'reading' | 'label' | 'partOfSpeech';
  readonly tone?: 'content' | 'media';
  readonly selectable?: boolean;
  readonly size?: 'default' | 'compact';
}) {
  const { theme } = useUnistyles();
  const backgroundColor = color ? `${color}20` : variant === 'reading' ? theme.pills.neutral.surface
    : variant === 'partOfSpeech' ? theme.media.metadata : tone === 'media' ? theme.media.badge : theme.controls.surface;
  const foreground = color ?? (variant === 'reading' ? theme.pills.neutral.text
    : variant === 'label' && tone === 'content' ? theme.colors.text : theme.media.text);
  return <View style={[styles.root(variant, size === 'compact'), { backgroundColor }]}>
    <NativeText selectable={selectable} style={[styles.label(variant, size === 'compact'), { color: foreground }]}>{label}</NativeText>
  </View>;
}
const styles = StyleSheet.create(theme => ({
  root: (variant: 'reading' | 'label' | 'partOfSpeech', compact: boolean) => ({
    maxWidth: '100%',
    borderRadius: compact ? theme.radius + 2 : variant === 'partOfSpeech' ? 4 : theme.radius + 4,
    paddingVertical: compact ? 5 : variant === 'partOfSpeech' ? theme.spacing.tiny * 0.75 : theme.spacing.tiny,
    paddingHorizontal: compact ? 10 : variant === 'partOfSpeech' ? theme.spacing.small * 0.75 : theme.spacing.compact,
    _web: variant === 'reading' ? { backgroundImage: `linear-gradient(${theme.pills.neutral.top}, ${theme.pills.neutral.surface})` } : {},
  }),
  label: (variant: 'reading' | 'label' | 'partOfSpeech', compact: boolean) => ({
    ...theme.typography[compact ? 'compactPill' : variant === 'reading' ? 'inspectionReading' : variant === 'label' ? 'knowledgeAction' : 'badge'],
    flexShrink: 1,
  }),
}));
