/**
 * Common Components Barrel Export
 * 
 * This file re-exports all common UI components for easy importing.
 * 
 * Note: Glass-prefixed aliases have been removed.
 * Use Btn, Modal, Panel, Input, Card etc. directly.
 */

// Button Components
export { 
  Button, 
  Btn,
  PillBtn, 
  IconBtn, 
  NavBtn, 
  TabBtn,
  type ButtonProps,
  type ButtonType,
  type ButtonVariant,
  type ButtonSize,
} from './Button';

// Modal Components
export { 
  Modal, 
  ConfirmDialog, 
  useConfirmDialog,
  WindowOverlay,
  LoadingOverlay as ModalLoadingOverlay,
  ErrorModal,
  DraggablePopup,
  type ModalProps,
  type ConfirmDialogProps, 
  type ConfirmVariant, 
  type ConfirmOptions,
  type WindowOverlayProps,
  type LoadingOverlayProps,
  type ErrorModalProps,
  type ErrorSeverity,
  type DraggablePopupProps,
} from './Modal';

// ModalForm Components
export {
  ModalForm,
  type ModalFormProps,
} from './ModalForm';

// Panel Components
export { 
  Panel,
  PanelHeader,
  WindowLayout, 
  WindowHeader,
  type PanelProps,
  type PanelHeaderProps,
  type WindowLayoutProps, 
  type WindowHeaderProps,
} from './Panel';

// Input Components
export { 
  Input,
  Textarea,
  SelectInput,
  ContentEditable,
  ToggleSwitch,
  FormField,
  DropZone,
  RangeInput,
  KeybindInput,
  parseKeybind,
  formatKeybindDisplay,
  getLocalizedKeyName,
  matchesKeybind,
  VoiceSamplePicker,
  type InputProps,
  type TextareaProps,
  type SelectInputProps,
  type ContentEditableProps,
  type ToggleSwitchProps,
  type FormFieldProps,
  type DropZoneProps,
  type RangeInputProps,
  type KeybindInputProps,
  type VoiceSamplePickerProps,
} from './Input';

// Card Components
export { 
  ActionCard,
  Card,
  CheckboxCard,
  SelectableCard,
  RecentCard,
  StatCard,
  type ActionCardProps,
  type CardProps,
  type CheckboxCardProps,
  type SelectableCardProps,
  type RecentCardProps,
  type RecentItem,
  type StatCardProps,
} from './Card';

// Select Components
export { Select, type SelectProps, type SelectOption } from './Select';

// SortableList Components
export { SortableList, type SortableListProps, type SortableListItem } from './SortableList';

// Label Components
export { 
  Label,
  PillLabel,
  LevelPillsFilter,
  StatusLabel,
  Badge,
  Tag,
  Indicator,
  numericToStatus,
  statusToNumeric,
  getNextStatus,
  type LabelProps,
  type LabelType,
  type LabelVariant,
  type StatusType,
  type LabelSize,
  type StatusLabelProps,
} from './Label';

// Loader Components
export { 
  Loader,
  Spinner,
  Skeleton,
  ProgressRing,
  InlineLoadingOverlay,
  type LoaderProps,
  type LoaderType,
} from './Loader';

// Feedback Components
export { 
  EmptyState,
  AlertBanner,
  ConnectionStatus,
  ProgressBar,
  type EmptyStateProps,
  type EmptyStateAction,
  type AlertBannerProps,
  type AlertVariant,
  type ConnectionStatusProps,
  type ConnectionState,
  type ProgressBarProps,
  FloatingStatus,
  type FloatingStatusProps,
} from './Feedback';

// Task Progress Components
export {
  TaskProgressContent,
  GroupedTaskProgressContent,
  type TaskStatus,
  type TaskState,
  type TaskGroup,
} from './TaskProgress/TaskProgress';

// Text Components
export { 
  PitchAccent,
  PitchAccentOverlay,
  RubyText,
  WordWithReading,
  FrequencyStars,
  HintText,
  BreakdownRow,
  LogConsole,
  type PitchAccentProps,
  type PitchAccentOverlayProps,
  type RubyTextProps,
  type WordWithReadingProps,
  type FrequencyStarsProps,
  type HintTextProps,
  type BreakdownRowProps,
  type LogConsoleProps,
} from './Text';

// Layout Components
export { 
  Flex,
  Row,
  Column,
  Center,
  Spacer,
  StatusBar,
  CollapsibleStickyHeader,
  type FlexProps,
  type StatusBarProps,
} from './Layout';

// Tabs Components
export { 
  TabHeader,
  TabContent,
  TabContainer,
  TabPanel,
  type TabHeaderProps,
  type TabContentProps,
  type TabContainerProps,
  type TabPanelProps,
  type TabItem,
} from './Tabs';

// Settings Components
export { 
  SettingRow,
  SettingGroup,
  type SettingRowProps,
  type SettingGroupProps,
} from './Settings';

// Misc Components
export { 
  IconRenderer,
  LegendItem,
  KeyboardShortcut,
  ShortcutsList,
  SortableColumnHeader,
  ModalFooter,
  StatsGrid,
  type IconRendererProps,
  type LegendItemProps,
  type KeyboardShortcutProps,
  type ShortcutsListProps,
  type SortableColumnHeaderProps,
  type SortDirection,
  type ModalFooterProps,
  type StatsGridProps,
} from './Misc';

// AnkiHoverPreview Components
export {
  AnkiHoverPreview,
  type AnkiHoverPreviewProps,
  type AnkiCardFields,
  type AnkiCardSchedulingInfo,
} from './AnkiHoverPreview';

// Tooltip
export {
  Tooltip,
  type TooltipProps,
} from './Tooltip';

// HoverReveal
export {
  HoverReveal,
  type HoverRevealProps,
} from './Misc';

// Icons (re-exported from Misc)
export {
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
  PeopleGroupIcon,
  TranslateIcon,
  type IconProps,
  type VolumeLevelIconProps,
  type AutoPositionIconProps,
} from './Misc';
