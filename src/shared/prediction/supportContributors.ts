import { relationsOf, type LingualGraph } from '../graph/load';
import type { GraphRelation, LearnableTarget } from '../graph/types';
import type { LanguageCapabilityDeclaration, LanguageData } from '../types';
import type { KnowledgeEvent } from '../knowledgeEvents';

type SupportRule = NonNullable<LanguageCapabilityDeclaration['supportRules']>[number];
export interface SupportSource {
  target: LearnableTarget;
  rule: SupportRule;
  ruleId: string;
  assertions: GraphRelation[];
  confidence: number;
}

/** Exact replay basis, never a structural relation or a familiar-looking label. */
export interface SourceKnowledge {
  basis: 'evidence' | 'claim';
  /** Stable physical attempt ids, when retained; absent archives grant no invented ids. */
  observationIds?: readonly string[];
  /** The actual retained response behind this replay state, not an inferred endpoint. */
  witness?: { attemptId: string; targetRef?: KnowledgeEvent['targetRef']; presentedSurface?: string };
}

export interface SupportContributor {
  source: LearnableTarget;
  /** Package-owned display text, frozen with the decision's provenance. */
  sourceLabel?: string;
  target: LearnableTarget;
  basis: SourceKnowledge['basis'];
  observationIds: string[];
  witness?: SourceKnowledge['witness'];
  package: { language: string; sourceVersions: Record<string, string>; metadataVersion?: string };
  rule: { id: string; version?: string; weight: number; dependencyGroup?: string; transferContext?: string };
  /** Complete package declaration: an explicit rule id alone does not prove equivalence. */
  ruleDefinition?: SupportRule;
  assertions: GraphRelation[];
  assertionConfidence: number;
  calibration: number;
  credit: number;
}

export function boundedSupportWeight(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

const MAX_PATH_HOPS = 4;
const MAX_PATHS_PER_RULE = 256;

/** The SAME bounded package rule resolver supplies journal reads and prediction. */
export function resolveSupportSources(graph: LingualGraph, target: LearnableTarget, languageData?: LanguageData | null,
  onLimit?: (reason: string) => void): SupportSource[] {
  const declared = languageData?.learning?.capabilities?.[target.capability]?.supportRules;
  if (!Array.isArray(declared) || declared.length === 0 || !graph.nodes.has(target.entityId)) return [];
  if (graph.relationDirectionKnown === false) { onLimit?.('assertion-direction-unavailable'); return []; }
  const result: SupportSource[] = [];
  for (const rule of declared) {
    if (rule && ['id', 'version', 'dependencyGroup', 'transferContext'].some(field => {
      const value = rule[field as 'id' | 'version' | 'dependencyGroup' | 'transferContext'];
      return value !== undefined && (typeof value !== 'string' || value.length === 0);
    })) { onLimit?.('invalid-support-rule'); continue; }
    if (!rule || typeof rule.relation !== 'string' || !rule.relation || typeof rule.sourceCapability !== 'string'
      || !rule.sourceCapability || boundedSupportWeight(rule.weight) === 0
      || (rule.direction !== undefined && rule.direction !== 'in' && rule.direction !== 'out')
      || (rule.sourcePath !== undefined && (!Array.isArray(rule.sourcePath) || rule.sourcePath.length >= MAX_PATH_HOPS))) continue;
    const steps = [{ relation: rule.relation, direction: rule.direction ?? 'in' }, ...(rule.sourcePath ?? [])];
    if (steps.length > MAX_PATH_HOPS || steps.some(step => !step || typeof step.relation !== 'string'
      || !step.relation || (step.direction !== 'in' && step.direction !== 'out'))) continue;
    const ruleId = rule.id ?? JSON.stringify([steps, rule.sourceCapability, rule.weight, rule.dependencyGroup ?? null, rule.transferContext ?? null]);
    let frontier = [{ id: target.entityId, assertions: [] as GraphRelation[], confidence: 1, visited: new Set([target.entityId]) }];
    let overflow = false;
    for (const [stepIndex, step] of steps.entries()) {
      const unique = new Map<string, typeof frontier[number]>();
      for (const route of frontier) {
        for (const assertion of relationsOf(graph, route.id, { direction: step.direction as 'in' | 'out' })) {
          if (assertion.type !== step.relation) continue;
          const id = step.direction === 'in' ? assertion.from : assertion.to;
          const distinctAccessAtOrigin = stepIndex === steps.length - 1 && id === target.entityId
            && rule.sourceCapability !== target.capability;
          if ((route.visited.has(id) && !distinctAccessAtOrigin) || !graph.nodes.has(id)) continue;
          const confidence = route.confidence * (assertion.confidence === undefined ? 1 : boundedSupportWeight(assertion.confidence));
          if (confidence === 0) continue;
          const assertions = [...route.assertions, assertion];
          const visited = new Set([...route.visited, id]);
          const signature = JSON.stringify([id, [...visited].sort()]);
          const prior = unique.get(signature);
          // Equivalent providers/paths are alternatives. Retain one strongest
          // asserted route before applying the unique-route budget.
          if (!prior || confidence > prior.confidence || (confidence === prior.confidence
            && JSON.stringify(assertions) < JSON.stringify(prior.assertions))) unique.set(signature, { id, assertions, confidence, visited });
          if (unique.size > MAX_PATHS_PER_RULE) { overflow = true; break; }
        }
        if (overflow) break;
      }
      if (overflow) break;
      frontier = [...unique.values()];
    }
    // Never silently choose a prefix of a package rule's candidates.
    if (overflow) { onLimit?.(`support-path-budget:${ruleId}`); continue; }
    for (const route of frontier) result.push({ target: { entityId: route.id, capability: rule.sourceCapability },
      rule, ruleId, assertions: route.assertions, confidence: route.confidence });
  }
  return result;
}

/** Alternative routes/accesses do not make one underlying observation independent. */
export function independentSupportContributors(contributors: readonly SupportContributor[]): SupportContributor[] {
  const sources = new Set<string>();
  const dependencies = new Set<string>();
  const observations = new Set<string>();
  const accepted: SupportContributor[] = [];
  const signature = (item: SupportContributor) => JSON.stringify([item.source, item.rule, item.assertions]);
  const compare = (a: SupportContributor, b: SupportContributor) => {
    const left = signature(a); const right = signature(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };
  const matchesWitness = (item: SupportContributor) => item.basis === 'evidence' && item.witness !== undefined
    && item.observationIds.includes(item.witness.attemptId)
    && item.witness.targetRef?.id === item.source.entityId
    && item.witness.targetRef.capability === item.source.capability;
  // Allocate credit before choosing its display representative. Witness priority
  // here would change which dependency groups remain available to other events.
  const ordered = [...contributors].sort((a, b) => b.credit - a.credit || compare(a, b));
  for (const item of ordered) {
    const sourceKey = JSON.stringify([item.source.entityId, item.source.capability]);
    const dependency = item.rule.dependencyGroup;
    if (sources.has(sourceKey) || (dependency && dependencies.has(dependency))
      || item.observationIds.some(id => observations.has(id))) continue;
    sources.add(sourceKey);
    if (dependency) dependencies.add(dependency);
    item.observationIds.forEach(id => observations.add(id));
    accepted.push(item);
  }
  const allocationSignature = (item: SupportContributor) => JSON.stringify([
    item.target, item.basis, [...item.observationIds].sort(), item.package,
    item.rule, item.ruleDefinition, item.assertionConfidence, item.calibration, item.credit,
  ]);
  const sourceKey = (item: SupportContributor) => JSON.stringify([item.source.entityId, item.source.capability]);
  // Equivalent declared routes can explain one retained response through several
  // semantic endpoints. Prefer its actual observed access only after allocation,
  // without creating a duplicate source or substituting different rule semantics.
  const represented = [...accepted];
  for (const [index, item] of accepted.entries()) {
    if (matchesWitness(item) || !item.ruleDefinition) continue;
    const alternatives = ordered.filter(candidate => matchesWitness(candidate)
      && candidate.ruleDefinition !== undefined
      && allocationSignature(candidate) === allocationSignature(item)
      && !represented.some((other, otherIndex) => otherIndex !== index && sourceKey(other) === sourceKey(candidate)));
    const representative = alternatives.sort(compare)[0];
    if (representative) represented[index] = representative;
  }
  return represented.sort(compare);
}
