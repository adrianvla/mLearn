export interface WordStatusChangeActionOptions {
  hasNonManualSource: boolean;
  skipStatusSourceWarning: boolean;
}

export interface WordStatusSourceLabelOptions {
  prefix: string;
  noneLabel: string;
  sourceLabels: readonly string[];
  displayedWord?: string | null;
  canonicalWord?: string | null;
}

export type WordStatusChangeAction = 'show-status-source-warning' | 'apply';

export function getWordStatusChangeAction(options: WordStatusChangeActionOptions): WordStatusChangeAction {
  if (options.hasNonManualSource && !options.skipStatusSourceWarning) {
    return 'show-status-source-warning';
  }

  return 'apply';
}

export function buildWordStatusSourceLabel(options: WordStatusSourceLabelOptions): string {
  const sourceLabel = options.sourceLabels.length > 0
    ? options.sourceLabels.join(' + ')
    : options.noneLabel;
  const baseLabel = `${options.prefix}${sourceLabel}`;

  if (!options.canonicalWord || !options.displayedWord || options.canonicalWord === options.displayedWord) {
    return baseLabel;
  }

  return `${baseLabel} (→ ${options.canonicalWord})`;
}
