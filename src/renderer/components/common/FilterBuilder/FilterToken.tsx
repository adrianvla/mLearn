/**
 * FilterTokenView — A committed token rendered in the FilterBuilder filter box.
 * Presentational only; parent owns the token array, DnD reordering, and label resolution.
 * Named FilterTokenView to avoid collision with the FilterToken type from filterExpr.ts.
 */

import { Component, Show, createSignal } from 'solid-js';
import { useLocalization } from '../../../context';
import type { FilterToken } from './filterExpr';

export interface FilterTokenProps {
  token: FilterToken;
  label: string;
  index: number;
  total: number;
  onRemove: (instanceId: string) => void;
  onDragStart: (e: DragEvent, instanceId: string) => void;
  onMoveUp: (instanceId: string) => void;
  onMoveDown: (instanceId: string) => void;
  class?: string;
}

export const FilterTokenView: Component<FilterTokenProps> = (props) => {
  const { t } = useLocalization();
  const [removeHover, setRemoveHover] = createSignal(false);

  const token = () => props.token;
  const isParen = () => token().kind === 'paren';
  const atFirst = () => props.index === 0;
  const atLast = () => props.index === props.total - 1;

  const classes = () => {
    const parts = ['filter-builder-token', token().kind];
    if (removeHover()) parts.push('remove-hover');
    if (props.class) parts.push(props.class);
    return parts.join(' ');
  };

  const handleDragStart = (e: DragEvent) => {
    props.onDragStart(e, token().instanceId);
  };

  return (
    <div class={classes()} draggable={true} onDragStart={handleDragStart}>
      <span class="filter-builder-token-label">{props.label}</span>
      <Show when={!isParen()}>
        <button
          type="button"
          class="filter-builder-token-move"
          aria-label={t('mlearn.FilterBuilder.MoveUp')}
          disabled={atFirst()}
          onClick={() => props.onMoveUp(token().instanceId)}
        >
          ▲
        </button>
        <button
          type="button"
          class="filter-builder-token-move"
          aria-label={t('mlearn.FilterBuilder.MoveDown')}
          disabled={atLast()}
          onClick={() => props.onMoveDown(token().instanceId)}
        >
          ▼
        </button>
        <button
          type="button"
          class="filter-builder-token-remove"
          aria-label={t('mlearn.FilterBuilder.Remove')}
          onClick={() => props.onRemove(token().instanceId)}
          onMouseEnter={() => setRemoveHover(true)}
          onMouseLeave={() => setRemoveHover(false)}
        >
          ×
        </button>
      </Show>
    </div>
  );
};

export default FilterTokenView;
