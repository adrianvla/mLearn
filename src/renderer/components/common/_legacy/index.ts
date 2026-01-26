/**
 * Legacy Components Barrel Export
 * 
 * ⚠️ DEPRECATED: These components are kept for backwards compatibility.
 * Do not use in new code. Use the unified variants instead:
 * 
 * - GlassButton → Button/GlassBtn
 * - IconButton → Button/IconBtn
 * - PillButton → Button/PillBtn
 * - TabButton → Button/TabBtn
 * - Pill → Label/PillLabel
 * - StatusPill → Label/StatusLabel
 * - WordStatusPill → Label/StatusLabel
 * - SkeletonLoader → Loader/Skeleton
 * - SpinnerLoader → Loader/Spinner
 * - ProgressBar → Loader/Progress
 * - OCRProgressRing → Loader/ProgressRing
 */

export { GlassButton, IconButton, type GlassButtonProps, type IconButtonProps } from './GlassButton';
export { PillButton, type PillButtonProps, type PillVariant } from './PillButton';
export { Pill, type PillProps } from './Pill';
export { StatusPill, type StatusPillProps } from './StatusPill';
export { TabButton, type TabButtonProps } from './TabButton';
export { 
  WordStatusPill, 
  type WordStatusPillProps, 
  type WordStatusType, 
  numericToWordStatus, 
  wordStatusToNumeric, 
  getNextStatus 
} from './WordStatusPill';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { OCRProgressRing, type OCRProgressRingProps } from './OCRProgressRing';
export { SkeletonLoader, SpinnerLoader, type SkeletonLoaderProps, type SpinnerLoaderProps } from './SkeletonLoader';

// Import CSS
import './GlassButton.css';
import './Pill.css';
import './StatusPill.css';
import './TabButton.css';
import './ProgressBar.css';
import './OCRProgressRing.css';
import './SkeletonLoader.css';
