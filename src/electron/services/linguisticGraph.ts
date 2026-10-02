import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { COMPACT_RELATION_TYPES, decodeCompact, type CompactAssetJSON, type RuntimeCompactGraph } from '../../shared/graph/compact';
import type { GraphLookupInput, GraphMeta, GraphNeighborhood, GraphNeighborhoodCenterState, GraphNeighborhoodQuery, GraphNode, GraphRelatedNode, GraphSurfaceTargets, GraphWordLookup, KnowledgeProjection } from '../../shared/graph/ipc';
import { relationCategory, type GraphRelationType } from '../../shared/graph/types';
import type { LingualGraph } from '../../shared/graph/load';
import { createCompactGraphView } from '../../shared/graph/compactView';
import { buildKnowledgeProjection, projectionEntityIds } from './knowledgeProjection';
import { scopeSiblingArchive, scopeSiblingEvent } from './siblingKnowledgeHistory';
import { attestedCompoundAnalysis } from '../../shared/graph/morphology/attested';
import { resolveSupportSources } from '../../shared/prediction/supportContributors';
import { learnableTargetsFor } from '../../shared/graph/targets';
import { effectiveThresholds, type EffectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { journalKeyOfSurfaceEntity, lexicalContextEntryIds, realizedEntryIds, siblingJournalKeys, surfacesRealizingEntry } from '../../shared/graph/addressing';
import { getLanguageDataRoot } from './languageDataService';
import { getLogger } from '../../shared/utils/logger';
import type { LanguageData, LanguageDataMap } from '../../shared/types';
import { languagePackageRevision } from './languagePackageRevision';

const log = getLogger('electron.linguisticGraph');

type LoadedGraph = {
  language: string;
  revision: number;
  graph: RuntimeCompactGraph;
  relationCount: number;
  /**
   * Compact-backed LingualGraph view for projections, built lazily on first
   * projection use and cached on the loaded asset instance. Cheap to build
   * (no object materialization); invalidation is structural: every (re)load
   * of a language creates a fresh LoadedGraph without a view, and only one
   * language stays loaded at a time.
   */
  plainGraph?: LingualGraph;
  /** Package metadata is stable for the lifetime of a loaded graph asset. */
  languageData?: LanguageData;
  languageDataResolved?: boolean;
};

const notInstalledMeta = (): GraphMeta => ({ entityCount: 0, relationCount: 0, ready: false, status: 'not-installed' });
const errorMeta = (): GraphMeta => ({ entityCount: 0, relationCount: 0, ready: false, status: 'error' });

export class LinguisticGraphService {
  private active: LoadedGraph | undefined;
  private loading: { language: string; revision: number; promise: Promise<LoadedGraph | undefined> } | undefined;

  constructor(private readonly dataRoot = getLanguageDataRoot()) {}

  private graphPath(language: string): string {
    return path.join(this.dataRoot, 'languages', `${language}.graph.json`);
  }

  private async load(language: string): Promise<LoadedGraph | undefined> {
    const revision = languagePackageRevision(this.dataRoot, language);
    try {
      const source = await fs.promises.readFile(this.graphPath(language), 'utf8');
      // Decode costs about 200ms for Japanese, so it is deliberately demand-loaded,
      // never during startup, and only one decoded active-language graph is retained.
      const compact = JSON.parse(source) as CompactAssetJSON;
      if (compact.language !== language) throw new Error(`Graph language mismatch: expected ${language}`);
      const graph = decodeCompact(compact);
      return { language, revision, graph, relationCount: graph.relationTargets.length };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      log.error(`Failed to load linguistic graph for ${language}`, error);
      throw error;
    }
  }

  private async ensure(language: string): Promise<LoadedGraph | undefined> {
    const revision = languagePackageRevision(this.dataRoot, language);
    if (this.active?.language === language && this.active.revision === revision) return this.active;
    if (this.loading?.language === language && this.loading.revision === revision) return this.loading.promise;

    this.active = undefined;
    const promise: Promise<LoadedGraph | undefined> = this.load(language).then((loaded) => {
      if (languagePackageRevision(this.dataRoot, language) !== revision) return this.ensure(language);
      if (loaded && this.loading?.promise === promise) this.active = loaded;
      return loaded;
    }).finally(() => {
      if (this.loading?.promise === promise) this.loading = undefined;
    });
    this.loading = { language, revision, promise };
    return promise;
  }

  async getMeta(language: string): Promise<GraphMeta> {
    try {
      const loaded = await this.ensure(language);
      if (loaded && loaded.revision !== languagePackageRevision(this.dataRoot, language)) return this.getMeta(language);
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
    // Use the package's own meanings to distinguish homographic source entries.
    // This is a display summary only; the canonical label and ID stay intact.
    let displayLabel = graph.entityGrammar?.[dense]?.meaning;
    if (!displayLabel && (kind === 'dictionary-entry' || kind === 'lexeme')) {
      const meanings = new Set<string>();
      for (let edge = graph.relationOffsets[dense]; edge < graph.relationOffsets[dense + 1]; edge++) {
        if (COMPACT_RELATION_TYPES[graph.relationTypeIds[edge]] !== 'has-sense') continue;
        const target = graph.relationTargets[edge];
        if (graph.nodeKind(graph.persistentOf[target]) !== 'sense') continue;
        const meaningLabel = graph.entityLabelStringIds[target];
        if (meaningLabel >= 0) meanings.add(graph.stringTable[meaningLabel]);
        if (meanings.size === 2) break;
      }
      if (meanings.size) displayLabel = [labelId >= 0 ? graph.stringTable[labelId] : '', [...meanings].join('; ')].filter(Boolean).join(' — ');
    }
    const learnableCapabilities = graph.entityLearnableCapabilities?.[dense];
    const features = graph.entityFeatures?.[dense];
    return { id, kind, ...(displayLabel ? { displayLabel } : {}), ...(domains[domainId] ? { domain: domains[domainId] } : {}), ...(labelId >= 0 ? { label: graph.stringTable[labelId] } : {}), ...(learnableCapabilities?.length ? { learnableCapabilities: [...learnableCapabilities] } : {}), ...(features !== undefined ? { features: structuredClone(features) } : {}) };
  }

  private related(graph: RuntimeCompactGraph, id: string, relationTypes: readonly GraphRelationType[]): GraphRelatedNode[] {
    const dense = graph.denseOf.get(id);
    if (dense === undefined) return [];
    const allowed = new Set(relationTypes);
    const related: GraphRelatedNode[] = [];
    for (let edge = graph.relationOffsets[dense]; edge < graph.relationOffsets[dense + 1]; edge += 1) {
      const typeId = graph.relationTypeIds[edge];
      const relationType = COMPACT_RELATION_TYPES[typeId] ?? graph.extensionRelationTypeStrings?.[typeId - COMPACT_RELATION_TYPES.length];
      if (!relationType) continue;
      if (!allowed.has(relationType)) continue;
      const node = this.node(graph, graph.persistentOf[graph.relationTargets[edge]]);
      if (node) related.push({
        ...node,
        relationType,
        ...(graph.relationOrders?.[edge] !== undefined ? { order: graph.relationOrders[edge] } : {}),
        ...(graph.relationRoles?.[edge] !== undefined ? { role: graph.relationRoles[edge] } : {}),
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
    if (loaded && loaded.revision !== languagePackageRevision(this.dataRoot, language)) return this.lookupWord(language, input);
    const surfaceId = this.surfaceId(language, input);
    if (!loaded || !surfaceId || !loaded.graph.has(surfaceId)) return null;
    const entries = this.related(loaded.graph, surfaceId, ['realizes']).map(({ relationType: _relationType, ...node }) => node);
    const lexemes = this.related(loaded.graph, surfaceId, ['lemma-of', 'inflection-of']).map(({ relationType: _relationType, ...node }) => node);
    const pronunciations = this.related(loaded.graph, surfaceId, ['has-pronunciation']).map(({ relationType: _relationType, ...node }) => node);
    const senses = entries.flatMap((entry) => this.related(loaded.graph, entry.id, ['has-sense']).map(({ relationType: _relationType, ...node }) => node));
    // Plain-replica read: warm at load time (see ensure), so this is a cache
    // hit per lookup — the graph pays, the hover doesn't.
    const compoundAnalysis = attestedCompoundAnalysis(this.toLingualGraph(loaded), surfaceId);
    return { surfaceId, entries, lexemes, senses, pronunciations, compoundAnalysis };
  }

  async getRelated(language: string, entityId: string, relationTypes: GraphRelationType[]): Promise<GraphRelatedNode[]> {
    const loaded = await this.ensure(language);
    if (loaded && loaded.revision !== languagePackageRevision(this.dataRoot, language)) return this.getRelated(language, entityId, relationTypes);
    return loaded ? this.related(loaded.graph, entityId, relationTypes) : [];
  }

  async getNeighborhood(language: string, query: GraphNeighborhoodQuery): Promise<GraphNeighborhood | null> {
    const loaded = await this.ensure(language);
    if (!loaded || query.depth === 2) return null;
    const center = this.node(loaded.graph, query.entityId);
    const dense = loaded.graph.denseOf.get(query.entityId);
    if (!center || dense === undefined) return null;
    const classes = query.relationClasses ? new Set(query.relationClasses) : undefined;
    const limit = Number.isFinite(query.limit) ? Math.min(Math.max(Math.floor(query.limit!), 1), 200) : 80;
    const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset!)) : 0;
    const relationTypes = [...COMPACT_RELATION_TYPES, ...(loaded.graph.extensionRelationTypeStrings ?? [])]
      .filter((type) => !classes || (relationCategory(type) !== undefined && classes.has(relationCategory(type)!)));
    const relations = this.related(loaded.graph, query.entityId, relationTypes);
    // Lexical properties belong to the entry/lexeme realized by a surface.
    // Follow only those identity links, never semantic-support siblings.
    if (center.kind === 'surface') {
      const lexicalNodes = this.related(loaded.graph, query.entityId, ['realizes', 'lemma-of', 'inflection-of']);
      const propertyTypes = relationTypes.filter((type) => relationCategory(type) === 'property');
      for (const lexicalNode of lexicalNodes) {
        if (lexicalNode.kind !== 'dictionary-entry' && lexicalNode.kind !== 'lexeme') continue;
        for (const property of this.related(loaded.graph, lexicalNode.id, propertyTypes)) {
          // Keep distinct lexical paths and qualifiers. These are presentation
          // context, not new center-to-property edges in the canonical graph.
          if (property.id !== center.id) relations.push({ ...property, via: lexicalNode });
        }
      }
    }
    const centerStates = center.kind === 'surface' ? await this.centerStates(loaded, language, query.entityId, query.thresholds) : undefined;
    if (loaded.revision !== languagePackageRevision(this.dataRoot, language)) return this.getNeighborhood(language, query);
    return { center, centerDenseId: dense, relationCount: relations.length, relations: relations.slice(offset, offset + limit), ...(centerStates?.length ? { centerStates } : {}) };
  }

  /**
   * Center-surface learner states (classification, basis) from the same
   * buildKnowledgeProjection the inspector uses — one payload instead of a
   * serial per-node call. Best effort: any failure degrades to absence.
   */
  private async centerStates(loaded: LoadedGraph, language: string, surfaceId: string, requestedThresholds?: EffectiveThresholds): Promise<GraphNeighborhoodCenterState[] | undefined> {
    try {
      const projection = await this.projectionFor(loaded, language, surfaceId, requestedThresholds);
      return projection?.targets.filter(target => target.targetRef.id === surfaceId)
        .flatMap(target => target.states.map(({ capability, classification, basis }) => ({ capability, classification, basis })));
    } catch {
      return undefined;
    }
  }

  private async projectionFor(loaded: LoadedGraph, language: string, surfaceId: string, requestedThresholds?: EffectiveThresholds): Promise<KnowledgeProjection | undefined> {
    const [{ loadFlashcards }, { getKnowledgeRows, getKnowledgeArchives }, settingsModule] = await Promise.all([
      import('./flashcardStorage'),
      import('./knowledgeEvents'),
      import('./settings'),
    ]);
    const store = await loadFlashcards();
    if (loaded.revision !== languagePackageRevision(this.dataRoot, language)) {
      return undefined;
    }
    const thresholds = requestedThresholds ?? effectiveThresholds(settingsModule.loadSettings());
    const plain = this.toLingualGraph(loaded);
    // Graph-relative addressing: evidence recorded through an authoritative
    // variant surface resolves to the shared lexical object, so the
    // projection consults sibling journal keys (never copies state).
    const keys = siblingJournalKeys(plain, surfaceId);
    const languageData = Object.prototype.hasOwnProperty.call(settingsModule, 'loadLangData')
      ? this.projectionLanguageData(loaded, settingsModule.loadLangData)
      : undefined;
    const targetIds = projectionEntityIds(plain, surfaceId);
    // Resolve the same package-authorized paths used by prediction. Source
    // journals and identity variants are only inputs, never copied mastery.
    for (const id of targetIds) keys.push(journalKeyOfSurfaceEntity(id));
    const targets = learnableTargetsFor(plain, [...targetIds].flatMap(id => {
      const entity = plain.nodes.get(id);
      return entity ? [entity] : [];
    }));
    for (const target of targets) {
      for (const source of resolveSupportSources(plain, target, languageData)) {
        keys.push(...siblingJournalKeys(plain, source.target.entityId));
        for (const entry of lexicalContextEntryIds(plain, source.target.entityId)) {
          for (const variant of surfacesRealizingEntry(plain, entry)) keys.push(journalKeyOfSurfaceEntity(variant));
        }
      }
    }
    const distinctKeys = [...new Set(keys)];
    const rowLog = getKnowledgeRows(distinctKeys);
    const rows = distinctKeys.flatMap((key) => (rowLog[key] ?? []).map(row => ({ ...row, event: scopeSiblingEvent(row.event, key, keys[0]) })));
    const archives = getKnowledgeArchives(distinctKeys)
      .map(({ key, archive }) => archive ? scopeSiblingArchive(archive, key, keys[0]) : undefined)
      .filter((archive): archive is NonNullable<typeof archive> => archive !== undefined);
    const compoundAnalysis = attestedCompoundAnalysis(plain, surfaceId);
    const projection = buildKnowledgeProjection(plain, surfaceId, rows, store.meta, undefined, undefined, { archives, thresholds, languageData });
    return { ...projection, surfaceKnown: loaded.graph.has(surfaceId), compoundAnalysis };
  }

  async getTargetsForSurfaces(language: string, inputs: GraphLookupInput[]): Promise<GraphSurfaceTargets[]> {
    const revision = languagePackageRevision(this.dataRoot, language);
    const results = await Promise.all(inputs.slice(0, 100).map(async (input) => ({ input, lookup: await this.lookupWord(language, input) })));
    return revision === languagePackageRevision(this.dataRoot, language) ? results : this.getTargetsForSurfaces(language, inputs);
  }

  /**
   * Return the candidate surfaces that can consult an evidence key through
   * the graph's authoritative `realizes` relation. This is a conservative
   * superset: a sibling row can still be rejected by address/capability
   * matching inside buildKnowledgeProjection. Filtering by each word's own
   * hash alone loses valid variant evidence (and changes learner counts).
   */
  async getEvidenceLinkedSurfaces(language: string, surfaces: readonly string[], evidenceKeys: readonly string[]): Promise<string[]> {
    const loaded = await this.ensure(language);
    if (loaded && loaded.revision !== languagePackageRevision(this.dataRoot, language)) return this.getEvidenceLinkedSurfaces(language, surfaces, evidenceKeys);
    if (!loaded) return [...new Set(surfaces)]; // preserve the not-installed projection failure
    const graph = this.toLingualGraph(loaded);
    const addressed = new Set<string>();
    const prefix = `${language}:`;
    for (const key of evidenceKeys) {
      if (!key.startsWith(prefix)) continue;
      const hash = key.slice(prefix.length);
      if (!/^[a-f0-9]{64}$/.test(hash)) continue;
      const surfaceId = `${language}:surface:${hash}`;
      addressed.add(surfaceId);
      if (!graph.nodes.has(surfaceId)) continue;
      for (const entryId of realizedEntryIds(graph, surfaceId)) {
        for (const siblingId of surfacesRealizingEntry(graph, entryId)) addressed.add(siblingId);
      }
    }
    return [...new Set(surfaces)].filter((surface) =>
      addressed.has(`${language}:surface:${crypto.createHash('sha256').update(surface).digest('hex')}`));
  }

  async getKnowledgeProjection(language: string, surface: string, requestedThresholds?: EffectiveThresholds): Promise<KnowledgeProjection> {
    try {
      const loaded = await this.ensure(language);
      if (!loaded) return { status: 'not-installed', targets: [] };
      const hash = crypto.createHash('sha256').update(surface).digest('hex');
      const surfaceId = `${language}:surface:${hash}`;
      const projection = await this.projectionFor(loaded, language, surfaceId, requestedThresholds);
      if (!projection || loaded.revision !== languagePackageRevision(this.dataRoot, language)) return this.getKnowledgeProjection(language, surface, requestedThresholds);
      return { ...projection, querySurface: surface };
    } catch {
      return { status: 'error', targets: [] };
    }
  }

  private toLingualGraph(loaded: LoadedGraph): LingualGraph {
    if (!loaded.plainGraph) loaded.plainGraph = createCompactGraphView(loaded.graph, loaded.language);
    return loaded.plainGraph;
  }

  /**
   * Projection construction needs package-declared capability metadata, but
   * loading all installed metadata is synchronous filesystem work. Cache the
   * selected package with its active graph so a collection request cannot
   * repeatedly block the main process behind the same metadata scan.
   */
  private projectionLanguageData(loaded: LoadedGraph, loadLanguageData: () => LanguageDataMap): LanguageData | undefined {
    if (!loaded.languageDataResolved) {
      loaded.languageData = loadLanguageData()[loaded.language];
      loaded.languageDataResolved = true;
    }
    return loaded.languageData;
  }
}

export function setupLinguisticGraphIPC(): void {
  const service = new LinguisticGraphService();
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_META, (_event, language: string) => service.getMeta(language));
  ipcMain.handle(IPC_CHANNELS.GRAPH_LOOKUP_WORD, (_event, language: string, input: GraphLookupInput) => service.lookupWord(language, input));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_RELATED, (_event, language: string, entityId: string, relationTypes: GraphRelationType[]) => service.getRelated(language, entityId, relationTypes));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_TARGETS_FOR_SURFACES, (_event, language: string, inputs: GraphLookupInput[]) => service.getTargetsForSurfaces(language, inputs));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_NEIGHBORHOOD, (_event, language: string, query: GraphNeighborhoodQuery) => service.getNeighborhood(language, query));
  ipcMain.handle(IPC_CHANNELS.GRAPH_GET_EVIDENCE_LINKED_SURFACES, (_event, language: string, surfaces: string[], keys: string[]) => service.getEvidenceLinkedSurfaces(language, surfaces, keys));
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_GET_PROJECTION, (_event, language: string, surface: string, thresholds?: EffectiveThresholds) => service.getKnowledgeProjection(language, surface, thresholds));
}
