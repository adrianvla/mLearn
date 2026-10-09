import type { LanguageData } from './types';
import type { LearningGoal } from './learningGoals';
import { resolveLearningOutcome } from './learningOutcomes';
import { canonicalizePolicyJson } from './policyCanonicalization';
import { hashWordSync } from './utils/wordHash';

export interface LearningGoalSemanticBasis {
  protocol: 'learning-goal-semantics@1';
  fingerprint: string;
  declarationHash: string;
  membershipHash: string;
  contentHash: string;
  packageVersion?: string;
}
export interface LearningGoalCompatibility {
  supported: boolean;
  status: 'current' | 'compatible-rebind' | 'unbound' | 'unverified-version' | 'changed' | 'unavailable';
  requestedVersion?: string;
  installedVersion?: string;
  basis?: LearningGoalSemanticBasis;
}
const digest = (value: unknown) => hashWordSync(canonicalizePolicyJson(value));

/** Bound semantics exclude transport generation, dictionaries and localized labels. */
export function learningGoalSemanticBasis(data: LanguageData | null | undefined, ref: NonNullable<LearningGoal['outcomeRef']>): LearningGoalSemanticBasis | undefined {
  const resolved = resolveLearningOutcome(data, ref.id, ref.groupIds);
  const whole = resolveLearningOutcome(data, ref.id);
  if (!resolved?.complete || !whole?.complete) return undefined;
  const { label: _label, reference: _reference, provenance: _provenance, groups, ...semantics } = whole.declaration;
  const declarationHash = digest({ id: ref.id, ...semantics, groups: groups.map(({ label: _groupLabel, ...group }) => group).sort((a, b) => a.id.localeCompare(b.id)) });
  const membershipHash = digest({ selectedGroups: ref.groupIds ? [...ref.groupIds].sort() : null,
    groups: whole.groups.map(group => ({ id: group.id, words: [...group.words].sort(), patterns: [...group.patterns].sort() })).sort((a, b) => a.id.localeCompare(b.id)) });
  const contentHash = digest({ capabilities: data?.learning?.capabilities ?? {}, grammar: (data?.grammar ?? [])
    .filter(point => whole.patterns.includes(point.pattern)).map(({ meanings: _meanings, items, ...point }) => ({ ...point,
      items: items?.map(({ validation: _validation, ...item }) => item) ?? [] })).sort((a, b) => a.pattern.localeCompare(b.pattern)) });
  return { protocol: 'learning-goal-semantics@1', fingerprint: digest({ declarationHash, membershipHash, contentHash }),
    declarationHash, membershipHash, contentHash, ...(data?.languageData?.version ? { packageVersion: data.languageData.version } : {}) };
}

export function learningGoalCompatibility(goal: LearningGoal, data: LanguageData | null | undefined): LearningGoalCompatibility {
  const requestedVersion = goal.outcomeRef?.packageVersion; const installedVersion = data?.languageData?.version;
  const basis = goal.outcomeRef && learningGoalSemanticBasis(data, goal.outcomeRef);
  const common = { requestedVersion, installedVersion, ...(basis ? { basis } : {}) };
  if (!basis) return { ...common, supported: false, status: 'unavailable' };
  const previous = goal.outcomeRef?.semanticBasis;
  if (previous) {
    if (previous.protocol !== basis.protocol || previous.fingerprint !== basis.fingerprint) return { ...common, supported: false, status: 'changed' };
    return { ...common, supported: true, status: requestedVersion !== installedVersion ? 'compatible-rebind' : 'current' };
  }
  if (requestedVersion && requestedVersion !== installedVersion) return { ...common, supported: false, status: 'unverified-version' };
  return { ...common, supported: false, status: 'unbound' };
}

/** Explicit revalidation preserves identity, deadlines, opaque intent and prior bindings. */
export function revalidateLearningGoal(goal: LearningGoal, data: LanguageData | null | undefined, at = Date.now()): LearningGoal | undefined {
  if (!goal.outcomeRef) return undefined;
  const basis = learningGoalSemanticBasis(data, goal.outcomeRef); if (!basis) return undefined;
  // Settings reconciles reactive objects before serializing them. A retained
  // store reference would rewrite the historical basis as the new one lands.
  // Intent is JSON-persisted; snapshot it before constructing the new binding.
  const snapshot = JSON.parse(JSON.stringify(goal)) as LearningGoal;
  const previousRef = snapshot.outcomeRef!;
  return { ...snapshot, outcomeRef: { ...previousRef, packageVersion: data?.languageData?.version, semanticBasis: basis,
    bindingHistory: [...(previousRef.bindingHistory ?? []), { at, previous: previousRef.semanticBasis ?? null, requestedVersion: previousRef.packageVersion, basis }] } };
}
