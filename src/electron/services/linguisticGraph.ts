import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { COMPACT_RELATION_TYPES, decodeCompact, type CompactAssetJSON, type RuntimeCompactGraph } from '../../shared/graph/compact';
import type { GraphLookupInput, GraphMeta, GraphNeighborhood, GraphNeighborhoodQuery, GraphNode, GraphRelatedNode, GraphSurfaceTargets, GraphWordLookup } from '../../shared/graph/ipc';
import { RELATION_CATEGORY, type GraphRelationType } from '../../shared/graph/types';
import { getLanguageDataRoot } from './languageDataService';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.linguisticGraph');

type LoadedGraph = {
  language: string;
  graph: RuntimeCompactGraph;
  relationCount: number;
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
    return { center, centerDenseId: dense, relationCount: relations.length, relations };
  }

  async getTargetsForSurfaces(language: string, inputs: GraphLookupInput[]): Promise<GraphSurfaceTargets[]> {
    return Promise.all(inputs.slice(0, 100).map(async (input) => ({ input, lookup: await this.lookupWord(language, input) })));
  }
}

export function setupLinguisticGraphIPC(): void {
  const service = new LinguisticGraphService();
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_META, (_event, language: string) => service.getMeta(language));
  ipcMain.handle(IPC_CHANNELS.GRAPH_LOOKUP_WORD, (_event, language: string, input: GraphLookupInput) => service.lookupWord(language, input));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_RELATED, (_event, language: string, entityId: string, relationTypes: GraphRelationType[]) => service.getRelated(language, entityId, relationTypes));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_TARGETS_FOR_SURFACES, (_event, language: string, inputs: GraphLookupInput[]) => service.getTargetsForSurfaces(language, inputs));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_NEIGHBORHOOD, (_event, language: string, query: GraphNeighborhoodQuery) => service.getNeighborhood(language, query));
}
