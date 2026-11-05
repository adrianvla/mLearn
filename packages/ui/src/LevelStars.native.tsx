import { useState } from 'react';
import { Text as NativeText, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import {
  LEVEL_STARS, LEVEL_STAR_PALETTE, LEVEL_STAR_PATH,
  levelStarsRank, levelStarsAvailableWidth, levelStarsCollapsed,
} from './LevelStars.types';
import type { LevelStarsProps } from './LevelStars.types';

/**
 * Stars only, inside the word's positioned View, with overflow left visible.
 * The absolute left/right edges make this root's onLayout width the word width,
 * not the intrinsic star-row width; no external measurement callback is needed.
 * Without nativeLayout, auto collapse conservatively uses only that word width.
 * With nativeLayout, the row owner supplies same-space neighbor rectangles.
 * Native uses the reference SVG and filter-derived fills, without CSS glow.
 */
export function LevelStars({
  rank, label, size = 'medium', collapse = 'auto', margin = LEVEL_STARS.margin, nativeLayout,
}: LevelStarsProps) {
  const [wordWidth, setWordWidth] = useState(0);
  const visualRank = levelStarsRank(rank);
  const metrics = LEVEL_STARS.sizes[size];
  const availableWidth = nativeLayout ? levelStarsAvailableWidth(nativeLayout, margin) : wordWidth;
  const collapsed = levelStarsCollapsed(collapse, visualRank * metrics.star, availableWidth);
  const palette = LEVEL_STAR_PALETTE[visualRank - 1] ?? LEVEL_STAR_PALETTE[0];

  if (visualRank === 0) return null;
  return <View accessible accessibilityRole="image" accessibilityLabel={label} pointerEvents="none"
    onLayout={event => setWordWidth(event.nativeEvent.layout.width)}
    style={[styles.root, { height: metrics.star + LEVEL_STARS.padding * 2 }]}>
    <View style={[styles.row, {
      minWidth: (collapsed ? 1 : visualRank) * metrics.star + (collapsed ? metrics.count : 0),
    }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {collapsed ? <NativeText style={styles.count(metrics.star, metrics.count, palette.color)}>
        {visualRank}
      </NativeText> : null}
      {Array.from({ length: collapsed ? 1 : visualRank }, (_, index) =>
        <Svg key={index} width={metrics.star} height={metrics.star} viewBox="0 0 24 24"
          fill={palette.color} opacity={LEVEL_STARS.opacity} accessible={false}
          style={{ transform: [{ translateY: -metrics.star / 2 }] }}>
          <Path d={LEVEL_STAR_PATH} />
        </Svg>)}
    </View>
  </View>;
}

const styles = StyleSheet.create(theme => ({
  root: {
    position: 'absolute', left: 0, right: 0, bottom: LEVEL_STARS.bottom,
    padding: LEVEL_STARS.padding, alignItems: 'center', justifyContent: 'center', overflow: 'visible',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  count: (star: number, count: number, color: string) => ({
    fontFamily: theme.typography.badge.fontFamily, fontWeight: LEVEL_STARS.countWeight,
    fontSize: count, lineHeight: star, includeFontPadding: false, color,
    opacity: LEVEL_STARS.opacity, position: 'relative', top: -star / 2, flexShrink: 0,
  }),
}));
