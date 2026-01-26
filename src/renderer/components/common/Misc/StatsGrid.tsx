/**
 * Stats Grid Component
 * A responsive grid layout for displaying StatCard components
 * Automatically adjusts columns based on container width
 */

import { ParentComponent, JSX } from 'solid-js';
import './StatsGrid.css';

export interface StatsGridProps {
  /** Number of columns (2, 3, or 4) */
  columns?: 2 | 3 | 4;
  /** Gap between grid items */
  gap?: 'sm' | 'md' | 'lg';
  /** Additional CSS class */
  class?: string;
  /** Custom style */
  style?: JSX.CSSProperties;
}

export const StatsGrid: ParentComponent<StatsGridProps> = (props) => {
  const gapClass = () => {
    switch (props.gap) {
      case 'sm': return 'gap-sm';
      case 'lg': return 'gap-lg';
      default: return 'gap-md';
    }
  };

  return (
    <div 
      class={`stats-grid cols-${props.columns || 3} ${gapClass()} ${props.class || ''}`}
      style={props.style}
    >
      {props.children}
    </div>
  );
};

export default StatsGrid;
