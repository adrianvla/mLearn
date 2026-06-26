// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { FieldConfig, PaletteItem } from './fieldConfig';
import type { FilterToken, ValidationResult } from './filterExpr';

const translations: Record<string, string> = {
  'mlearn.FilterBuilder.Palette': 'Palette',
  'mlearn.FilterBuilder.FilterBox': 'Filter box',
  'mlearn.FilterBuilder.FilterBoxEmpty': 'Drop filters here',
  'mlearn.FilterBuilder.Op.And': 'AND',
  'mlearn.FilterBuilder.Op.Or': 'OR',
  'mlearn.FilterBuilder.Op.Not': 'NOT',
  'mlearn.FilterBuilder.Paren.Open': '(',
  'mlearn.FilterBuilder.Paren.Close': ')',
  'mlearn.FilterBuilder.MoveUp': 'Move up',
  'mlearn.FilterBuilder.MoveDown': 'Move down',
  'mlearn.FilterBuilder.Remove': 'Remove',
  'mlearn.FilterBuilder.TokenAdded': 'Token added',
  'mlearn.FilterBuilder.TokenMoved': 'Token moved',
  'mlearn.FilterBuilder.TokenRemoved': 'Token removed',
  'mlearn.FilterBuilder.Error.ExpectedOperand': 'Expected operand',
  'mlearn.FilterBuilder.Error.ExpectedOperator': 'Expected operator',
  'mlearn.FilterBuilder.Error.UnbalancedParens': 'Unbalanced parentheses',
  'mlearn.FilterBuilder.Error.EmptySubexpression': 'Empty subexpression',
  'mlearn.FilterBuilder.Error.TrailingOperator': 'Trailing operator',
};

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

describe('FilterBuilder', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it('renders grouped palette pills', async () => {
    const { FilterBuilder } = await import('./FilterBuilder');

    dispose = render(() => (
      <FilterBuilder
        fields={fields}
        paletteItems={paletteItems}
        tokens={[]}
        onChange={vi.fn()}
      />
    ), container);

    expect(container.querySelector('.filter-builder-palette')).not.toBeNull();
    expect(container.textContent).toContain('Status');
    expect(container.textContent).toContain('Level');
    expect(container.textContent).toContain('Unknown');
    expect(container.textContent).toContain('Beginner');
    expect(container.textContent).toContain('AND');
  });

  it('renders the empty filter box placeholder', async () => {
    const { FilterBuilder } = await import('./FilterBuilder');

    dispose = render(() => (
      <FilterBuilder
        fields={fields}
        paletteItems={paletteItems}
        tokens={[]}
        onChange={vi.fn()}
      />
    ), container);

    const filterBox = container.querySelector('.filter-builder-filterbox');
    expect(filterBox?.classList.contains('empty')).toBe(true);
    expect(filterBox?.textContent).toContain('Drop filters here');
  });

  it('renders tokens in order', async () => {
    const { FilterBuilder } = await import('./FilterBuilder');

    dispose = render(() => (
      <FilterBuilder
        fields={fields}
        paletteItems={paletteItems}
        tokens={orderedTokens}
        onChange={vi.fn()}
      />
    ), container);

    const tokenLabels = Array.from(container.querySelectorAll('.filter-builder-token-label'))
      .map((element) => element.textContent);
    expect(tokenLabels).toEqual(['Unknown', 'AND', 'Beginner']);
  });

  it('clicking a palette pill appends a new token', async () => {
    const { FilterBuilder } = await import('./FilterBuilder');
    const onChange = vi.fn();

    dispose = render(() => (
      <FilterBuilder
        fields={fields}
        paletteItems={paletteItems}
        tokens={[unknownToken]}
        onChange={onChange}
      />
    ), container);

    clickElement('[aria-label="Beginner"]');

    expect(onChange).toHaveBeenCalledTimes(1);
    const nextTokens = onChange.mock.calls[0]?.[0] as FilterToken[] | undefined;
    expect(nextTokens).toHaveLength(2);
    expect(nextTokens?.[0]).toBe(unknownToken);
    expect(nextTokens?.[1]?.kind).toBe('operand');
    expect(nextTokens?.[1]?.instanceId).not.toBe(levelToken.instanceId);
  });

  it('removes a token', async () => {
    const { FilterBuilder } = await import('./FilterBuilder');
    const onChange = vi.fn();

    dispose = render(() => (
      <FilterBuilder
        fields={fields}
        paletteItems={paletteItems}
        tokens={[unknownToken, levelToken]}
        onChange={onChange}
      />
    ), container);

    clickElement('[aria-label="Remove"]');

    expect(onChange).toHaveBeenCalledWith([levelToken]);
  });

  it('moves a token up', async () => {
    const { FilterBuilder } = await import('./FilterBuilder');
    const onChange = vi.fn();

    dispose = render(() => (
      <FilterBuilder
        fields={fields}
        paletteItems={paletteItems}
        tokens={[unknownToken, levelToken]}
        onChange={onChange}
      />
    ), container);

    clickElement('[aria-label="Move up"]:not(:disabled)');

    expect(onChange).toHaveBeenCalledWith([levelToken, unknownToken]);
  });

  it('moves a token down', async () => {
    const { FilterBuilder } = await import('./FilterBuilder');
    const onChange = vi.fn();

    dispose = render(() => (
      <FilterBuilder
        fields={fields}
        paletteItems={paletteItems}
        tokens={[unknownToken, levelToken]}
        onChange={onChange}
      />
    ), container);

    clickElement('[aria-label="Move down"]:not(:disabled)');

    expect(onChange).toHaveBeenCalledWith([levelToken, unknownToken]);
  });

  it('renders the first validation error', async () => {
    const { FilterBuilder } = await import('./FilterBuilder');
    const evaluation: ValidationResult = {
      ok: false,
      errors: [{ index: 0, message: 'expected_operand' }],
    };

    dispose = render(() => (
      <FilterBuilder
        fields={fields}
        paletteItems={paletteItems}
        tokens={[andToken]}
        onChange={vi.fn()}
        evaluation={evaluation}
      />
    ), container);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.classList.contains('filter-builder-error')).toBe(true);
    expect(alert?.textContent).toContain('Expected operand');
  });

  it('does not render an error when evaluation is valid', async () => {
    const { FilterBuilder } = await import('./FilterBuilder');

    dispose = render(() => (
      <FilterBuilder
        fields={fields}
        paletteItems={paletteItems}
        tokens={[unknownToken]}
        onChange={vi.fn()}
        evaluation={{ ok: true }}
      />
    ), container);

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  function clickElement(selector: string): void {
    const element = container.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Expected clickable element for selector: ${selector}`);
    }
    element.click();
  }
});

const fields: FieldConfig<unknown>[] = [
  {
    field: 'status',
    label: 'Status',
    allowedOps: ['eq'],
    values: [
      { value: 'unknown', label: 'Unknown' },
      { value: 'known', label: 'Known' },
    ],
    resolver: {
      read: () => 'unknown',
      valueLabel: (value) => value,
    },
  },
  {
    field: 'level',
    label: 'Level',
    allowedOps: ['eq'],
    values: [{ value: '1', label: 'Beginner' }],
    resolver: {
      read: () => '1',
      valueLabel: (value) => value,
    },
  },
];

const paletteItems: PaletteItem[] = [
  { field: 'status', op: 'eq', value: 'unknown', label: 'Unknown' },
  { field: 'level', op: 'eq', value: '1', label: 'Beginner' },
  { kind: 'operator', op: 'AND', label: 'AND' },
  { kind: 'operator', op: 'OR', label: 'OR' },
  { kind: 'not', label: 'NOT' },
  { kind: 'paren', dir: 'open', label: '(' },
  { kind: 'paren', dir: 'close', label: ')' },
];

const unknownToken: FilterToken = {
  instanceId: 'status-unknown',
  kind: 'operand',
  field: 'status',
  op: 'eq',
  value: 'unknown',
};

const andToken: FilterToken = {
  instanceId: 'and',
  kind: 'operator',
  op: 'AND',
};

const levelToken: FilterToken = {
  instanceId: 'level-one',
  kind: 'operand',
  field: 'level',
  op: 'eq',
  value: '1',
};

const orderedTokens: FilterToken[] = [unknownToken, andToken, levelToken];
