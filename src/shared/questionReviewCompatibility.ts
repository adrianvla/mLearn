import type { GrammarItemSemanticValidation, GrammarPracticeItemSource } from './types';
import { canonicalizePolicyJson } from './policyCanonicalization';
import { hashWordSync } from './utils/wordHash';

/** Scope continuity, not a claim that the reviewer evaluated every objective field. */
export function questionObjectiveHash(point: object): string {
  const { items: _items, meanings: _localized, ...semanticScope } = point as Record<string, unknown>;
  return hashWordSync(canonicalizePolicyJson(semanticScope));
}

export function questionSourceHash(source: GrammarPracticeItemSource): string {
  const { validation: _validation, ...task } = source;
  return hashWordSync(canonicalizePolicyJson(task));
}

export function questionReviewCompatible(record: GrammarItemSemanticValidation | undefined,
  language: string, pattern: string, packageVersion: string | undefined, contentHash: string,
  objectiveHash?: string, requireOwner = false, source?: GrammarPracticeItemSource): boolean {
  if (!record || record.contentHash !== contentHash) return false;
  if (!record.scope) return !requireOwner && !record.compatibility;
  if (record.scope.language !== language || record.scope.pattern !== pattern) return false;
  if (record.compatibility) {
    return record.compatibility.protocol === 'question-review-continuity@1'
      && record.compatibility.reviewProtocol === record.protocol
      && source !== undefined && record.compatibility.taskHash === questionSourceHash(source)
      && record.compatibility.contentHash === contentHash
      && record.compatibility.objectiveHash === objectiveHash
      && /^[a-f0-9]{64}$/.test(record.compatibility.reviewPayloadHash)
      && /^[a-f0-9]{64}$/.test(record.compatibility.reviewResultHash);
  }
  return !requireOwner && record.scope.packageVersion === (packageVersion ?? '');
}
