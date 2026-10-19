import type { PropsWithChildren, ReactElement } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import * as Primitive from '@rn-primitives/dialog';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Button } from './Button';
import { Text } from './Text';

type Props = PropsWithChildren<{ open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; trigger: ReactElement }>;
export function Dialog({ open, onOpenChange, title, description, trigger, children }: Props) {
  const { height } = useWindowDimensions();
  const { theme } = useUnistyles();
  return <Primitive.Root open={open} onOpenChange={onOpenChange}>
    <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
    <Primitive.Portal>
      <Primitive.Overlay asChild>
        <View style={styles.overlay}>
          <View style={styles.bounds}>
            <Primitive.Content asChild>
              <View style={[styles.content(height), { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius }]} testID="dialog-surface">
                <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                  <Primitive.Title asChild><Text variant="heading">{title}</Text></Primitive.Title>
                  <Primitive.Description asChild><Text muted>{description}</Text></Primitive.Description>
                  {children}
                </ScrollView>
                <Primitive.Close asChild><Button label="Close" variant="secondary" /></Primitive.Close>
              </View>
            </Primitive.Content>
          </View>
        </View>
      </Primitive.Overlay>
    </Primitive.Portal>
  </Primitive.Root>;
}
const styles = StyleSheet.create((theme) => ({
  // Style the native View itself: RN Primitives adds unstyled DOM wrappers on web.
  // A fixed web overlay must not move when focus scrolls the underlying page.
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.comfortable, backgroundColor: theme.scrim, _web: { position: 'fixed', zIndex: 1000 } },
  bounds: { width: '100%', maxWidth: 640 },
  // Content crosses a third-party asChild/portal boundary. Resolve its palette
  // through useUnistyles so a surface mounted after a theme change cannot keep
  // the initial palette while its child controls use the active theme.
  content: (height: number) => ({ width: '100%', maxHeight: Math.max(0, height - 2 * theme.spacing.comfortable), gap: theme.spacing.medium, padding: theme.spacing.large, borderWidth: 1 }),
  scroll: { flexShrink: 1, minHeight: 0 },
  body: { gap: theme.spacing.medium },
}));
