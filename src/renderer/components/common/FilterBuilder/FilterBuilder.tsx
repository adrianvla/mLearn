import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useLocalization } from '../../../context';
import { TrashIcon } from '../Misc/Icons';
import { FilterTokenView } from './FilterToken';
import { Pill } from './Pill';
import { makeToken, type FieldConfig, type PaletteItem } from './fieldConfig';
import type { FilterToken, ValidationError, ValidationResult } from './filterExpr';

export interface FilterBuilderProps {
  /** Available fields for the current context (drives palette grouping + value labels). */
  fields: FieldConfig<unknown>[];
  /** All palette items (operands + operators + NOT + parens) to render as draggable pills. */
  paletteItems: PaletteItem[];
  /** Controlled token array — parent owns this. */
  tokens: FilterToken[];
  /** Called when tokens change (drop, remove, reorder, move). */
  onChange: (tokens: FilterToken[]) => void;
  /** Validation result from parent (parent memoizes validateTokens). If invalid, shows first error. */
  evaluation?: ValidationResult;
  /** Optional extra CSS class on the root container. */
  class?: string;
}

interface PaletteGroup {
  key: string;
  label: string;
  items: PaletteItem[];
}

let _draggedPaletteItem: PaletteItem | null = null;
let _draggedInstanceId: string | null = null;

export const FilterBuilder: Component<FilterBuilderProps> = (props) => {
  const { t } = useLocalization();
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);
  const [liveMessage, setLiveMessage] = createSignal('');
  let filterBoxRef: HTMLDivElement | undefined;

  const paletteGroups = createMemo<PaletteGroup[]>(() => {
    const groups: PaletteGroup[] = [];
    const groupMap = new Map<string, PaletteItem[]>();

    for (const item of props.paletteItems) {
      const groupKey = 'field' in item ? item.field : '__operators__';
      const existingItems = groupMap.get(groupKey);

      if (existingItems) {
        existingItems.push(item);
      } else {
        groupMap.set(groupKey, [item]);
      }
    }

    for (const [key, items] of groupMap) {
      const label = key === '__operators__'
        ? t('mlearn.FilterBuilder.Palette')
        : props.fields.find((field) => field.field === key)?.label ?? key;
      groups.push({ key, label, items });
    }

    return groups;
  });

  const rootClass = createMemo(() => {
    const classes = ['filter-builder'];
    if (props.class) classes.push(props.class);
    return classes.join(' ');
  });

  const filterBoxClass = createMemo(() => {
    const classes = ['filter-builder-filterbox'];
    if (isDragOver()) classes.push('dragging');
    if (props.tokens.length === 0) classes.push('empty');
    return classes.join(' ');
  });

  const showError = createMemo(() => props.evaluation !== undefined && !props.evaluation.ok);

  const errorText = createMemo(() => {
    if (!props.evaluation || props.evaluation.ok) return '';
    const firstError: ValidationError | undefined = props.evaluation.errors[0];
    if (!firstError) return '';
    return t(`mlearn.FilterBuilder.Error.${errorToKey(firstError.message)}`);
  });

  const appendToken = (item: PaletteItem) => {
    const newToken = makeToken(item);
    props.onChange([...props.tokens, newToken]);
    setLiveMessage(t('mlearn.FilterBuilder.TokenAdded'));
  };

  const handlePillDragStart = (item: PaletteItem) => (e: DragEvent) => {
    _draggedPaletteItem = item;
    _draggedInstanceId = null;
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-filter-palette-item', JSON.stringify(item));
  };

  const handleTokenDragStart = (e: DragEvent, instanceId: string) => {
    _draggedPaletteItem = null;
    _draggedInstanceId = instanceId;
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-filter-token-id', instanceId);
  };

  const computeDropIndex = (e: DragEvent): number => {
    if (!filterBoxRef) return props.tokens.length;

    const tokenElements = filterBoxRef.querySelectorAll('[data-token-index]');
    if (tokenElements.length === 0) return 0;

    for (let index = 0; index < tokenElements.length; index += 1) {
      const element = tokenElements[index];
      if (!(element instanceof HTMLElement)) continue;

      const rect = element.getBoundingClientRect();

      const isAboveRow = e.clientY < rect.top;
      const isSameRow = e.clientY >= rect.top && e.clientY <= rect.bottom;
      const isLeftHalf = isSameRow && e.clientX < rect.left + rect.width / 2;

      if (isAboveRow || isLeftHalf) {
        return index;
      }
    }

    return props.tokens.length;
  };

  const handleDragOver = (e: DragEvent) => {
    if (!_draggedPaletteItem && !_draggedInstanceId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = _draggedPaletteItem ? 'copy' : 'move';
    }
    setDropIndex(computeDropIndex(e));
  };

  const handleDragEnter = (e: DragEvent) => {
    if (!_draggedPaletteItem && !_draggedInstanceId) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    if (!_draggedPaletteItem && !_draggedInstanceId) return;
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget;
    if (!filterBoxRef || !(relatedTarget instanceof Node) || !filterBoxRef.contains(relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const clearDragState = () => {
    _draggedPaletteItem = null;
    _draggedInstanceId = null;
    setDropIndex(null);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const targetIndex = dropIndex() ?? computeDropIndex(e);

    if (_draggedPaletteItem) {
      const newToken = makeToken(_draggedPaletteItem);
      const next = [...props.tokens];
      next.splice(targetIndex, 0, newToken);
      props.onChange(next);
      setLiveMessage(t('mlearn.FilterBuilder.TokenAdded'));
      clearDragState();
      return;
    }

    if (_draggedInstanceId) {
      const fromIndex = props.tokens.findIndex((token) => token.instanceId === _draggedInstanceId);
      if (fromIndex === -1) {
        clearDragState();
        return;
      }

      const next = [...props.tokens];
      const movedTokens = next.splice(fromIndex, 1);
      const movedToken = movedTokens[0];
      if (!movedToken) {
        clearDragState();
        return;
      }

      const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
      next.splice(adjustedIndex, 0, movedToken);
      props.onChange(next);
      setLiveMessage(t('mlearn.FilterBuilder.TokenMoved'));
    }

    clearDragState();
  };

  const handleRemove = (instanceId: string) => {
    props.onChange(props.tokens.filter((token) => token.instanceId !== instanceId));
    setLiveMessage(t('mlearn.FilterBuilder.TokenRemoved'));
  };

  const handleClear = () => {
    if (props.tokens.length === 0) return;
    props.onChange([]);
    setLiveMessage(t('mlearn.FilterBuilder.TokensCleared'));
  };

  const handleMoveUp = (instanceId: string) => {
    const index = props.tokens.findIndex((token) => token.instanceId === instanceId);
    if (index <= 0) return;

    const next = [...props.tokens];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    props.onChange(next);
    setLiveMessage(t('mlearn.FilterBuilder.TokenMoved'));
  };

  const handleMoveDown = (instanceId: string) => {
    const index = props.tokens.findIndex((token) => token.instanceId === instanceId);
    if (index === -1 || index >= props.tokens.length - 1) return;

    const next = [...props.tokens];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    props.onChange(next);
    setLiveMessage(t('mlearn.FilterBuilder.TokenMoved'));
  };

  const resolveTokenLabel = (token: FilterToken): string => {
    if (token.kind === 'operator') {
      return token.op === 'AND' ? t('mlearn.FilterBuilder.Op.And') : t('mlearn.FilterBuilder.Op.Or');
    }

    if (token.kind === 'not') {
      return t('mlearn.FilterBuilder.Op.Not');
    }

    if (token.kind === 'paren') {
      return token.dir === 'open'
        ? t('mlearn.FilterBuilder.Paren.Open')
        : t('mlearn.FilterBuilder.Paren.Close');
    }

    const fieldConfig = props.fields.find((field) => field.field === token.field);
    const valueEntry = fieldConfig?.values.find((value) => value.value === token.value);
    return valueEntry?.label ?? `${token.field}=${token.value}`;
  };

  return (
    <div class={rootClass()}>
      <div class="filter-builder-palette" role="group" aria-label={t('mlearn.FilterBuilder.Palette')}>
        <For each={paletteGroups()}>
          {(group) => (
            <div class="filter-builder-palette-group">
              <span class="filter-builder-palette-label">{group.label}</span>
              <For each={group.items}>
                {(item) => (
                  <Pill
                    label={item.label}
                    onDragStart={handlePillDragStart(item)}
                    onClick={() => appendToken(item)}
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </div>

      <div class="filter-builder-expression-row">
        <div
          class={filterBoxClass()}
          role="list"
          aria-label={t('mlearn.FilterBuilder.FilterBox')}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          ref={filterBoxRef}
        >
          <Show when={props.tokens.length > 0} fallback={<span>{t('mlearn.FilterBuilder.FilterBoxEmpty')}</span>}>
            <For each={props.tokens}>
              {(token, index) => (
                <span class="filter-builder-token-wrapper" data-token-index={index()}>
                  <FilterTokenView
                    token={token}
                    label={resolveTokenLabel(token)}
                    index={index()}
                    total={props.tokens.length}
                    onRemove={handleRemove}
                    onDragStart={handleTokenDragStart}
                    onMoveUp={handleMoveUp}
                    onMoveDown={handleMoveDown}
                  />
                </span>
              )}
            </For>
          </Show>
        </div>
        <button
          type="button"
          class="filter-builder-clear"
          onClick={handleClear}
          disabled={props.tokens.length === 0}
          aria-label={t('mlearn.FilterBuilder.Clear')}
          title={t('mlearn.FilterBuilder.Clear')}
        >
          <TrashIcon size={16} />
        </button>
      </div>

      <Show when={showError()}>
        <div class="filter-builder-error" role="alert">
          {errorText()}
        </div>
      </Show>

      <div class="sr-only" aria-live="polite">{liveMessage()}</div>
    </div>
  );
};

function errorToKey(message: string): string {
  const map: Record<string, string> = {
    expected_operand: 'ExpectedOperand',
    expected_operator: 'ExpectedOperator',
    unbalanced_parens: 'UnbalancedParens',
    empty_subexpression: 'EmptySubexpression',
    trailing_operator: 'TrailingOperator',
  };

  return map[message] ?? 'ExpectedOperand';
}

export default FilterBuilder;
