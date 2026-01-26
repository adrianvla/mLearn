/**
 * Sortable Column Header Component
 * Clickable table header with sort direction indicator
 * Used in data tables for sorting functionality
 */

import { Component, JSX } from 'solid-js';
import './SortableColumnHeader.css';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortableColumnHeaderProps {
  /** Column header text */
  label: string;
  /** Column key for identifying which column is sorted */
  column: string;
  /** Current sort direction (null = not sorted) */
  sortDirection: SortDirection;
  /** Callback when header is clicked */
  onSort: (column: string) => void;
  /** Text alignment */
  align?: 'left' | 'center' | 'right';
  /** Width of the column */
  width?: string;
  /** Additional CSS class */
  class?: string;
  /** Custom style */
  style?: JSX.CSSProperties;
}

export const SortableColumnHeader: Component<SortableColumnHeaderProps> = (props) => {
  const handleClick = () => {
    props.onSort(props.column);
  };

  const getSortIndicator = () => {
    if (props.sortDirection === 'asc') return '▲';
    if (props.sortDirection === 'desc') return '▼';
    return '';
  };

  return (
    <th 
      class={`sortable-column-header align-${props.align || 'left'} ${props.sortDirection ? 'sorted' : ''} ${props.class || ''}`}
      style={{ width: props.width, ...props.style }}
      onClick={handleClick}
    >
      <span class="column-content">
        <span class="column-label">{props.label}</span>
        <span class="sort-indicator">{getSortIndicator()}</span>
      </span>
    </th>
  );
};

export default SortableColumnHeader;
