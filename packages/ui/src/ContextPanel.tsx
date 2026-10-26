import { useLayoutEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Platform, View, ScrollView, useWindowDimensions } from 'react-native';
import * as Primitive from '@rn-primitives/dialog';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from './Text';
import { Button } from './Button';
import type { TextAnchor } from './InlineWord';
import type { TextBounds } from './InlineWord.types';
export function ContextPanel({ title, anchor, onClose, children, footer, popover, onPopoverClose, sourceContext, alwaysShowContext = false, opaque = false }: PropsWithChildren<{
    title: string;
    anchor: TextAnchor;
    onClose: () => void;
    footer?: ReactNode;
    popover?: ReactNode;
    onPopoverClose?: () => void;
    sourceContext?: string;
    alwaysShowContext?: boolean;
    opaque?: boolean;
}>) {
    const window = useWindowDimensions();
    const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
    const { width, height } = viewport ?? window;
    const { theme } = useUnistyles();
    const material = opaque ? theme.media.panel : theme.media.translucentPanel;
    const [bounds, setBounds] = useState<TextBounds>(anchor);
    const [headerHeight, setHeaderHeight] = useState(0);
    const [footerHeight, setFooterHeight] = useState(0);
    useLayoutEffect(() => {
        let active = true;
        let revision = 0;
        const measure = () => {
            const current = ++revision;
            anchor.measure(value => {
                if (active && current === revision)
                    setBounds(previous => previous.x === value.x && previous.y === value.y &&
                        previous.width === value.width && previous.height === value.height ? previous : value);
            });
        };
        const stop = anchor.subscribe?.(measure);
        measure();
        return () => { active = false; stop?.(); };
    }, [anchor, width, height, theme.textScale, theme.spacing.medium]);
    const desktop = Platform.OS === 'web' && width >= 720;
    const panelWidth = Math.min(600, width - 24);
    const above = Math.max(0, bounds.y - 24);
    const below = Math.max(0, height - bounds.y - bounds.height - 24);
    // Keep at least one readable body/action region when enlarged text leaves
    // too little space beside the cue. Compact inspection retains its context.
    const anchored = desktop && Math.max(above, below) >= headerHeight + 128;
    const placeAbove = above >= Math.min(350 * theme.textScale, height * 0.72) || above >= below;
    const maxHeight = anchored
        ? Math.min(350 * theme.textScale, placeAbove ? above : below)
        : Math.min(height - 40, height * 0.75);
    return (
        <Primitive.Root open onOpenChange={open => { if (!open) onClose(); }}>
            <Primitive.Portal>
                <Primitive.Overlay asChild>
                    <View style={styles.overlay} onLayout={event => {
                        const { width, height } = event.nativeEvent.layout;
                        setViewport(current => current?.width === width && current.height === height ? current : { width, height });
                    }}>
                        <Primitive.Content asChild onEscapeKeyDown={event => {
                            if (popover && onPopoverClose) {
                                event.preventDefault();
                                onPopoverClose();
                            }
                        }} onCloseAutoFocus={event => {
                            event.preventDefault();
                            anchor.restoreFocus();
                        }}>
                            <View testID="inspector-panel" style={[
                                styles.panel,
                                {
                                    backgroundColor: Platform.OS === 'web' ? 'transparent' : anchored ? theme.media.panel : theme.media.chrome,
                                    borderColor: theme.media.border,
                                    borderRadius: theme.radius + 4,
                                    width: panelWidth,
                                    maxHeight,
                                },
                                anchored ? {
                                    position: 'absolute',
                                    left: Math.max(12, Math.min(width - panelWidth - 12, bounds.x + bounds.width / 2 - panelWidth / 2)),
                                    ...(placeAbove
                                        ? { bottom: height - bounds.y + 12 }
                                        : { top: bounds.y + bounds.height + 12 }),
                                } : { alignSelf: 'center', marginHorizontal: 'auto', marginBottom: 20 },
                            ]}>
                                {Platform.OS === 'web' ? <View pointerEvents="none"
                                    style={[styles.material, { backgroundColor: anchored ? material : theme.media.chrome }]} /> : null}
                                <View style={styles.header} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
                                        <View style={styles.heading}>
                                            <Primitive.Title asChild>
                                                <Text selectable numberOfLines={2} variant="inspectionTitle" tone="media">{title}</Text>
                                            </Primitive.Title>
                                        </View>
                                        <Primitive.Description asChild>
                                            <Text tone="media" muted variant="caption">Inspect</Text>
                                        </Primitive.Description>
                                        <Button label="Close Inspector" icon="close" iconOnly variant="media" size="compact" onPress={onClose} />
                                </View>
                                <ScrollView testID="inspector-body" style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
                                    {(!anchored || alwaysShowContext) && sourceContext ? <Text tone="media" variant="caption" selectable>{sourceContext}</Text> : null}
                                    {children}
                                </ScrollView>
                                {footer ? <ScrollView testID="inspector-footer"
                                    horizontal
                                    onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}
                                    style={[styles.footer, { maxHeight: Math.max(64, Math.min(maxHeight / 2, maxHeight - headerHeight - 64)) }]}
                                    contentContainerStyle={styles.footerContent} keyboardShouldPersistTaps="handled">
                                    {footer}
                                </ScrollView> : null}
                                {popover ? <ScrollView style={[styles.popover(opaque), { bottom: footerHeight,
                                    maxHeight: Math.max(80, maxHeight - headerHeight - footerHeight) }]}
                                    contentContainerStyle={styles.popoverContent} keyboardShouldPersistTaps="handled">
                                    {popover}
                                </ScrollView> : null}
                            </View>
                        </Primitive.Content>
                    </View>
                </Primitive.Overlay>
            </Primitive.Portal>
        </Primitive.Root>
    );
}
const styles = StyleSheet.create(theme => ({
    overlay: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', backgroundColor: 'transparent', _web: {
            position: 'fixed', zIndex: 1000
        }
    }, panel: {
        overflow: 'hidden', borderWidth: 1, _web: {
            boxShadow: '0 18px 50px -10px #00000055'
        }
    }, material: {
        // Keep blur off the content ancestor so an attached popover can blur
        // the dictionary text beneath it, not inherit a nested backdrop root.
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        _web: { backdropFilter: theme.media.backdrop }
    }, header: {
        flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.small, flexShrink: 0,
        paddingHorizontal: theme.spacing.medium, paddingTop: theme.spacing.medium, paddingBottom: theme.spacing.small
    }, heading: {
        flex: 1, minWidth: 0
    }, scroll: {
        flexShrink: 1, minHeight: 0
    }, body: {
        gap: theme.spacing.compact, paddingHorizontal: theme.spacing.medium, paddingBottom: theme.spacing.medium
    }, footer: {
        flexGrow: 0, flexShrink: 0, borderTopWidth: 1, borderTopColor: theme.media.border,
        backgroundColor: theme.media.footer
    }, footerContent: {
        padding: theme.spacing.compact, flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: theme.spacing.small
    }, popover: (opaque: boolean) => ({
        position: 'absolute', left: theme.spacing.medium, right: theme.spacing.medium, maxWidth: 360,
        borderWidth: 1, borderColor: theme.media.border, borderRadius: theme.radius / 2,
        backgroundColor: theme.media.chrome, _web: { backgroundColor: opaque ? theme.media.panel : theme.media.translucentPanel,
            backdropFilter: theme.media.backdrop, boxShadow: '0 8px 24px #00000040' }
    }), popoverContent: {
        padding: theme.spacing.small, gap: theme.spacing.small
    }
}));
