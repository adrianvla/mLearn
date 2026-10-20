import Svg, { Path } from 'react-native-svg';

// One portable, stroke-based family for chrome. Icons never own hit targets.
const paths = {
  arrowLeft: 'M19 12H5m6-6-6 6 6 6',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  volume: 'm11 5-6 5H2v4h3l6 5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  volumeOff: 'm11 5-6 5H2v4h3l6 5Zm5 4 6 6m0-6-6 6',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  shrink: 'M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5',
  subtitles: 'M3 5h18v14H3Zm4 6h3m4 0h3M7 15h10',
  transcript: 'M5 6h14M5 12h14M5 18h14',
  settings: 'm10 2-.6 3-2 .9-2.5-1.5-2 3.4L5 10v2l-2.1 2.2 2 3.4 2.5-1.5 2 .9.6 3h4l.6-3 2-.9 2.5 1.5 2-3.4L19 12v-2l2.1-2.2-2-3.4-2.5 1.5-2-.9L14 2ZM15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  palette: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8h2a4 4 0 0 0 4-4A9 9 0 0 0 12 3Zm-5 7h.01M10 6h.01M15 7h.01M6 14h.01',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18',
  package: 'm3 7 9-5 9 5v10l-9 5-9-5Zm0 0 9 5 9-5M12 12v10M7.5 4.5l9 5',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  video: 'M3 5h12v14H3Zm12 5 6-4v12l-6-4',
  book: 'M12 5C8 2 4 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
} as const;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, color }: {
  readonly name: IconName;
  readonly size?: number;
  readonly color: string;
}) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' ? color : 'none'}
    stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden>
    <Path d={paths[name]} />
  </Svg>;
}
