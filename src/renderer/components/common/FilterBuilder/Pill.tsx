/**
 * Pill — Palette source pill for the FilterBuilder.
 * Draggable source token; parent (FilterBuilder) owns all DnD logic and state.
 */

import { Component, createSignal } from 'solid-js';
import { Button } from '../Button/Button';

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

  const classes = () => {
    const parts = ['filter-builder-palette-pill'];
    if (isDragging()) parts.push('dragging');
    if (props.class) parts.push(props.class);
    return parts.join(' ');
  };

  return (
    <Button
      type="button"
      buttonType="default"
      variant="ghost"
      size="sm"
      class={classes()}
      draggable={true}
      aria-label={props.label}
      onDragStart={handleDragStart}
      onDragEnd={() => setDragging(false)}
      onClick={() => props.onClick?.()}
    >
      {props.label}
    </Button>
  );
};

export default Pill;
