import { forwardRef, useCallback, useContext, useEffect, useRef } from 'react';
import { Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Primitive from '@rn-primitives/dropdown-menu';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Button } from './Button';
import type { IconName } from './Icon';
import { DialogPortalContext } from './Dialog';

type Action = {
  readonly id: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly current?: boolean;
};

/** One action per opening, with platform-owned positioning and keyboard focus. */
export const Menu = forwardRef<View, {
  readonly label: string;
  readonly icon: IconName;
  readonly actions: readonly Action[];
  readonly disabled?: boolean;
}>(function Menu({ label, icon, actions, disabled = false }, ref) {
  const { theme } = useUnistyles();
  const { width, height } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const portal = useContext(DialogPortalContext);
  const chosen = useRef(false);
  const queued = useRef<Action | null>(null);
  const trigger = useRef<View | null>(null);
  const triggerRef = useCallback((node: View | null) => {
    trigger.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  useEffect(() => () => { queued.current = null; }, []);
  const publishChoice = useCallback((event: Event) => {
    const action = queued.current;
    queued.current = null;
    if (!action) return;
    // Opening a drawer before the menu restores focus makes the menu and
    // drawer focus scopes compete, dismissing the newly opened compact pane.
    event.preventDefault();
    trigger.current?.focus();
    action.onPress();
  }, []);
  return <Primitive.Root onOpenChange={open => { if (open) chosen.current = false; }}>
    <Primitive.Trigger asChild disabled={disabled}>
      <Button ref={triggerRef} label={label} icon={icon} iconOnly variant="media" size="compact" disabled={disabled} />
    </Primitive.Trigger>
    <Primitive.Portal container={portal ?? undefined}>
      <Primitive.Overlay style={styles.overlay}>
        <Primitive.Content asChild side="top" align="end" sideOffset={4}
          {...(Platform.OS === 'web' ? { onCloseAutoFocus: publishChoice } : {})}
          insets={{ top: safeArea.top + 12, right: safeArea.right + 12,
            bottom: safeArea.bottom + 12, left: safeArea.left + 12 }}>
          <View testID="menu-surface" style={[styles.content, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
            maxWidth: width - 24, maxHeight: Math.min(320, height - 40) }]}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.actions} keyboardShouldPersistTaps="handled">
              {actions.map(action => <Primitive.Item key={action.id} asChild textValue={action.label}
                disabled={action.disabled} onPress={() => {
                  if (chosen.current) return;
                  chosen.current = true;
                  if (Platform.OS === 'web') queued.current = action;
                  else action.onPress();
                }}>
                <Button testID={`menu-action-${action.id}`} label={action.label} accessibilityLabel={action.current ? `${action.label}, current` : action.label}
                  accessibilityRole="menuitem" icon={action.current ? 'check' : undefined}
                  variant="quiet" size="compact" disabled={action.disabled} />
              </Primitive.Item>)}
            </ScrollView>
          </View>
        </Primitive.Content>
      </Primitive.Overlay>
    </Primitive.Portal>
  </Primitive.Root>;
});
const styles = StyleSheet.create(theme => ({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    // Native actions must win hit testing over absolute source chrome too.
    zIndex: 1100, _web: { position: 'fixed' } },
  content: { minWidth: 180, borderWidth: 1, borderRadius: theme.radius,
    _web: { boxShadow: '0 8px 24px #00000040' } },
  scroll: { flexShrink: 1 },
  actions: { padding: theme.spacing.tiny, gap: theme.spacing.tiny },
}));
