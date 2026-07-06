/**
 * FilterBuilder — Drag-and-drop boolean expression builder.
 */
export { FilterBuilder, type FilterBuilderProps } from './FilterBuilder';
export { Pill, type PillProps } from './Pill';
export { FilterTokenView, type FilterTokenProps } from './FilterToken';

// Core logic
export {
  validateTokens,
  evaluateFilter,
  evaluateAst,
  parseTokens,
  uniqueId,
  tokensToDebugString,
  type FilterToken,
  type OperandToken,
  type OperatorToken,
  type NotToken,
  type ParenToken,
  type ExprNode,
  type ComparisonOp,
  type ValidationError,
  type ValidationResult,
  type EvalResult,
  type FieldResolver,
} from './filterExpr';

// Field config + presets
export {
  makeToken,
  makeOperandToken,
  type FieldConfig,
  type OperandSpec,
  type OperatorSpec,
  type NotSpec,
  type ParenSpec,
  type PaletteItem,
} from './fieldConfig';
export {
  buildWordSyncPreset,
  WORD_SYNC_STATUS_UNTRACKED,
  buildEmptyPreset,
  buildWordSyncFields,
  buildWordDbEditorFields,
  statusResolver,
  levelResolver,
  sourceResolver,
  recencyResolver,
} from './presets';

import './FilterBuilder.css';
