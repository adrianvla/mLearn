import type { PropsWithChildren, ReactElement } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import * as Primitive from '@rn-primitives/dialog';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Button } from './Button';
import { Text } from './Text';

type Props = PropsWithChildren<{ open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; trigger: ReactElement }>;
export function Dialog({ open, onOpenChange, title, description, trigger, children }: Props) {
  const { height } = useWindowDimensions();
  return <Primitive.Root open={open} onOpenChange={onOpenChange}>
    <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
    <Primitive.Portal>
      <Primitive.Overlay asChild>
        <View style={styles.overlay}>
          <View style={styles.bounds}>
            <Primitive.Content asChild>
              <View style={styles.content(height)} testID="dialog-surface">
                <Primitive.Title asChild><Text variant="heading">{title}</Text></Primitive.Title>
                <Primitive.Description asChild><Text muted>{description}</Text></Primitive.Description>
                <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
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
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: theme.scrim, _web: { position: 'fixed', zIndex: 1000 } },
  bounds: { width: '100%', maxWidth: 640 },
  content: (height: number) => ({ width: '100%', maxHeight: Math.max(220, height - 40), gap: 16, padding: 24, backgroundColor: theme.colors.surface, borderRadius: theme.radius, borderColor: theme.colors.border, borderWidth: 1 }),
  scroll: { flexShrink: 1, minHeight: 0 },
  body: { gap: 16 },
}));
