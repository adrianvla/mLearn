import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { COMPACT_RELATION_TYPES, decodeCompact, type CompactAssetJSON, type RuntimeCompactGraph } from '../../shared/graph/compact';
import type { GraphLookupInput, GraphMeta, GraphNeighborhood, GraphNeighborhoodCenterState, GraphNeighborhoodQuery, GraphNode, GraphRelatedNode, GraphSurfaceTargets, GraphWordLookup, KnowledgeProjection } from '../../shared/graph/ipc';
import { RELATION_CATEGORY, type GraphRelation, type GraphRelationType, type LinguisticGraphAsset } from '../../shared/graph/types';
import { loadLinguisticGraph, type LingualGraph } from '../../shared/graph/load';
import { buildKnowledgeProjection } from './knowledgeProjection';
import { attestedCompoundAnalysis } from '../../shared/graph/morphology/attested';
import type { CompoundPart } from '../../shared/graph/morphology/compounds';
import type { PredictionInput } from '../../shared/prediction/supportPredictor';
import { replayKeyProjection } from '../../shared/utils/projectionReplay';
import { easeToStatus } from '../../shared/utils/knowledgeStrength';
import { getKnowledgeEvents } from './knowledgeEvents';
import { getLanguageDataRoot } from './languageDataService';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.linguisticGraph');

type LoadedGraph = {
  language: string;
  graph: RuntimeCompactGraph;
  relationCount: number;
  /**
   * Plain-graph replica for projections, built lazily on first projection use
   * and cached on the loaded asset instance. Invalidation is structural: every
   * (re)load of a language creates a fresh LoadedGraph without a replica, and
   * only one language stays loaded at a time, so at most one replica is held.
   */
  plainGraph?: LingualGraph;
};

const notInstalledMeta = (): GraphMeta => ({ entityCount: 0, relationCount: 0, ready: false, status: 'not-installed' });
const errorMeta = (): GraphMeta => ({ entityCount: 0, relationCount: 0, ready: false, status: 'error' });

export class LinguisticGraphService {
  private active: LoadedGraph | undefined;
  private loading: { language: string; promise: Promise<LoadedGraph | undefined> } | undefined;

  constructor(private readonly dataRoot = getLanguageDataRoot()) {}

  private graphPath(language: string): string {
    return path.join(this.dataRoot, 'languages', `${language}.graph.json`);
  }

  private async load(language: string): Promise<LoadedGraph | undefined> {
    try {
      const source = await fs.promises.readFile(this.graphPath(language), 'utf8');
      // Decode costs about 200ms for Japanese, so it is deliberately demand-loaded,
      // never during startup, and only one decoded active-language graph is retained.
      const compact = JSON.parse(source) as CompactAssetJSON;
      if (compact.language !== language) throw new Error(`Graph language mismatch: expected ${language}`);
      const graph = decodeCompact(compact);
      return { language, graph, relationCount: graph.relationTargets.length };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      log.error(`Failed to load linguistic graph for ${language}`, error);
      throw error;
    }
  }

  private async ensure(language: string): Promise<LoadedGraph | undefined> {
    if (this.active?.language === language) return this.active;
    if (this.loading?.language === language) return this.loading.promise;

    this.active = undefined;
    const promise = this.load(language).then((loaded) => {
      if (loaded) this.active = loaded;
      return loaded;
    }).finally(() => {
      if (this.loading?.promise === promise) this.loading = undefined;
    });
    this.loading = { language, promise };
    return promise;
  }

  async getMeta(language: string): Promise<GraphMeta> {
    try {
      const loaded = await this.ensure(language);
      return loaded
        ? { entityCount: loaded.graph.persistentOf.length, relationCount: loaded.relationCount, ready: true, status: 'ready' }
        : notInstalledMeta();
    } catch {
      return errorMeta();
    }
  }

  private node(graph: RuntimeCompactGraph, id: string): GraphNode | undefined {
    const dense = graph.denseOf.get(id);
    const kind = graph.nodeKind(id);
    if (dense === undefined || !kind) return undefined;
    const labelId = graph.entityLabelStringIds[dense];
    const domainId = graph.entityDomainIds[dense];
    const domains = [undefined, 'common', 'names', 'archaic', 'technical', 'dialectal'] as const;
    return { id, kind, ...(domains[domainId] ? { domain: domains[domainId] } : {}), ...(labelId >= 0 ? { label: graph.stringTable[labelId] } : {}) };
  }

  private related(graph: RuntimeCompactGraph, id: string, relationTypes: readonly GraphRelationType[]): GraphRelatedNode[] {
    const dense = graph.denseOf.get(id);
    if (dense === undefined) return [];
    const allowed = new Set(relationTypes);
    const related: GraphRelatedNode[] = [];
    for (let edge = graph.relationOffsets[dense]; edge < graph.relationOffsets[dense + 1]; edge += 1) {
      const relationType = COMPACT_RELATION_TYPES[graph.relationTypeIds[edge]];
      if (!allowed.has(relationType)) continue;
      const node = this.node(graph, graph.persistentOf[graph.relationTargets[edge]]);
      if (node) related.push({
        ...node,
        relationType,
        ...(graph.relationConfidence && graph.relationConfidence[edge] >= 0 ? { confidence: graph.relationConfidence[edge] } : {}),
        ...(graph.relationTransparency && graph.relationTransparency[edge] >= 0 ? { transparency: graph.relationTransparency[edge] } : {}),
        ...(graph.relationPredictability && graph.relationPredictability[edge] >= 0 ? { predictability: graph.relationPredictability[edge] } : {}),
        ...(graph.relationProvenanceStringIds && graph.relationProvenanceStringIds[edge] >= 0 ? { provenance: graph.stringTable[graph.relationProvenanceStringIds[edge]] } : {}),
      });
    }
    return related;
  }

  private surfaceId(language: string, input: GraphLookupInput): string | undefined {
    const hash = input.hash ?? (input.surface ? crypto.createHash('sha256').update(input.surface).digest('hex') : undefined);
    return hash && /^[a-f0-9]{64}$/i.test(hash) ? `${language}:surface:${hash.toLowerCase()}` : undefined;
  }

  async lookupWord(language: string, input: GraphLookupInput): Promise<GraphWordLookup | null> {
    const loaded = await this.ensure(language);
    const surfaceId = this.surfaceId(language, input);
    if (!loaded || !surfaceId || !loaded.graph.has(surfaceId)) return null;
    const entries = this.related(loaded.graph, surfaceId, ['realizes']).map(({ relationType: _relationType, ...node }) => node);
    const lexemes = this.related(loaded.graph, surfaceId, ['lemma-of', 'inflection-of']).map(({ relationType: _relationType, ...node }) => node);
    const pronunciations = this.related(loaded.graph, surfaceId, ['has-pronunciation']).map(({ relationType: _relationType, ...node }) => node);
    const senses = entries.flatMap((entry) => this.related(loaded.graph, entry.id, ['has-sense']).map(({ relationType: _relationType, ...node }) => node));
    return { surfaceId, entries, lexemes, senses, pronunciations };
  }

  async getRelated(language: string, entityId: string, relationTypes: GraphRelationType[]): Promise<GraphRelatedNode[]> {
    const loaded = await this.ensure(language);
    return loaded ? this.related(loaded.graph, entityId, relationTypes) : [];
  }

  async getNeighborhood(language: string, query: GraphNeighborhoodQuery): Promise<GraphNeighborhood | null> {
    const loaded = await this.ensure(language);
    if (!loaded || query.depth === 2) return null;
    const center = this.node(loaded.graph, query.entityId);
    const dense = loaded.graph.denseOf.get(query.entityId);
    if (!center || dense === undefined) return null;
    const classes = query.relationClasses ? new Set(query.relationClasses) : undefined;
    const limit = Math.min(Math.max(query.limit ?? 80, 1), 200);
    const relationTypes = COMPACT_RELATION_TYPES.filter((type) => !classes || classes.has(RELATION_CATEGORY[type]));
    const relations = this.related(loaded.graph, query.entityId, relationTypes).slice(0, limit);
    const centerStates = center.kind === 'surface' ? await this.centerStates(loaded, language, query.entityId) : undefined;
    return { center, centerDenseId: dense, relationCount: relations.length, relations, ...(centerStates?.length ? { centerStates } : {}) };
  }

  /**
   * Center-surface learner states (classification, basis) from the same
   * buildKnowledgeProjection the inspector uses — one payload instead of a
   * serial per-node call. Best effort: any failure degrades to absence.
   */
  private async centerStates(loaded: LoadedGraph, language: string, surfaceId: string): Promise<GraphNeighborhoodCenterState[] | undefined> {
    try {
      const prefix = `${language}:surface:`;
      const hash = surfaceId.startsWith(prefix) ? surfaceId.slice(prefix.length) : undefined;
      if (!hash) return undefined;
      const [{ loadFlashcards }, { getKnowledgeEvents }] = await Promise.all([
        import('./flashcardStorage'),
        import('./knowledgeEvents'),
      ]);
      const [store, events] = await Promise.all([
        loadFlashcards(),
        Promise.resolve(getKnowledgeEvents([`${language}:${hash}`])),
      ]);
      const projection = buildKnowledgeProjection(this.toLingualGraph(loaded), surfaceId, events[`${language}:${hash}`] ?? [], store.meta);
      return projection.targets
        .filter((target) => target.targetRef.id === surfaceId)
        .flatMap((target) => target.states.map(({ capability, classification, basis }) => ({ capability, classification, basis })));
    } catch {
      return undefined;
    }
  }

  async getTargetsForSurfaces(language: string, inputs: GraphLookupInput[]): Promise<GraphSurfaceTargets[]> {
    return Promise.all(inputs.slice(0, 100).map(async (input) => ({ input, lookup: await this.lookupWord(language, input) })));
  }

  async getKnowledgeProjection(language: string, surface: string): Promise<KnowledgeProjection> {
    try {
      const loaded = await this.ensure(language);
      if (!loaded) return { status: 'not-installed', targets: [] };
      const hash = crypto.createHash('sha256').update(surface).digest('hex');
      const surfaceId = `${language}:surface:${hash}`;
      if (!loaded.graph.has(surfaceId)) {
        return { status: 'ready', surfaceId, targets: [], querySurface: surface, surfaceKnown: false, compoundAnalysis: null };
      }
      const [{ loadFlashcards }, { getKnowledgeEvents }] = await Promise.all([
        import('./flashcardStorage'),
        import('./knowledgeEvents'),
      ]);
      const [store, events] = await Promise.all([
        loadFlashcards(),
        Promise.resolve(getKnowledgeEvents([`${language}:${hash}`])),
      ]);
      const plain = this.toLingualGraph(loaded);
      const compound = await this.compoundSupport(plain, language, surfaceId);
      const projection = buildKnowledgeProjection(plain, surfaceId, events[`${language}:${hash}`] ?? [], store.meta, undefined, undefined, { compound });
      return { ...projection, querySurface: surface, surfaceKnown: true, compoundAnalysis: compound?.analysis ?? null };
    } catch {
      return { status: 'error', targets: [] };
    }
  }

  /**
   * Graph-first compound support for a projection: attested structure comes
   * from component-of graph edges (primary representation); `isKnownPart`
   * consults each part surface's own evidence projection, never the compound's.
   */
  private async compoundSupport(plain: LingualGraph, language: string, surfaceId: string): Promise<PredictionInput['compound'] | undefined> {
    try {
      const analysis = attestedCompoundAnalysis(plain, surfaceId);
      if (!analysis) return undefined;
      const prefix = `${language}:surface:`;
      const leaves: Array<{ lemma: string; entryId: string }> = [];
      const walk = (parts: readonly CompoundPart[]): void => {
        for (const part of parts) {
          if (part.parts) walk(part.parts);
          else leaves.push({ lemma: part.lemma, entryId: part.entryId ?? '' });
        }
      };
      walk(analysis.parts);
      const keys = [...new Set(leaves.map((leaf) => (leaf.entryId.startsWith(prefix) ? `${language}:${leaf.entryId.slice(prefix.length)}` : '')))].filter(Boolean);
      const partEvents = keys.length > 0 ? getKnowledgeEvents(keys) : {};
      const knownLeaves = new Set(
        leaves
          .filter((leaf) => {
            if (!leaf.entryId.startsWith(prefix)) return false;
            const projection = replayKeyProjection(partEvents[`${language}:${leaf.entryId.slice(prefix.length)}`] ?? []);
            return projection ? easeToStatus(projection.ease) === 'known' : false;
          })
          .map((leaf) => leaf.lemma),
      );
      return { analysis, isKnownPart: (lemma: string) => knownLeaves.has(lemma) };
    } catch {
      return undefined;
    }
  }

  private toLingualGraph(loaded: LoadedGraph): LingualGraph {
    if (!loaded.plainGraph) loaded.plainGraph = this.buildLingualGraph(loaded);
    return loaded.plainGraph;
  }

  /** Full plain-graph replica of the compact graph; expensive, so cached per loaded asset. */
  private buildLingualGraph(loaded: LoadedGraph): LingualGraph {
    const { graph } = loaded;
    const domains = [undefined, 'common', 'names', 'archaic', 'technical', 'dialectal'] as const;
    const entities = graph.persistentOf.map((id, dense) => {
      const labelId = graph.entityLabelStringIds[dense];
      const domain = domains[graph.entityDomainIds[dense]];
      return {
        id,
        kind: graph.nodeKind(id)!,
        ...(domain ? { domain } : {}),
        ...(labelId >= 0 ? { label: graph.stringTable[labelId] } : {}),
        ...(graph.entityGrammar?.[dense] ? { grammar: graph.entityGrammar[dense] } : {}),
        ...(graph.entityAnalysis?.[dense] ? { analysis: graph.entityAnalysis[dense] } : {}),
      };
    });
    const relations: GraphRelation[] = [];
    for (let dense = 0; dense < graph.persistentOf.length; dense += 1) {
      for (let edge = graph.relationOffsets[dense]; edge < graph.relationOffsets[dense + 1]; edge += 1) {
        const confidence = graph.relationConfidence?.[edge];
        const transparency = graph.relationTransparency?.[edge];
        const predictability = graph.relationPredictability?.[edge];
        const provenance = graph.relationProvenanceStringIds?.[edge];
        relations.push({
          from: graph.persistentOf[dense],
          to: graph.persistentOf[graph.relationTargets[edge]],
          type: COMPACT_RELATION_TYPES[graph.relationTypeIds[edge]],
          ...(confidence !== undefined && confidence >= 0 ? { confidence } : {}),
          ...(transparency !== undefined && transparency >= 0 ? { transparency } : {}),
          ...(predictability !== undefined && predictability >= 0 ? { predictability } : {}),
          ...(provenance !== undefined && provenance >= 0 ? { provenance: graph.stringTable[provenance] } : {}),
        });
      }
    }
    const asset: LinguisticGraphAsset = { schemaVersion: 1, language: loaded.language, generatedAt: '', sourceVersions: {}, entities, relations };
    return loadLinguisticGraph(asset);
  }
}

export function setupLinguisticGraphIPC(): void {
  const service = new LinguisticGraphService();
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_META, (_event, language: string) => service.getMeta(language));
  ipcMain.handle(IPC_CHANNELS.GRAPH_LOOKUP_WORD, (_event, language: string, input: GraphLookupInput) => service.lookupWord(language, input));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_RELATED, (_event, language: string, entityId: string, relationTypes: GraphRelationType[]) => service.getRelated(language, entityId, relationTypes));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_TARGETS_FOR_SURFACES, (_event, language: string, inputs: GraphLookupInput[]) => service.getTargetsForSurfaces(language, inputs));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_NEIGHBORHOOD, (_event, language: string, query: GraphNeighborhoodQuery) => service.getNeighborhood(language, query));
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_GET_PROJECTION, (_event, language: string, surface: string) => service.getKnowledgeProjection(language, surface));
}
