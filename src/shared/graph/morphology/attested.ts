import { relationsOf, type LingualGraph } from '../load';
import type { CompoundAnalysis, CompoundPart } from './compounds';

/** Depth guard when resolving nested component-of trees (cycles, builder bugs). */
const MAX_DEPTH = 8;

function partsFromGraph(graph: LingualGraph, compoundId: string, depth: number): CompoundPart[] | null {
  if (depth > MAX_DEPTH) return null;
  // component-of relations are a SET — the graph carries no part ordering.
  // Resolve nodes first, then order deterministically by CODE-UNIT comparison
  // (host collation must never influence analysis output; ordering is display
  // only, not graph data). ID breaks label ties.
  const components = relationsOf(graph, compoundId, { direction: 'in' })
    .filter((relation) => relation.type === 'component-of')
    .map((relation) => ({ relation, node: graph.nodes.get(relation.from) }));
  if (components.length < 2 || components.some((component) => !component.node?.label)) return null;
  components.sort((a, b) =>
    (a.node!.label! < b.node!.label! ? -1 : a.node!.label! > b.node!.label! ? 1 : 0) ||
    (a.relation.from < b.relation.from ? -1 : a.relation.from > b.relation.from ? 1 : 0));
  const parts: CompoundPart[] = [];
  for (const { relation, node } of components) {
    const nested = partsFromGraph(graph, relation.from, depth + 1);
    parts.push({
      lemma: node!.label!,
      entryId: relation.from,
      attested: true,
      ...(nested ? { parts: nested } : {}),
    });
  }
  return parts;
}

/**
 * Graph-first decomposition: an ATTESTED compound's structure is read straight
 * from the Tier-2 graph's component-of relations — no guessing, no lexicon.
 * This is the primary representation; the runtime concatenative splitter only
 * ever fills in genuinely unseen/productive forms that the graph does not
 * describe. Parts keep their graph entity ids in `entryId`, so the analysis
 * stays grounded in graph identity rather than a parallel model.
 */
export function attestedCompoundAnalysis(graph: LingualGraph, surfaceId: string): CompoundAnalysis | null {
  const compound = graph.nodes.get(surfaceId);
  if (!compound || compound.kind !== 'surface' || !compound.label) return null;
  const parts = partsFromGraph(graph, surfaceId, 1);
  if (!parts) return null;
  const leaves: CompoundPart[] = [];
  const walk = (list: readonly CompoundPart[]): void => {
    for (const part of list) {
      if (part.parts) walk(part.parts);
      else leaves.push(part);
    }
  };
  walk(parts);
  return {
    form: compound.label,
    lemma: compound.label,
    source: 'attested',
    confidence: 1,
    provenance: { source: 'attested', confidence: 1, lexiconBasis: leaves.map((leaf) => leaf.entryId ?? leaf.lemma) },
    parts,
    ambiguous: false,
    alternatives: [],
  };
}

/**
 * Reads FIRST-CLASS analysis assertions targeting a surface: sibling `analysis`
 * entities connected via `analyzes`, with ordered members joined through
 * `analysis-member` edges. Multiple analyses on one target are competing
 * alternatives (consumers treat that as ambiguity); the nodes themselves grant
 * no learner capability. Metadata (layer, confidence, source) rides on the
 * analysis entity and survives the plain and compact wire forms.
 */
export function graphAnalysesFor(graph: LingualGraph, surfaceId: string): CompoundAnalysis[] {
  const surface = graph.nodes.get(surfaceId);
  if (!surface?.label) return [];
  const analyses: CompoundAnalysis[] = [];
  for (const relation of relationsOf(graph, surfaceId, { direction: 'in' })) {
    if (relation.type !== 'analyzes') continue;
    const node = graph.nodes.get(relation.from);
    if (!node || node.kind !== 'analysis') continue;
    const members: Array<{ id: string; order: number; label: string }> = [];
    for (const memberEdge of relationsOf(graph, relation.from, { direction: 'in' })) {
      if (memberEdge.type !== 'analysis-member') continue;
      const member = graph.nodes.get(memberEdge.from);
      if (!member?.label) continue;
      members.push({ id: memberEdge.from, order: memberEdge.order ?? Number.MAX_SAFE_INTEGER, label: member.label });
    }
    members.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const metadata = node.analysis;
    analyses.push({
      form: surface.label,
      lemma: surface.label,
      source: 'attested',
      confidence: metadata?.confidence ?? 1,
      provenance: {
        source: 'attested',
        confidence: metadata?.confidence ?? 1,
        lexiconBasis: members.map((member) => member.id),
      },
      parts: members.map((member) => ({ lemma: member.label, entryId: member.id, attested: true })),
      ambiguous: false,
      alternatives: [],
    });
  }
  return analyses;
}
