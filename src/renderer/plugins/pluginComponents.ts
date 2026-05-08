import {
  Btn,
  PillBtn,
  IconBtn,
  NavBtn,
  TabBtn,
  Modal,
  ConfirmDialog,
  WindowOverlay,
  ModalLoadingOverlay,
  ErrorModal,
  DraggablePopup,
  Panel,
  PanelHeader,
  WindowLayout,
  WindowHeader,
  Input,
  Textarea,
  SelectInput,
  ToggleSwitch,
  FormField,
  RangeInput,
  Card,
  ActionCard,
  CheckboxCard,
  SelectableCard,
  RecentCard,
  StatCard,
  Select,
  Label,
  PillLabel,
  Badge,
  Tag,
  Indicator,
  Loader,
  Spinner,
  Skeleton,
  ProgressRing,
  InlineLoadingOverlay,
  EmptyState,
  AlertBanner,
  ProgressBar,
  FloatingStatus,
  Flex,
  Row,
  Column,
  Center,
  Spacer,
  TabHeader,
  TabContent,
  TabContainer,
  TabPanel,
  SettingRow,
  SettingGroup,
  Tooltip,
  HoverReveal,
  KeyboardShortcut,
  StatsGrid,
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
} from '../components/common';

export type {
  ButtonProps,
  ButtonType,
  ButtonVariant,
  ButtonSize,
  ModalProps,
  ConfirmDialogProps,
  ConfirmVariant,
  ConfirmOptions,
  WindowOverlayProps,
  LoadingOverlayProps,
  ErrorModalProps,
  ErrorSeverity,
  DraggablePopupProps,
  PanelProps,
  PanelHeaderProps,
  WindowLayoutProps,
  WindowHeaderProps,
  InputProps,
  TextareaProps,
  SelectInputProps,
  ToggleSwitchProps,
  FormFieldProps,
  RangeInputProps,
  CardProps,
  ActionCardProps,
  CheckboxCardProps,
  SelectableCardProps,
  RecentCardProps,
  StatCardProps,
  SelectProps,
  SelectOption,
  LabelProps,
  LabelType,
  LabelVariant,
  LabelSize,
  StatusLabelProps,
  StatusType,
  LoaderProps,
  LoaderType,
  EmptyStateProps,
  EmptyStateAction,
  AlertBannerProps,
  AlertVariant,
  ProgressBarProps,
  FloatingStatusProps,
  FlexProps,
  StatusBarProps,
  TabHeaderProps,
  TabContentProps,
  TabContainerProps,
  TabPanelProps,
  SettingRowProps,
  SettingGroupProps,
  TooltipProps,
  HoverRevealProps,
  KeyboardShortcutProps,
  StatsGridProps,
  IconProps,
} from '../components/common';

export interface PluginComponentLibrary {
  Btn: typeof Btn;
  PillBtn: typeof PillBtn;
  IconBtn: typeof IconBtn;
  NavBtn: typeof NavBtn;
  TabBtn: typeof TabBtn;
  Modal: typeof Modal;
  ConfirmDialog: typeof ConfirmDialog;
  WindowOverlay: typeof WindowOverlay;
  ModalLoadingOverlay: typeof ModalLoadingOverlay;
  ErrorModal: typeof ErrorModal;
  DraggablePopup: typeof DraggablePopup;
  Panel: typeof Panel;
  PanelHeader: typeof PanelHeader;
  WindowLayout: typeof WindowLayout;
  WindowHeader: typeof WindowHeader;
  Input: typeof Input;
  Textarea: typeof Textarea;
  SelectInput: typeof SelectInput;
  ToggleSwitch: typeof ToggleSwitch;
  FormField: typeof FormField;
  RangeInput: typeof RangeInput;
  Card: typeof Card;
  ActionCard: typeof ActionCard;
  CheckboxCard: typeof CheckboxCard;
  SelectableCard: typeof SelectableCard;
  RecentCard: typeof RecentCard;
  StatCard: typeof StatCard;
  Select: typeof Select;
  Label: typeof Label;
  PillLabel: typeof PillLabel;
  Badge: typeof Badge;
  Tag: typeof Tag;
  Indicator: typeof Indicator;
  Loader: typeof Loader;
  Spinner: typeof Spinner;
  Skeleton: typeof Skeleton;
  ProgressRing: typeof ProgressRing;
  InlineLoadingOverlay: typeof InlineLoadingOverlay;
  EmptyState: typeof EmptyState;
  AlertBanner: typeof AlertBanner;
  ProgressBar: typeof ProgressBar;
  FloatingStatus: typeof FloatingStatus;
  Flex: typeof Flex;
  Row: typeof Row;
  Column: typeof Column;
  Center: typeof Center;
  Spacer: typeof Spacer;
  TabHeader: typeof TabHeader;
  TabContent: typeof TabContent;
  TabContainer: typeof TabContainer;
  TabPanel: typeof TabPanel;
  SettingRow: typeof SettingRow;
  SettingGroup: typeof SettingGroup;
  Tooltip: typeof Tooltip;
  HoverReveal: typeof HoverReveal;
  KeyboardShortcut: typeof KeyboardShortcut;
  StatsGrid: typeof StatsGrid;
  CloseIcon: typeof CloseIcon;
  CrossIcon: typeof CrossIcon;
  CheckIcon: typeof CheckIcon;
  CheckCircleIcon: typeof CheckCircleIcon;
  WarningIcon: typeof WarningIcon;
  InfoIcon: typeof InfoIcon;
  ErrorIcon: typeof ErrorIcon;
  PlusIcon: typeof PlusIcon;
  MinusIcon: typeof MinusIcon;
  EditIcon: typeof EditIcon;
  TrashIcon: typeof TrashIcon;
  SettingsIcon: typeof SettingsIcon;
  ChevronLeftIcon: typeof ChevronLeftIcon;
  ChevronRightIcon: typeof ChevronRightIcon;
  ChevronUpIcon: typeof ChevronUpIcon;
  ChevronDownIcon: typeof ChevronDownIcon;
  ArrowLeftIcon: typeof ArrowLeftIcon;
  ArrowRightIcon: typeof ArrowRightIcon;
  PlayIcon: typeof PlayIcon;
  PauseIcon: typeof PauseIcon;
  VolumeIcon: typeof VolumeIcon;
  BotIcon: typeof BotIcon;
  FolderIcon: typeof FolderIcon;
  FileIcon: typeof FileIcon;
  SearchIcon: typeof SearchIcon;
  RefreshIcon: typeof RefreshIcon;
  ExternalLinkIcon: typeof ExternalLinkIcon;
  CopyIcon: typeof CopyIcon;
  EyeIcon: typeof EyeIcon;
  EyeOffIcon: typeof EyeOffIcon;
  ClockIcon: typeof ClockIcon;
  TargetIcon: typeof TargetIcon;
  LinkIcon: typeof LinkIcon;
  ChatIcon: typeof ChatIcon;
  CalendarIcon: typeof CalendarIcon;
  VideoIcon: typeof VideoIcon;
  GlobeIcon: typeof GlobeIcon;
  SparklesIcon: typeof SparklesIcon;
  BookIcon: typeof BookIcon;
  BarChartIcon: typeof BarChartIcon;
  BatteryLowIcon: typeof BatteryLowIcon;
  StarIcon: typeof StarIcon;
  GridIcon: typeof GridIcon;
  SortAscIcon: typeof SortAscIcon;
  SortDescIcon: typeof SortDescIcon;
  MicrophoneIcon: typeof MicrophoneIcon;
  ScissorsIcon: typeof ScissorsIcon;
  VolumeOffIcon: typeof VolumeOffIcon;
  StealthIcon: typeof StealthIcon;
  AnkiIcon: typeof AnkiIcon;
}

export const pluginComponentLibrary: PluginComponentLibrary = {
  Btn,
  PillBtn,
  IconBtn,
  NavBtn,
  TabBtn,
  Modal,
  ConfirmDialog,
  WindowOverlay,
  ModalLoadingOverlay,
  ErrorModal,
  DraggablePopup,
  Panel,
  PanelHeader,
  WindowLayout,
  WindowHeader,
  Input,
  Textarea,
  SelectInput,
  ToggleSwitch,
  FormField,
  RangeInput,
  Card,
  ActionCard,
  CheckboxCard,
  SelectableCard,
  RecentCard,
  StatCard,
  Select,
  Label,
  PillLabel,
  Badge,
  Tag,
  Indicator,
  Loader,
  Spinner,
  Skeleton,
  ProgressRing,
  InlineLoadingOverlay,
  EmptyState,
  AlertBanner,
  ProgressBar,
  FloatingStatus,
  Flex,
  Row,
  Column,
  Center,
  Spacer,
  TabHeader,
  TabContent,
  TabContainer,
  TabPanel,
  SettingRow,
  SettingGroup,
  Tooltip,
  HoverReveal,
  KeyboardShortcut,
  StatsGrid,
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
};

export default pluginComponentLibrary;
