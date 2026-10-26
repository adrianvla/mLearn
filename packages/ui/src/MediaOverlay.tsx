import { useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from './Button';

/** Media controls share hover/focus disclosure; touch always retains a close target. */
export function MediaOverlay({ children, controls, onClose, closeLabel, variant, testID }: {
    readonly children?: ReactNode;
    readonly onClose: () => void;
    readonly closeLabel: string;
    readonly testID?: string;
} & ({ readonly variant: 'cards'; readonly controls?: never }
    | { readonly variant: 'synchronization'; readonly controls: ReactNode })) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const revealed = Platform.OS !== 'web' || hovered || focused;
    const focus = Platform.OS === 'web' ? {
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
    } : {};
    const close = <View pointerEvents={revealed ? 'auto' : 'none'}
        aria-hidden={!revealed} style={[styles.close(revealed, variant),
            variant === 'synchronization' ? styles.syncHeader(revealed) : null]}>
        <Button label={closeLabel} icon="close" iconOnly
            variant={variant === 'synchronization' ? 'mediaClose' : 'media'} size="compact"
            disabled={!revealed} onPress={onClose} />
    </View>;
    return <View {...focus} testID={testID} style={styles.panel(variant, revealed)}
        onPointerEnter={event => { if (event.nativeEvent.pointerType !== 'touch') setHovered(true); }}
        onPointerLeave={() => setHovered(false)}>
        {Platform.OS === 'web' ? <View pointerEvents="none" style={styles.material(variant, revealed)} /> : null}
        {close}
        <View style={styles.content(variant)}>
            {variant === 'synchronization' ? <View style={styles.controls}>{controls}</View> : null}
            {children}
        </View>
    </View>;
}

const styles = StyleSheet.create(theme => ({
    panel: (variant: 'cards' | 'synchronization', revealed: boolean) => ({
        flexDirection: 'row', alignItems: variant === 'cards' ? 'flex-end' : 'center',
        maxWidth: '100%', borderRadius: theme.radius + 4,
        backgroundColor: variant === 'synchronization' || revealed ? theme.media.panel : 'transparent',
        _web: { backgroundColor: 'transparent' },
    }),
    material: (variant: 'cards' | 'synchronization', revealed: boolean) => ({
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: theme.radius + 4,
        backgroundColor: variant === 'synchronization' || revealed ? theme.media.panel : 'transparent',
        _web: {
            backgroundColor: variant === 'synchronization' || revealed ? theme.media.translucentPanel : 'transparent',
            backdropFilter: variant === 'synchronization' || revealed ? theme.media.backdrop : undefined,
        },
    }),
    content: (variant: 'cards' | 'synchronization') => ({
        flexShrink: 1, minWidth: 0,
        paddingVertical: variant === 'synchronization' ? 5 : 0,
        paddingHorizontal: variant === 'synchronization' ? theme.spacing.small + theme.spacing.tiny / 2 : 0,
    }),
    controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
        gap: theme.spacing.small + theme.spacing.tiny / 2 },
    close: (revealed: boolean, variant: 'cards' | 'synchronization') => ({
        width: revealed ? Platform.OS === 'web' ? 40 : 44 : 0,
        opacity: revealed ? 1 : 0, overflow: 'hidden',
        marginBottom: variant === 'cards' ? 10 : 0,
    }),
    syncHeader: (revealed: boolean) => ({
        width: revealed ? Platform.OS === 'web' ? 50 : 54 : 1,
        borderRightWidth: 1, borderRightColor: revealed ? theme.media.border : 'transparent',
        paddingLeft: revealed ? 5 : 0, alignSelf: 'stretch',
        alignItems: 'flex-start', justifyContent: 'center',
    }),
}));
