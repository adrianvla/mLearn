/**
 * WordStatusPill Component
 * Displays and controls word learning status (Unknown/Learning/Known)
 * Standardizes the status pill pattern across the app
 */

import { Component, createMemo } from 'solid-js';
import { PillBtn } from './Button';

export type WordStatusType = 'unknown' | 'learning' | 'known';

// Icon paths
const ICON_CROSS = 'assets/icons/cross2.svg';
const ICON_CHECK = 'assets/icons/check.svg';

export interface WordStatusPillProps {
  /** Current status */
  status: WordStatusType;
  /** Click handler - typically cycles through status */
  onClick?: (e: MouseEvent) => void;
  /** Whether the pill is clickable */
  interactive?: boolean;
  /** Show only icon without label */
  iconOnly?: boolean;
  /** Additional class */
  class?: string;
}

/**
 * WordStatusPill - Clickable pill showing word learning status
 * 
 * Status variants:
 * - unknown (red): Word not yet learned
 * - learning (orange): Word being studied
 * - known (green): Word mastered
 */
export const WordStatusPill: Component<WordStatusPillProps> = (props) => {
  const variant = createMemo(() => {
    switch (props.status) {
      case 'unknown': return 'red' as const;
      case 'learning': return 'orange' as const;
      case 'known': return 'green' as const;
      default: return 'gray' as const;
    }
  });

  const icon = createMemo(() => {
    return props.status === 'unknown' ? ICON_CROSS : ICON_CHECK;
  });

  const label = createMemo(() => {
    if (props.iconOnly) return '';
    switch (props.status) {
      case 'unknown': return 'Unknown';
      case 'learning': return 'Learning';
      case 'known': return 'Known';
      default: return '';
    }
  });

  return (
    <PillBtn
      variant={variant()}
      icon={icon()}
      label={label()}
      onClick={props.onClick}
      class={`word-status-pill ${props.class || ''}`}
    />
  );
};

// Helper to convert numeric status to type
export function numericToWordStatus(num: number): WordStatusType {
  switch (num) {
    case 1: return 'learning';
    case 2: return 'known';
    default: return 'unknown';
  }
}

// Helper to convert type to numeric status
export function wordStatusToNumeric(status: WordStatusType): number {
  switch (status) {
    case 'learning': return 1;
    case 'known': return 2;
    default: return 0;
  }
}

// Helper to get next status in cycle
export function getNextStatus(current: WordStatusType): WordStatusType {
  const cycle: WordStatusType[] = ['unknown', 'learning', 'known'];
  const idx = cycle.indexOf(current);
  return cycle[(idx + 1) % cycle.length];
}

export default WordStatusPill;
