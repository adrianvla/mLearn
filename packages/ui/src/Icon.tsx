import Svg, { Path } from 'react-native-svg';

const cueArrow = 'M12 10.1976C11.9771 10.1821 11.9537 10.1669 11.93 10.152L6.94333 7.03536C5.66202 6.23454 4 7.15571 4 8.66669V15.3334C4 16.8443 5.66202 17.7655 6.94333 16.9647L11.93 13.848C11.9537 13.8332 11.9771 13.818 12 13.8025V14.6667C12 16.0286 13.4713 16.8825 14.6538 16.2067L19.0961 13.6683C20.387 12.9307 20.387 11.0694 19.0961 10.3318L14.6538 7.7933C13.4713 7.11759 12 7.97142 12 9.33336V10.1976Z';
// One portable, stroke-based family for chrome. Icons never own hit targets.
const paths = {
  arrowLeft: 'M19 12H5m6-6-6 6 6 6',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  previousCue: cueArrow,
  nextCue: cueArrow,
  sync: 'M20 7v5h-5M4 17v-5h5M6.1 8a7 7 0 0 1 11.6-2L20 9M4 15l2.3 3A7 7 0 0 0 17.9 16',
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M6 6h12v12H6Z',
  send: 'm22 2-7 20-5.5-7.5L2 9Zm0 0L9.5 14.5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
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
  checkCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-14 0 3 3 7-7',
  closeCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-12-3 6 6m0-6-6 6',
  circle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v.01',
  close: 'm6 6 12 12M6 18 18 6',
  video: 'M3 5h12v14H3Zm12 5 6-4v12l-6-4',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3Zm13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  book: 'M12 5C8 2 4 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15',
  conversation: 'M5 11h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM14 5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M12 7v4M8 15.5v1M16 15.5v1',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
} as const;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, color }: {
  readonly name: IconName;
  readonly size?: number;
  readonly color: string;
}) {
  const cue = name === 'previousCue' || name === 'nextCue';
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' || cue ? color : 'none'}
    stroke={cue ? 'none' : color} opacity={cue ? 0.6 : 1}
    strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden>
    <Path d={paths[name]} transform={name === 'previousCue' ? 'rotate(180 12 12)' : undefined} />
  </Svg>;
}
