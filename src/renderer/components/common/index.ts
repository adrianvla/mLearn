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

// ============ Panels, Cards & Layout ============

export { GlassPanel, type GlassPanelProps } from './GlassPanel';
export { GlassCard, type GlassCardProps } from './GlassCard';
export { GlassModal, ConfirmDialog as BasicConfirmDialog, type GlassModalProps, type ConfirmDialogProps as BasicConfirmDialogProps } from './GlassModal';
export { ConfirmDialog, useConfirmDialog, type ConfirmDialogProps, type ConfirmVariant, type ConfirmOptions } from './ConfirmDialog';
export { ActionCard, type ActionCardProps } from './ActionCard';
export { RecentCard, type RecentCardProps, type RecentItem } from './RecentCard';
export { CheckboxCard, type CheckboxCardProps } from './CheckboxCard';
export { SelectableCard, type SelectableCardProps } from './SelectableCard';
export { WindowLayout, WindowHeader, type WindowLayoutProps, type WindowHeaderProps } from './WindowLayout';
export { Flex, Row, Column, Center, Spacer, type FlexProps } from './Flex';
export { PanelHeader, type PanelHeaderProps } from './PanelHeader';
export { DropZone, type DropZoneProps } from './DropZone';

// ============ Inputs & Controls ============

export { GlassInput, GlassTextarea, GlassSelect, type GlassInputProps, type GlassTextareaProps, type GlassSelectProps } from './GlassInput';
export { ToggleSwitch, type ToggleSwitchProps } from './ToggleSwitch';
export { ContentEditable, type ContentEditableProps } from './ContentEditable';

// ============ Tabs & Navigation ============

export { TabHeader, type TabHeaderProps } from './TabHeader';
export { TabContent, type TabContentProps } from './TabContent';
export { TabContainer, TabPanel, type TabContainerProps, type TabPanelProps, type TabItem } from './TabContainer';
export { TabButton, type TabButtonProps } from './TabButton';

// ============ Stats & Feedback ============

export { EmptyState, type EmptyStateProps, type EmptyStateAction } from './EmptyState';
export { StatCard, type StatCardProps } from './StatCard';
export { StatsGrid, type StatsGridProps } from './StatsGrid';
export { ConnectionStatus, type ConnectionStatusProps, type ConnectionState } from './ConnectionStatus';
export { AlertBanner, type AlertBannerProps, type AlertVariant } from './AlertBanner';
export { LoadingOverlay, type LoadingOverlayProps } from './LoadingOverlay';

// ============ Text & Display ============

export { PitchAccent, type PitchAccentProps } from './PitchAccent';
export { RubyText, type RubyTextProps } from './RubyText';
export { FrequencyStars, type FrequencyStarsProps } from './FrequencyStars';
export { HintText, type HintTextProps } from './HintText';
export { LegendItem, type LegendItemProps } from './LegendItem';
export { BreakdownRow, type BreakdownRowProps } from './BreakdownRow';
export { LogConsole, type LogConsoleProps } from './LogConsole';
export { IconRenderer, type IconRendererProps } from './IconRenderer';

// ============ Settings Components ============

export { SettingRow, type SettingRowProps } from './SettingRow';
export { SettingGroup, type SettingGroupProps } from './SettingGroup';
export { FormField, type FormFieldProps } from './FormField';
export { KeyboardShortcut, ShortcutsList, type KeyboardShortcutProps, type ShortcutsListProps } from './KeyboardShortcut';

// ============ Table & Sorting ============

export { SortableColumnHeader, type SortableColumnHeaderProps, type SortDirection } from './SortableColumnHeader';
export { ModalFooter, type ModalFooterProps } from './ModalFooter';

// ============ Specialized Status Components ============

export { WordStatusPill, type WordStatusPillProps, type WordStatusType, numericToWordStatus, wordStatusToNumeric, getNextStatus } from './WordStatusPill';

// ============ Legacy Components (Deprecated - use unified variants) ============
// These are kept for backwards compatibility but should not be used in new code
// GlassButton → GlassBtn, IconButton → IconBtn
// PillButton → PillBtn
// SkeletonLoader → Skeleton, SpinnerLoader → Spinner
// ProgressBar → Progress
// OCRProgressRing → ProgressRing
// Pill → PillLabel, StatusPill → StatusLabel

export { GlassButton, IconButton, type GlassButtonProps, type IconButtonProps } from './GlassButton';
export { PillButton, type PillButtonProps, type PillVariant } from './PillButton';
export { Pill, type PillProps } from './Pill';
export { StatusPill, type StatusPillProps } from './StatusPill';
export { SkeletonLoader, SpinnerLoader, type SkeletonLoaderProps, type SpinnerLoaderProps } from './SkeletonLoader';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { OCRProgressRing, type OCRProgressRingProps } from './OCRProgressRing';
