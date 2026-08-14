/**
 * FilterTokenView — A committed token rendered in the FilterBuilder filter box.
 * Presentational only; parent owns the token array, DnD reordering, and label resolution.
 * Named FilterTokenView to avoid collision with the FilterToken type from filterExpr.ts.
 */

import { Component, Show, createMemo, createSignal } from 'solid-js';
import { useLocalization } from '../../../context';
import type { FilterToken } from './filterExpr';
import { Select } from '../Select/Select';

export interface FilterTokenProps {
  token: FilterToken;
  label: string;
  index: number;
  total: number;
  onRemove: (instanceId: string) => void;
  onDragStart: (e: DragEvent, instanceId: string) => void;
  onMoveUp: (instanceId: string) => void;
  onMoveDown: (instanceId: string) => void;
  /** When set (valueSelect fields), renders a Select inside the token instead of a static label. */
  valueOptions?: { value: string; label: string }[];
  /** Called with the selected value when the in-token Select changes. */
  onValueChange?: (instanceId: string, value: string) => void;
  class?: string;
}

export const FilterTokenView: Component<FilterTokenProps> = (props) => {
  const { t } = useLocalization();
  const [removeHover, setRemoveHover] = createSignal(false);

  const current = createMemo(() => props.token);
  const isParen = () => current().kind === 'paren';
  const atFirst = () => props.index === 0;
  const atLast = () => props.index === props.total - 1;
  const hasValueSelect = () => current().kind === 'operand' && !!props.valueOptions && props.valueOptions.length > 0;
  const selectedValue = () => {
    const value = current();
    return value.kind === 'operand' ? value.value : '';
  };

  const classes = () => {
    const parts = ['filter-builder-token', current().kind];
    if (removeHover()) parts.push('remove-hover');
    if (props.class) parts.push(props.class);
    return parts.join(' ');
  };

  const handleDragStart = (e: DragEvent) => {
    props.onDragStart(e, current().instanceId);
  };

  return (
    <div class={classes()} draggable={true} onDragStart={handleDragStart}>
      <Show
        when={hasValueSelect()}
        fallback={<span class="filter-builder-token-label">{props.label}</span>}
      >
        <Select
          class="filter-builder-token-select"
          options={props.valueOptions}
          value={selectedValue()}
          onChange={(e) => props.onValueChange?.(current().instanceId, e.currentTarget.value)}
          aria-label={props.label}
        />
      </Show>
      <Show when={!isParen()}>
        <button
          type="button"
          class="filter-builder-token-move"
          aria-label={t('mlearn.FilterBuilder.MoveUp')}
          disabled={atFirst()}
          onClick={() => props.onMoveUp(current().instanceId)}
        >
          ▲
        </button>
        <button
          type="button"
          class="filter-builder-token-move"
          aria-label={t('mlearn.FilterBuilder.MoveDown')}
          disabled={atLast()}
          onClick={() => props.onMoveDown(current().instanceId)}
        >
          ▼
        </button>
        <button
          type="button"
          class="filter-builder-token-remove"
          aria-label={t('mlearn.FilterBuilder.Remove')}
          onClick={() => props.onRemove(current().instanceId)}
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
