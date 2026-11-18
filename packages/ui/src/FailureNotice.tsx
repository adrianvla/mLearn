import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from './Button';
import { Text } from './Text';

export interface FailureNoticeProps {
  /** One plain sentence naming what did not happen. */
  readonly message: string;
  /** Raw platform/runtime text, shown only behind the Details disclosure. */
  readonly detail?: string | null;
  readonly tone?: 'content' | 'media';
  /** The one recovery action beside the message. */
  readonly children?: ReactNode;
  readonly testID?: string;
}

export function FailureNotice({ message, detail, tone = 'content', children, testID }: FailureNoticeProps) {
  const [open, setOpen] = useState(false);
  return <View style={styles.root} testID={testID}>
    <Text tone={tone} accessibilityRole="alert">{message}</Text>
    {children || detail ? <View style={styles.actions}>
      {children}
      {detail ? <Button label="Details" variant="disclosure" size="compact" surface={tone} accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)} /> : null}
    </View> : null}
    {open && detail ? <Text tone={tone} variant="detail" muted selectable>{detail}</Text> : null}
  </View>;
}

const styles = StyleSheet.create(theme => ({
  root: { gap: theme.spacing.compact, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.small },
}));
