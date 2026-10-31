import { createContext, useCallback, useEffect, useRef, useState, type PropsWithChildren, type ReactElement, type ReactNode } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, ScrollView, View, useWindowDimensions, type Text as NativeText } from 'react-native';
import * as Primitive from '@rn-primitives/dialog';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Button } from './Button';
import { Text } from './Text';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { revealScrollFocus } from './scrollFocus';

type Props = PropsWithChildren<{
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; presentation?: 'dialog' | 'sidebar';
  modal?: boolean;
  size?: 'standard' | 'wide';
  closeLabel?: string;
  initialFocus?: 'control' | 'title';
  floatingControls?: (focusTarget: () => View | null) => ReactNode;
} & ({ trigger: ReactElement; focusTarget?: () => View | null } | { trigger?: never; focusTarget: () => View | null })>;
export const dialogSidebarWidth = 320;
export const dialogSidebarBreakpoint = 720;
export const DialogPortalContext = createContext<HTMLElement | null>(null);
export function Dialog({ open, onOpenChange, title, description, trigger, focusTarget, children, floatingControls,
  presentation = 'dialog', modal = true, size = 'standard', closeLabel = 'Close', initialFocus = 'control' }: Props) {
  const { height, width } = useWindowDimensions();
  const webSidebar = presentation === 'sidebar' && Platform.OS === 'web';
  const sidebar = webSidebar && width >= dialogSidebarBreakpoint;
  const { theme } = useUnistyles();
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const closeTarget = useRef<View>(null);
  const titleTarget = useRef<NativeText>(null);
  const focusedTitle = useRef(false);
  useEffect(() => { if (!open) focusedTitle.current = false; }, [open]);
  const contentRef = useCallback((node: View | null) => {
    setPortal(Platform.OS === 'web' && typeof HTMLElement !== 'undefined' && node instanceof HTMLElement ? node : null);
  }, []);
  const restoreFocus = useCallback(() => {
    const target = focusTarget?.();
    if (!target) return;
    if (Platform.OS === 'web') target.focus();
    else AccessibilityInfo.sendAccessibilityEvent(target, 'focus');
  }, [focusTarget]);
  const wasOpen = useRef(open);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    // Native Content has no onCloseAutoFocus; normally Trigger owns this return.
    if (Platform.OS !== 'web' && closed) restoreFocus();
  }, [open, restoreFocus]);
  const descriptionText = <Primitive.Description asChild>
    <Text muted variant={sidebar ? 'detail' : 'caption'} accessibilityLiveRegion={sidebar ? 'polite' : undefined}>{description}</Text>
  </Primitive.Description>;
  // Keep the same nonmodal content owner across the drawer breakpoint so
  // resizing cannot discard pending capture receipts inside the sidebar.
  const frame = <View pointerEvents={sidebar ? 'box-none' : 'auto'} style={[styles.overlay, sidebar && styles.sidebarOverlay]}>
          <KeyboardAvoidingView enabled={Platform.OS !== 'web'}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardFrame(sidebar)}>
          <View style={[styles.bounds(size === 'wide'), sidebar && styles.sidebarBounds]}>
            <Primitive.Content asChild
              onOpenAutoFocus={initialFocus === 'title' ? event => {
                event.preventDefault(); titleTarget.current?.focus();
              } : sidebar && !modal ? event => event.preventDefault() : undefined}
              onInteractOutside={sidebar && !modal ? event => event.preventDefault() : undefined}
              onCloseAutoFocus={focusTarget ? event => { event.preventDefault(); restoreFocus(); } : undefined}
              // Native Content claims the initial responder by default.
              // Leave pan ownership to its ScrollView, not the wrapper.
              onStartShouldSetResponder={Platform.OS === 'web' ? undefined : () => false}>
              <View ref={contentRef} style={[styles.content(height), sidebar && styles.sidebarContent(height), { backgroundColor: sidebar ? theme.colors.background : theme.colors.surface, borderColor: theme.colors.border, borderRadius: sidebar ? 0 : theme.radius }]} testID="dialog-surface">
                <View style={[styles.header, sidebar && styles.sidebarHeader]}>
                  <View style={styles.title}>
                    <Primitive.Title asChild><Text ref={titleTarget} accessibilityRole="header" accessible
                      tabIndex={initialFocus === 'title' ? -1 : undefined}
                      variant={sidebar ? 'sidebarTitle' : 'heading'} muted={sidebar} onLayout={() => {
                        if (Platform.OS !== 'web' && open && initialFocus === 'title' && !focusedTitle.current) {
                          const tag = findNodeHandle(titleTarget.current);
                          if (tag) { focusedTitle.current = true; AccessibilityInfo.setAccessibilityFocus(tag); }
                        }
                      }}>{title}</Text></Primitive.Title>
                    {sidebar ? descriptionText : null}
                  </View>
                  <Primitive.Close asChild><Button ref={closeTarget} label={closeLabel} icon={sidebar ? 'chevronDown' : 'close'} iconOnly variant="quiet" size="compact" /></Primitive.Close>
                </View>
                {!sidebar ? descriptionText : null}
                <ScrollView onFocus={revealScrollFocus} style={styles.scroll} contentContainerStyle={styles.body(sidebar)} keyboardShouldPersistTaps="handled">
                  {children}
                </ScrollView>
                {sidebar ? floatingControls?.(() => closeTarget.current) : null}
              </View>
            </Primitive.Content>
          </View>
          </KeyboardAvoidingView>
        </View>;
  return <DialogPortalContext.Provider value={portal}><Primitive.Root open={open} onOpenChange={onOpenChange}
    {...(Platform.OS === 'web' ? { modal } : {})}>
    {trigger ? <Primitive.Trigger asChild>{trigger}</Primitive.Trigger> : null}
    <Primitive.Portal>
      {/* Radix clones its direct portal child. Keep themed frame styles below
          that boundary, as they are below Overlay for ordinary dialogs. */}
      {webSidebar && !modal ? <View pointerEvents="box-none">{frame}</View> : <Primitive.Overlay asChild>{frame}</Primitive.Overlay>}
    </Primitive.Portal>
  </Primitive.Root></DialogPortalContext.Provider>;
}
const styles = StyleSheet.create((theme) => ({
  // Style the native View itself: RN Primitives adds unstyled DOM wrappers on web.
  // A fixed web overlay must not move when focus scrolls the underlying page.
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.comfortable, backgroundColor: theme.scrim, _web: { position: 'fixed', zIndex: 1000 } },
  bounds: (wide: boolean) => ({ width: '100%', maxWidth: wide ? 768 : 640, maxHeight: '100%', flexShrink: 1 }),
  // RN Primitives' web overlay ref must remain a DOM-backed View, not the
  // KeyboardAvoidingView class instance. The keyboard owner stays inside it.
  keyboardFrame: (sidebar: boolean) => ({ flex: 1, width: sidebar ? dialogSidebarWidth : '100%',
    alignItems: sidebar ? 'flex-end' : 'center', justifyContent: 'center' }),
  sidebarOverlay: { alignItems: 'flex-end', padding: 0, backgroundColor: 'transparent' },
  sidebarBounds: { width: dialogSidebarWidth, maxWidth: '100%', height: '100%' },
  sidebarContent: (height: number) => ({ height, maxHeight: height, padding: 0, gap: 0,
    borderTopWidth: 0, borderBottomWidth: 0, borderRightWidth: 0 }),
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small },
  sidebarHeader: { alignItems: 'flex-start', padding: theme.spacing.medium,
    paddingBottom: theme.spacing.compact, backgroundColor: theme.colors.surface },
  title: { flex: 1, minWidth: 0, gap: theme.spacing.tiny },
  // Content crosses a third-party asChild/portal boundary. Resolve its palette
  // through useUnistyles so a surface mounted after a theme change cannot keep
  // the initial palette while its child controls use the active theme.
  content: (height: number) => ({ width: '100%', maxHeight: Math.max(0, height - 2 * theme.spacing.comfortable), flexShrink: 1, gap: theme.spacing.medium, padding: theme.spacing.large, borderWidth: 1 }),
  scroll: { flexShrink: 1, minHeight: 0 },
  body: (sidebar: boolean) => ({ gap: theme.spacing.medium, padding: sidebar ? theme.spacing.medium : 0 }),
}));
