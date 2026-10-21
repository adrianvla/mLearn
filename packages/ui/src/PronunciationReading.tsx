import { useId } from 'react';
import { Text as NativeText, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { PronunciationContour } from '@mlearn/contracts';

type Role = 'subtitleRuby' | 'bodyRuby' | 'inspectionRuby' | 'inspectionReading' | 'subtitle' | 'body';

/** Draw package-supplied display heights; no linguistic categories are interpreted. */
export function PronunciationReading({ contour, variant = 'inspectionReading', pill = false, color }: {
    readonly contour: PronunciationContour;
    readonly variant?: Role;
    readonly pill?: boolean;
    readonly color?: string;
}) {
    const last = contour.units[contour.units.length - 1];
    const { theme } = useUnistyles();
    const foreground = color ?? (variant === 'body' ? theme.colors.text : variant === 'bodyRuby' ? theme.colors.muted
        : variant === 'subtitle' ? theme.media.text : theme.media.muted);
    return <View testID="pronunciation-reading" style={styles.word(pill)} accessible
        accessibilityLabel={`${contour.reading}. ${contour.label}. ${contour.attribution}`}>
        {contour.units.map((unit, index) => <View key={index} style={styles.unit}>
            <HeightLine variant={variant} height={unit.height} previous={contour.units[index - 1]?.height ?? unit.height} />
            <NativeText style={[styles.text(variant), { color: foreground }]}>{unit.text}</NativeText>
        </View>)}
        {last && contour.followingHeight !== null ? <View style={{ width: theme.typography[variant].fontSize / 2 }}>
            <HeightLine variant={variant} height={contour.followingHeight} previous={last.height} fade />
        </View> : null}
    </View>;
}

function HeightLine({ height, previous, variant, fade = false }: {
    readonly height: number;
    readonly previous: number;
    readonly variant: Role;
    readonly fade?: boolean;
}) {
    const { theme } = useUnistyles();
    const id = useId().replaceAll(':', '');
    const y = (value: number) => 1 + (1 - value) * 30;
    const color = `rgb(${[1, 3, 5].map(offset => {
        const low = Number.parseInt(theme.pronunciation.low.slice(offset, offset + 2), 16);
        const high = Number.parseInt(theme.pronunciation.high.slice(offset, offset + 2), 16);
        return Math.round(low + (high - low) * height);
    }).join(',')})`;
    return <View pointerEvents="none" style={styles.graph(variant)}>
        <Svg width="100%" height="100%" viewBox="0 0 1 32" preserveAspectRatio="none" aria-hidden>
        <Defs>
            <LinearGradient id={`${id}height`} gradientUnits="userSpaceOnUse" x1={0} y1={1} x2={0} y2={31}>
                <Stop offset="0" stopColor={theme.pronunciation.high} />
                <Stop offset="1" stopColor={theme.pronunciation.low} />
            </LinearGradient>
            <LinearGradient id={`${id}fade`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={1} y2={0}>
                <Stop offset="0" stopColor={color} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
        </Defs>
        <Path d={`M 0 ${y(previous)} L 0 ${y(height)}`} fill="none" stroke={`url(#${id}height)`}
            strokeWidth={theme.pronunciation.strokeWidth} vectorEffect="non-scaling-stroke" />
        <Path d={`M 0 ${y(height)} L 1 ${y(height)}`} fill="none" stroke={fade ? `url(#${id}fade)` : color}
            strokeWidth={theme.pronunciation.strokeWidth} vectorEffect="non-scaling-stroke" />
        </Svg>
    </View>;
}

const styles = StyleSheet.create(theme => ({
    word: (pill: boolean) => ({
        maxWidth: '100%', flexDirection: 'row', alignItems: 'stretch',
        ...(pill ? {
            borderRadius: theme.radius + 4, backgroundColor: theme.pills.neutral.surface,
            paddingHorizontal: theme.spacing.small, paddingVertical: theme.spacing.tiny,
        } : {}),
        _web: {
            display: 'inline-flex', verticalAlign: 'baseline',
            ...(pill ? { backgroundImage: `linear-gradient(${theme.pills.neutral.top}, ${theme.pills.neutral.surface})` } : {}),
        },
    }),
    unit: { position: 'relative', flexShrink: 1 },
    text: (variant: Role) => ({
        ...theme.typography[variant], flexShrink: 1,
        textAlign: 'center',
    }),
    // Contours follow glyph height, not the larger source line box.
    graph: (variant: Role) => ({ position: 'absolute',
        top: (theme.typography[variant].lineHeight - theme.typography[variant].fontSize) / 2,
        height: theme.typography[variant].fontSize, left: 0, right: 0, overflow: 'visible' }),
}));
