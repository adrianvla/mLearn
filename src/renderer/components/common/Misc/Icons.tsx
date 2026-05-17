/**
 * Shared SVG Icons
 * Common icons used across the application
 * Reduces duplication and ensures consistent styling
 */

import { Component, JSX, Show, splitProps } from 'solid-js';

export interface IconProps extends JSX.SvgSVGAttributes<SVGSVGElement> {
  /** Size in pixels (applies to both width and height) */
  size?: number;
  /** Stroke color */
  color?: string;
}

const createIcon = (
  paths: string | string[],
  defaultProps?: Partial<JSX.SvgSVGAttributes<SVGSVGElement>>
): Component<IconProps> => {
  return (props) => {
    const [local, svgProps] = splitProps(props, ['size', 'color']);
    const pathsArray = Array.isArray(paths) ? paths : [paths];
    
    return (
      <svg
        width={local.size ?? 20}
        height={local.size ?? 20}
        viewBox="0 0 24 24"
        fill="none"
        stroke={local.color ?? 'currentColor'}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        {...defaultProps}
        {...svgProps}
      >
        {pathsArray.map((d) => <path d={d} />)}
      </svg>
    );
  };
};

// ============ Close/Remove Icons ============

/** X icon - close, remove, cancel */
export const CloseIcon = createIcon('M18 6L6 18M6 6l12 12');

/** X icon (alternative) - thinner */
export const CrossIcon = createIcon(['M6 6l12 12', 'M6 18L18 6']);

// ============ Status Icons ============

/** Checkmark - success, complete, done */
export const CheckIcon = createIcon('M20 6L9 17l-5-5');

/** Circle with checkmark */
export const CheckCircleIcon = createIcon([
  'M22 11.08V12a10 10 0 1 1-5.93-9.14',
  'M22 4L12 14.01l-3-3',
]);

/** Warning triangle */
export const WarningIcon = createIcon([
  'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  'M12 9v4',
  'M12 17h.01',
]);

/** Info circle */
export const InfoIcon = createIcon([
  'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
  'M12 16v-4',
  'M12 8h.01',
]);

/** Error/Alert circle */
export const ErrorIcon = createIcon([
  'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
  'M15 9l-6 6',
  'M9 9l6 6',
]);

// ============ Action Icons ============

/** Plus icon - add, new */
export const PlusIcon = createIcon(['M12 5v14', 'M5 12h14']);

/** Minus icon - remove, subtract */
export const MinusIcon = createIcon('M5 12h14');

/** Edit/Pencil icon */
export const EditIcon = createIcon([
  'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
]);

/** Trash/Delete icon */
export const TrashIcon = createIcon([
  'M3 6h18',
  'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
]);

/** Settings/Gear icon */
export const SettingsIcon = createIcon([
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
]);

// ============ Navigation Icons ============

/** Chevron left - back, previous */
export const ChevronLeftIcon = createIcon('M15 18l-6-6 6-6');

/** Chevron right - next, forward */
export const ChevronRightIcon = createIcon('M9 18l6-6-6-6');

/** Chevron up */
export const ChevronUpIcon = createIcon('M18 15l-6-6-6 6');

/** Chevron down */
export const ChevronDownIcon = createIcon('M6 9l6 6 6-6');

/** Arrow left */
export const ArrowLeftIcon = createIcon(['M19 12H5', 'M12 19l-7-7 7-7']);

/** Arrow right */
export const ArrowRightIcon = createIcon(['M5 12h14', 'M12 5l7 7-7 7']);

// ============ Media Icons ============

/** Play icon */
export const PlayIcon = createIcon('M5 3l14 9-14 9V3z');

/** Pause icon */
export const PauseIcon = createIcon(['M6 4h4v16H6z', 'M14 4h4v16h-4z']);

/** Volume/Speaker icon */
export const VolumeIcon = createIcon([
  'M11 5L6 9H2v6h4l5 4V5z',
  'M19.07 4.93a10 10 0 0 1 0 14.14',
  'M15.54 8.46a5 5 0 0 1 0 7.07',
]);

// ============ AI/Bot Icons ============

/** Bot/AI icon — robot head (matches raw/Bot.tsx) */
export const BotIcon = createIcon([
  'M5 11h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z',
  'M14 5a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
  'M12 7v4',
  'M8 15.5v1',
  'M16 15.5v1',
]);

// ============ File/Folder Icons ============

/** Folder icon */
export const FolderIcon = createIcon(
  'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'
);

/** File icon */
export const FileIcon = createIcon([
  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
  'M14 2v6h6',
]);

// ============ Utility Icons ============

/** Search/Magnifying glass */
export const SearchIcon = createIcon([
  'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  'M21 21l-4.35-4.35',
]);

/** Refresh/Reload */
export const RefreshIcon = createIcon([
  'M23 4v6h-6',
  'M1 20v-6h6',
  'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
]);

/** External link */
export const ExternalLinkIcon = createIcon([
  'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  'M15 3h6v6',
  'M10 14L21 3',
]);

/** Copy/Clipboard */
export const CopyIcon = createIcon([
  'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
  'M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
]);

/** Eye/View */
export const EyeIcon = createIcon([
  'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z',
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
]);

/** Eye off/Hide */
export const EyeOffIcon = createIcon([
  'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24',
  'M1 1l22 22',
]);

// ============ Additional Icons ============

/** Clock/Timer icon */
export const ClockIcon = createIcon([
  'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
  'M12 6v6l4 2',
]);

/** Target/Crosshair icon */
export const TargetIcon = createIcon([
  'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
  'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
]);

/** Link/Chain icon */
export const LinkIcon = createIcon([
  'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
  'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
]);

/** Chat/Message bubble icon */
export const ChatIcon = createIcon(
  'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
);

/** Calendar icon */
export const CalendarIcon = createIcon([
  'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
  'M16 2v4',
  'M8 2v4',
  'M3 10h18',
]);

/** Video/Film icon */
export const VideoIcon = createIcon([
  'M23 7l-7 5 7 5V7z',
  'M14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z',
]);

/** Globe/World icon */
export const GlobeIcon = createIcon([
  'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
  'M2 12h20',
  'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
]);

/** Sparkles/Magic icon */
export const SparklesIcon = createIcon([
  'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z',
]);

/** Book/Reading icon */
export const BookIcon = createIcon([
  'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z',
  'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
]);

/** Bar chart/Stats icon */
export const BarChartIcon = createIcon([
  'M12 20V10',
  'M18 20V4',
  'M6 20v-4',
]);

/** Star icon */
export const StarIcon = createIcon(
  'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
);

/** Grid/Layout icon */
export const GridIcon = createIcon([
  'M3 3h7v7H3z',
  'M14 3h7v7h-7z',
  'M14 14h7v7h-7z',
  'M3 14h7v7H3z',
]);

/** Sort ascending */
export const SortAscIcon = createIcon([
  'M12 5v14',
  'M5 12l7-7 7 7',
]);

/** Sort descending */
export const SortDescIcon = createIcon([
  'M12 5v14',
  'M19 12l-7 7-7-7',
]);

/** Microphone icon */
export const MicrophoneIcon = createIcon([
  'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z',
  'M19 10v2a7 7 0 0 1-14 0v-2',
  'M12 19v4',
  'M8 23h8',
]);

/** Battery icon for low power mode indicator */
export const BatteryLowIcon = createIcon([
  'M3 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  'M23 10v4',
  'M5 10v4',
]);

/** Scissors icon */
export const ScissorsIcon = createIcon([
  'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'M20 4L8.12 15.88',
  'M14.47 14.48L20 20',
  'M8.12 8.12L12 12',
]);

/** Volume off/mute icon */
export const VolumeOffIcon = createIcon([
  'M11 5L6 9H2v6h4l5 4V5z',
  'M23 9l-6 6',
  'M17 9l6 6',
]);

/** Stealth/incognito icon — anonymous user with hat and glasses */
export const StealthIcon: Component<IconProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['size', 'color']);
  return (
    <svg
      width={local.size ?? 20}
      height={local.size ?? 20}
      viewBox="0 0 24 24"
      fill={local.color ?? 'currentColor'}
      stroke="none"
      {...svgProps}
    >
      <path d="M21 18h-1.028a.742.742 0 0 0-.493-.537 9.878 9.878 0 0 0-5.957 0 .742.742 0 0 0-.493.537h-2.057a.742.742 0 0 0-.493-.537 9.878 9.878 0 0 0-5.957 0 .74.74 0 0 0-.493.537H3a1 1 0 1 0 0 2h1v.201c0 1.233.91 2.272 2.164 2.473l1.833.292a2.621 2.621 0 0 0 2.126-.591A2.472 2.472 0 0 0 11 20.494V20h2v.494c0 .72.319 1.405.877 1.881a2.623 2.623 0 0 0 2.126.591l1.833-.292c1.254-.2 2.164-1.24 2.164-2.473V20h1a1 1 0 1 0 0-2zM17 7.367V5.935c0-.953-.48-1.824-1.285-2.332a2.728 2.728 0 0 0-2.655-.152l-.31.089c0-.849-.69-1.54-1.538-1.54H9.75A2.755 2.755 0 0 0 7 4.755v2.612C2.872 8 0 9.386 0 11c0 2.209 5.373 4 12 4s12-1.791 12-4c0-1.614-2.872-3-7-3.633z" />
    </svg>
  );
};

/** Anki logo icon */
export const AnkiIcon: Component<IconProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['size', 'color']);
  return (
    <svg
      width={local.size ?? 20}
      height={local.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={local.color ?? 'currentColor'}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      {...svgProps}
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M12 4v16" />
      <path d="M7 9l5 3-5 3" />
    </svg>
  );
};

// ============ Overlay Control Icons ============

export interface VolumeLevelIconProps extends IconProps {
  level: 'high' | 'low' | 'muted';
}

/** Volume icon with dynamic level indicator (high/low/muted) */
export const VolumeLevelIcon: Component<VolumeLevelIconProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['size', 'color', 'level']);
  return (
    <svg
      width={local.size ?? 20}
      height={local.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={local.color ?? 'currentColor'}
      stroke-width="2"
      {...svgProps}
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <Show when={local.level === 'high'}>
        <path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />
      </Show>
      <Show when={local.level === 'low'}>
        <path d="M15.54 8.46a5 5 0 010 7.07" />
      </Show>
      <Show when={local.level === 'muted'}>
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </Show>
    </svg>
  );
};

/** Subtitle/CC icon */
export const SubtitleIcon: Component<IconProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['size', 'color']);
  return (
    <svg
      width={local.size ?? 20}
      height={local.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={local.color ?? 'currentColor'}
      stroke-width="2"
      {...svgProps}
    >
      <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
      <line x1="6" y1="14" x2="18" y2="14" />
      <line x1="6" y1="18" x2="14" y2="18" />
    </svg>
  );
};

/** Drag handle icon (6-dot grid pattern) */
export const DragIcon: Component<IconProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['size', 'color']);
  return (
    <svg
      width={local.size ?? 16}
      height={local.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke={local.color ?? 'currentColor'}
      stroke-width="2"
      {...svgProps}
    >
      <circle cx="9" cy="5" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="19" r="1" />
    </svg>
  );
};

/** Resize handle icon (diagonal arrows) */
export const ResizeIcon: Component<IconProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['size', 'color']);
  return (
    <svg
      width={local.size ?? 16}
      height={local.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke={local.color ?? 'currentColor'}
      stroke-width="2"
      {...svgProps}
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
};

export interface AutoPositionIconProps extends IconProps {
  enabled: boolean;
}

/** Auto-position toggle icon */
export const AutoPositionIcon: Component<AutoPositionIconProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['size', 'color', 'enabled']);
  return (
    <svg
      width={local.size ?? 16}
      height={local.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke={local.color ?? 'currentColor'}
      stroke-width="2"
      {...svgProps}
    >
      <Show when={local.enabled} fallback={<>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </>}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
        <path d="M15 8l3 3-3 3" />
      </Show>
    </svg>
  );
};

/** People group / Users icon – two people, for watch together */
export const PeopleGroupIcon: Component<IconProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['size', 'color']);
  return (
    <svg
      width={local.size ?? 20}
      height={local.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={local.color ?? 'currentColor'}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      {...svgProps}
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
};

export interface TranslateIconProps extends IconProps {
  active?: boolean;
}

/** Translate / Language icon – for live word translator toggle */
export const TranslateIcon: Component<TranslateIconProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['size', 'color', 'active']);
  return (
    <svg
      width={local.size ?? 20}
      height={local.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={local.color ?? 'currentColor'}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      {...svgProps}
    >
      <Show when={local.active}>
        <path d="M10 5H20V14H13V20H5V13H10Z" fill="currentColor" opacity="0.25" />
      </Show>
      <path d="M4 4L5 5" />
      <path d="M3 7H9" />
      <path d="M6 7L3 12" />
      <path d="M6 7L9 12" />
      <path d="M10 5H20" />
      <path d="M20 5V14" />
      <path d="M5 13V20" />
      <path d="M5 20H13" />
      <path d="M14 20L17 12L20 20" />
      <path d="M15.5 16.5H18.5" />
    </svg>
  );
};

export default {
  CloseIcon,
  CrossIcon,
  CheckIcon,
  CheckCircleIcon,
  WarningIcon,
  InfoIcon,
  ErrorIcon,
  PlusIcon,
  MinusIcon,
  EditIcon,
  TrashIcon,
  SettingsIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  PlayIcon,
  PauseIcon,
  VolumeIcon,
  BotIcon,
  FolderIcon,
  FileIcon,
  SearchIcon,
  RefreshIcon,
  ExternalLinkIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ClockIcon,
  TargetIcon,
  LinkIcon,
  ChatIcon,
  CalendarIcon,
  VideoIcon,
  GlobeIcon,
  SparklesIcon,
  BookIcon,
  BarChartIcon,
  BatteryLowIcon,
  StarIcon,
  GridIcon,
  SortAscIcon,
  SortDescIcon,
  MicrophoneIcon,
  ScissorsIcon,
  VolumeOffIcon,
  StealthIcon,
  AnkiIcon,
  VolumeLevelIcon,
  SubtitleIcon,
  DragIcon,
  ResizeIcon,
  AutoPositionIcon,
};
