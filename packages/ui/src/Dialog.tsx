import type { PropsWithChildren, ReactElement } from 'react';
import { ScrollView } from 'react-native';
import * as Primitive from '@rn-primitives/dialog';
import { StyleSheet, withUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Button } from './Button';

const Overlay = withUnistyles(Primitive.Overlay);
const Content = withUnistyles(Primitive.Content);
const Title = withUnistyles(Primitive.Title);
const Description = withUnistyles(Primitive.Description);
type Props = PropsWithChildren<{ open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; trigger: ReactElement }>;
export function Dialog({ open, onOpenChange, title, description, trigger, children }: Props) {
  return <Primitive.Root open={open} onOpenChange={onOpenChange}>
    <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
    <Primitive.Portal><Overlay style={styles.overlay}><Content style={styles.content}>
      <Title style={styles.title}>{title}</Title>
      <Description style={styles.description}>{description}</Description>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      <Primitive.Close asChild><Button label="Close" variant="secondary" /></Primitive.Close>
    </Content></Overlay></Primitive.Portal>
  </Primitive.Root>;
}
const styles = StyleSheet.create((theme) => ({
  // The web host is a Radix DOM element, not RN View: flex display must be explicit.
  overlay: { display: 'flex', flexDirection: 'column', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: theme.scrim },
  content: { display: 'flex', flexDirection: 'column', boxSizing: 'border-box', width: '100%', maxWidth: 640, maxHeight: '90%', gap: 16, padding: 24, backgroundColor: theme.colors.surface, borderRadius: theme.radius, borderColor: theme.colors.border, borderWidth: 1 },
  scroll: { flexShrink: 1 },
  body: { gap: 16 },
  title: { color: theme.colors.text, fontSize: 22 * theme.textScale, fontWeight: '600' },
  description: { color: theme.colors.muted, fontSize: 15 * theme.textScale },
}));
