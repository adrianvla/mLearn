import { createContext, useCallback, useState, type PropsWithChildren, type ReactElement } from 'react';
import { Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import * as Primitive from '@rn-primitives/dialog';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Button } from './Button';
import { Text } from './Text';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';

type Props = PropsWithChildren<{ open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; trigger: ReactElement; presentation?: 'dialog' | 'sidebar' }>;
export const dialogSidebarWidth = 320;
export const DialogPortalContext = createContext<HTMLElement | null>(null);
export function Dialog({ open, onOpenChange, title, description, trigger, children, presentation = 'dialog' }: Props) {
  const { height, width } = useWindowDimensions();
  const sidebar = presentation === 'sidebar' && Platform.OS === 'web' && width >= 720;
  const { theme } = useUnistyles();
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const contentRef = useCallback((node: View | null) => {
    setPortal(Platform.OS === 'web' && typeof HTMLElement !== 'undefined' && node instanceof HTMLElement ? node : null);
  }, []);
  return <DialogPortalContext.Provider value={portal}><Primitive.Root open={open} onOpenChange={onOpenChange}>
    <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
    <Primitive.Portal>
      <Primitive.Overlay asChild>
        <View style={[styles.overlay, sidebar && styles.sidebarOverlay]}>
          <KeyboardAvoidingView enabled={Platform.OS !== 'web'}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardFrame(sidebar)}>
          <View style={[styles.bounds, sidebar && styles.sidebarBounds]}>
            <Primitive.Content asChild
              // Native Content claims the initial responder by default.
              // Leave pan ownership to its ScrollView, not the wrapper.
              onStartShouldSetResponder={Platform.OS === 'web' ? undefined : () => false}>
              <View ref={contentRef} style={[styles.content(height), sidebar && styles.sidebarContent(height), { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: sidebar ? 0 : theme.radius }]} testID="dialog-surface">
                <View style={styles.header}>
                  <View style={styles.title}><Primitive.Title asChild><Text variant={sidebar ? 'section' : 'heading'}>{title}</Text></Primitive.Title></View>
                  <Primitive.Close asChild><Button label="Close" icon="close" iconOnly variant="quiet" size="compact" /></Primitive.Close>
                </View>
                <Primitive.Description asChild><Text muted variant="caption">{description}</Text></Primitive.Description>
                <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                  {children}
                </ScrollView>
              </View>
            </Primitive.Content>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Primitive.Overlay>
    </Primitive.Portal>
  </Primitive.Root></DialogPortalContext.Provider>;
}
const styles = StyleSheet.create((theme) => ({
  // Style the native View itself: RN Primitives adds unstyled DOM wrappers on web.
  // A fixed web overlay must not move when focus scrolls the underlying page.
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.comfortable, backgroundColor: theme.scrim, _web: { position: 'fixed', zIndex: 1000 } },
  bounds: { width: '100%', maxWidth: 640, maxHeight: '100%', flexShrink: 1 },
  // RN Primitives' web overlay ref must remain a DOM-backed View, not the
  // KeyboardAvoidingView class instance. The keyboard owner stays inside it.
  keyboardFrame: (sidebar: boolean) => ({ flex: 1, width: '100%',
    alignItems: sidebar ? 'flex-end' : 'center', justifyContent: 'center' }),
  sidebarOverlay: { alignItems: 'flex-end', padding: 0, backgroundColor: 'transparent' },
  sidebarBounds: { width: dialogSidebarWidth, maxWidth: '100%', height: '100%' },
  sidebarContent: (height: number) => ({ height, maxHeight: height, borderTopWidth: 0, borderBottomWidth: 0, borderRightWidth: 0 }),
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small },
  title: { flex: 1, minWidth: 0 },
  // Content crosses a third-party asChild/portal boundary. Resolve its palette
  // through useUnistyles so a surface mounted after a theme change cannot keep
  // the initial palette while its child controls use the active theme.
  content: (height: number) => ({ width: '100%', maxHeight: Math.max(0, height - 2 * theme.spacing.comfortable), flexShrink: 1, gap: theme.spacing.medium, padding: theme.spacing.large, borderWidth: 1 }),
  scroll: { flexShrink: 1, minHeight: 0 },
  body: { gap: theme.spacing.medium },
}));
