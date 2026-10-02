import type { LingualGraph } from '../graph/load';
import type { CompoundAnalysis } from '../graph/morphology/compounds';
import type { LanguageData } from '../types';
import type { LearnableTarget } from '../graph/types';
import type { ReplayProjection } from '../utils/projectionReplay';
import { boundedSupportWeight, independentSupportContributors, resolveSupportSources, type SourceKnowledge, type SupportContributor } from './supportContributors';

/** Read-only heuristic support. No prediction can write learner evidence. */
export interface PredictionInput {
  graph: LingualGraph | null;
  direct: ReplayProjection | null;
  target: LearnableTarget;
  classify(ease: number): 'known' | 'learning' | 'unknown';
  sourceKnowledge?: (target: LearnableTarget) => SourceKnowledge | 'evidence' | 'claim' | undefined;
  languageData?: LanguageData | null;
  /** Structural inspection compatibility. Decomposition alone authorizes no transfer. */
  compound?: { analysis: CompoundAnalysis; isKnownPart(lemma: string): boolean };
  /** Legacy unscoped hints remain readable but cannot authorize pedagogical support. */
  entry?: { entryId?: string; senseKnown: boolean; spokenKnown: boolean };
  characters?: { known: number; total: number };
  inferenceSuccess?: { attempts: number; successes: number };
  /** Active unassisted physical outcomes, scoped to package-declared transfer contexts. */
  transferHistory?: Readonly<Record<string, { attempts: number; successes: number }>>;
}

export interface Prediction {
  /** Heuristic support score, never a calibrated probability or measured progress. */
  supportScore: number;
  uncertainty: number;
  supportPath: Array<{ from: string; to: string; via: string }>;
  contributors: SupportContributor[];
  limits: string[];
  readonly kind: 'prediction';
}

export function predictTargetAccessibility(input: PredictionInput): Prediction {
  const { graph, direct, target } = input;
  if (!graph || !graph.nodes.has(target.entityId)) {
    return { supportScore: 0, uncertainty: 1, supportPath: [], contributors: [], limits: [], kind: 'prediction' };
  }
  if (direct && input.classify(direct.ease) === 'known') {
    return { supportScore: 1, uncertainty: 0.05, supportPath: [], contributors: [], limits: [], kind: 'prediction' };
  }
  const possible: SupportContributor[] = [];
  const limits: string[] = [];
  for (const source of resolveSupportSources(graph, target, input.languageData, reason => limits.push(reason))) {
    const known = input.sourceKnowledge?.(source.target);
    if (!known) continue;
    const state = typeof known === 'string' ? { basis: known } : known;
    if (state.basis !== 'evidence' && state.basis !== 'claim') continue;
    const context = source.rule.transferContext;
    const history = context ? input.transferHistory?.[context] : undefined;
    let calibration = 1;
    if (history && Number.isInteger(history.attempts) && history.attempts >= 2
      && Number.isInteger(history.successes) && history.successes >= 0 && history.successes <= history.attempts) {
      calibration = Math.min(2, Math.max(0.25, 2 * (history.successes + 1) / (history.attempts + 2)));
    }
    const credit = boundedSupportWeight(source.rule.weight) * source.confidence * (state.basis === 'claim' ? 0.5 : 1) * calibration;
    if (credit <= 0) continue;
    possible.push({ source: source.target, target: { ...target }, basis: state.basis,
      ...(graph.nodes.get(source.target.entityId)?.label ? { sourceLabel: graph.nodes.get(source.target.entityId)!.label } : {}),
      observationIds: [...new Set(state.observationIds ?? [])].sort(),
      package: { language: graph.asset.language, sourceVersions: { ...graph.asset.sourceVersions },
        ...(input.languageData?.languageData?.version ? { metadataVersion: input.languageData.languageData.version } : {}) },
      rule: { id: source.ruleId, weight: source.rule.weight,
        ...(source.rule.version !== undefined ? { version: source.rule.version } : {}),
        ...(source.rule.dependencyGroup !== undefined ? { dependencyGroup: source.rule.dependencyGroup } : {}),
        ...(context !== undefined ? { transferContext: context } : {}) },
      assertions: source.assertions.map(assertion => ({ ...assertion })), assertionConfidence: source.confidence, calibration, credit });
  }
  const contributors = independentSupportContributors(possible);
  const supportTotal = contributors.reduce((total, contributor) => total + contributor.credit, 0);
  const paths = new Map<string, Prediction['supportPath'][number]>();
  for (const contributor of contributors) {
    const path = { from: contributor.source.entityId, to: target.entityId, via: contributor.assertions.map(assertion => assertion.type).join(' → ') };
    paths.set(JSON.stringify(path), path);
  }
  const base = direct ? input.classify(direct.ease) === 'learning' ? 0.35 : 0.1 : 0.05;
  return { supportScore: Math.min(0.85, base + Math.min(1, supportTotal) * 0.5),
    uncertainty: Math.max(0.15, 1 - supportTotal), supportPath: [...paths.values()], contributors,
    limits: [...new Set(limits)].sort(), kind: 'prediction' };
}
