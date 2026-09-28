import { createComponent, mergeProps, type Component } from 'solid-js';
import { Button, type ButtonProps, type ButtonType } from '../components/common/Button';
import {
  Modal,
  ConfirmDialog,
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
  ColorInput,
  FormField,
  RangeInput,
  RangeNumberInput,
  Card,
  ActionCard,
  CheckboxCard,
  SelectableCard,
  StatCard,
  Select,
  Label,
  PillLabel,
  Badge,
  Tag,
  Indicator,
  Loader,
  Spinner,
  /* Plugin-facing name kept for compatibility; now backed by the shared
     skeleton vocabulary (lines/class props are compatible). */
  SkeletonText as Skeleton,
  ProgressRing,
  InlineLoadingOverlay,
  EmptyState,
  AlertBanner,
  ProgressBar,
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

// These names are part of the shipped plugin host contract. Keep the adapter
// here so renderer code uses only the canonical Button API.
const pluginButton = (buttonType?: ButtonType): Component<Omit<ButtonProps, 'buttonType'>> => (props) =>
  createComponent(Button, buttonType ? mergeProps(props, { buttonType }) : props);
const Btn = pluginButton();
const PillBtn = pluginButton('pill');
const IconBtn = pluginButton('icon');
const NavBtn = pluginButton('nav');
const TabBtn = pluginButton('tab');

export type {
  ButtonProps,
  ButtonType,
  ButtonVariant,
  ButtonSize,
  ModalProps,
  ConfirmDialogProps,
  ConfirmVariant,
  ConfirmOptions,
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
  ColorInputProps,
  FormFieldProps,
  RangeInputProps,
  RangeNumberInputProps,
  CardProps,
  ActionCardProps,
  CheckboxCardProps,
  SelectableCardProps,
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
  ColorInput: typeof ColorInput;
  FormField: typeof FormField;
  RangeInput: typeof RangeInput;
  RangeNumberInput: typeof RangeNumberInput;
  Card: typeof Card;
  ActionCard: typeof ActionCard;
  CheckboxCard: typeof CheckboxCard;
  SelectableCard: typeof SelectableCard;
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
  ColorInput,
  FormField,
  RangeInput,
  RangeNumberInput,
  Card,
  ActionCard,
  CheckboxCard,
  SelectableCard,
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
