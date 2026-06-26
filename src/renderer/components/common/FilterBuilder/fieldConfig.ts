import type { ComparisonOp, FieldResolver, FilterToken, OperandToken } from './filterExpr';
import { uniqueId } from './filterExpr';

export interface FieldConfig<R> {
  field: string;
  label: string;
  allowedOps: ComparisonOp[];
  values: { value: string; label: string }[];
  resolver: FieldResolver<R>;
}

export interface OperandSpec {
  field: string;
  op: ComparisonOp;
  value: string;
  label: string;
}

export interface OperatorSpec {
  kind: 'operator';
  op: 'AND' | 'OR';
  label: string;
}

export interface NotSpec {
  kind: 'not';
  label: string;
}

export interface ParenSpec {
  kind: 'paren';
  dir: 'open' | 'close';
  label: string;
}

export type PaletteItem = OperandSpec | OperatorSpec | NotSpec | ParenSpec;

export function makeOperandToken(spec: OperandSpec): OperandToken {
  return {
    instanceId: uniqueId(),
    kind: 'operand',
    field: spec.field,
    op: spec.op,
    value: spec.value,
  };
}

export function makeToken(spec: PaletteItem): FilterToken {
  if ('kind' in spec && spec.kind === 'operator') {
    return { instanceId: uniqueId(), kind: 'operator', op: spec.op };
  }

  if ('kind' in spec && spec.kind === 'not') {
    return { instanceId: uniqueId(), kind: 'not' };
  }

  if ('kind' in spec && spec.kind === 'paren') {
    return { instanceId: uniqueId(), kind: 'paren', dir: spec.dir };
  }

  return makeOperandToken(spec);
}
