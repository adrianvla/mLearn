/**
 * Common Components Index
 * Export all common UI components
 */

// ============ Unified Components (Preferred) ============
// Use these for all new code - they replace the legacy variants

export { 
  Button, 
  GlassBtn, 
  PillBtn, 
  IconBtn, 
  NavBtn, 
  TabBtn,
  type ButtonProps,
  type ButtonType,
  type ButtonVariant,
  type ButtonSize,
} from './Button';

export {
  Loader,
  Spinner,
  Skeleton,
  Progress,
  ProgressRing,
  LoadingOverlay as UnifiedLoadingOverlay,
  type LoaderProps,
  type LoaderType,
  type ProgressVariant,
} from './Loader';

export {
  Label,
  PillLabel,
  StatusLabel,
  Badge,
  Tag,
  Indicator,
  numericToStatus,
  statusToNumeric,
  getNextStatus as getNextLabelStatus,
  type LabelProps,
  type LabelType,
  type LabelVariant,
  type StatusType,
  type LabelSize,
  type StatusLabelProps,
} from './Label';

// ============ Cards ============

export { 
  ActionCard, 
  type ActionCardProps,
  GlassCard, 
  type GlassCardProps,
  CheckboxCard, 
  type CheckboxCardProps,
  SelectableCard, 
  type SelectableCardProps,
  RecentCard, 
  type RecentCardProps, 
  type RecentItem,
  StatCard, 
  type StatCardProps,
} from './Card';

// ============ Modals & Dialogs ============

export { 
  GlassModal, 
  BasicConfirmDialog, 
  type GlassModalProps, 
  type BasicConfirmDialogProps,
  ConfirmDialog, 
  useConfirmDialog, 
  type ConfirmDialogProps, 
  type ConfirmVariant, 
  type ConfirmOptions,
  WindowOverlay,
} from './Modal';

// ============ Inputs & Controls ============

export { 
  GlassInput, 
  GlassTextarea, 
  GlassSelect, 
  type GlassInputProps, 
  type GlassTextareaProps, 
  type GlassSelectProps,
  ContentEditable, 
  type ContentEditableProps,
  ToggleSwitch, 
  type ToggleSwitchProps,
  FormField, 
  type FormFieldProps,
  DropZone, 
  type DropZoneProps,
} from './Input';

// ============ Panels & Layout ============

export { 
  GlassPanel, 
  type GlassPanelProps,
  PanelHeader, 
  type PanelHeaderProps,
  WindowLayout, 
  WindowHeader, 
  type WindowLayoutProps, 
  type WindowHeaderProps,
} from './Panel';

// ============ Tabs & Navigation ============

export { 
  TabHeader, 
  type TabHeaderProps,
  TabContent, 
  type TabContentProps,
  TabContainer, 
  TabPanel, 
  type TabContainerProps, 
  type TabPanelProps, 
  type TabItem,
} from './Tabs';

// ============ Feedback ============

export { 
  EmptyState, 
  type EmptyStateProps, 
  type EmptyStateAction,
  AlertBanner, 
  type AlertBannerProps, 
  type AlertVariant,
  ConnectionStatus, 
  type ConnectionStatusProps, 
  type ConnectionState,
  LoadingOverlay, 
  type LoadingOverlayProps,
} from './Feedback';

// ============ Text & Display ============

export { 
  PitchAccent, 
  type PitchAccentProps,
  RubyText, 
  type RubyTextProps,
  FrequencyStars, 
  type FrequencyStarsProps,
  HintText, 
  type HintTextProps,
  BreakdownRow, 
  type BreakdownRowProps,
  LogConsole, 
  type LogConsoleProps,
} from './Text';

// ============ Settings Components ============

export { 
  SettingRow, 
  type SettingRowProps,
  SettingGroup, 
  type SettingGroupProps,
} from './Settings';

// ============ Layout Utilities ============

export { 
  Flex, 
  Row, 
  Column, 
  Center, 
  Spacer, 
  type FlexProps,
} from './Layout';

// ============ Miscellaneous ============

export { 
  IconRenderer, 
  type IconRendererProps,
  LegendItem, 
  type LegendItemProps,
  KeyboardShortcut, 
  ShortcutsList, 
  type KeyboardShortcutProps, 
  type ShortcutsListProps,
  SortableColumnHeader, 
  type SortableColumnHeaderProps, 
  type SortDirection,
  ModalFooter, 
  type ModalFooterProps,
  StatsGrid, 
  type StatsGridProps,
} from './Misc';

// ============ Legacy Components (Deprecated) ============
// These are kept for backwards compatibility but should not be used in new code
// GlassButton → GlassBtn, IconButton → IconBtn
// PillButton → PillBtn
// SkeletonLoader → Skeleton, SpinnerLoader → Spinner
// ProgressBar → Progress
// OCRProgressRing → ProgressRing
// Pill → PillLabel, StatusPill → StatusLabel

export { 
  GlassButton, 
  IconButton, 
  type GlassButtonProps, 
  type IconButtonProps,
  PillButton, 
  type PillButtonProps, 
  type PillVariant,
  Pill, 
  type PillProps,
  StatusPill, 
  type StatusPillProps,
  TabButton, 
  type TabButtonProps,
  WordStatusPill, 
  type WordStatusPillProps, 
  type WordStatusType, 
  numericToWordStatus, 
  wordStatusToNumeric, 
  getNextStatus,
  SkeletonLoader, 
  SpinnerLoader, 
  type SkeletonLoaderProps, 
  type SpinnerLoaderProps,
  ProgressBar, 
  type ProgressBarProps,
  OCRProgressRing, 
  type OCRProgressRingProps,
} from './_legacy';
