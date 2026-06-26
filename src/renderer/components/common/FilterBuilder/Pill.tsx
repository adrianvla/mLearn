/**
 * Pill — Palette source pill for the FilterBuilder.
 * Draggable source token; parent (FilterBuilder) owns all DnD logic and state.
 */

import { Component, createSignal } from 'solid-js';

export interface PillProps {
  label: string;
  onDragStart: (e: DragEvent) => void;
  onClick?: () => void;
  class?: string;
}

export const Pill: Component<PillProps> = (props) => {
  const [isDragging, setDragging] = createSignal(false);

  const handleDragStart = (e: DragEvent) => {
    setDragging(true);
    props.onDragStart(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onClick?.();
    }
  };

  const classes = () => {
    const parts = ['filter-builder-palette-pill'];
    if (isDragging()) parts.push('dragging');
    if (props.class) parts.push(props.class);
    return parts.join(' ');
  };

  return (
    <div
      class={classes()}
      draggable={true}
      role="button"
      tabIndex={0}
      aria-label={props.label}
      onDragStart={handleDragStart}
      onDragEnd={() => setDragging(false)}
      onClick={() => props.onClick?.()}
      onKeyDown={handleKeyDown}
    >
      {props.label}
    </div>
  );
};

export default Pill;
