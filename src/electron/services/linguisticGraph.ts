import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { COMPACT_RELATION_TYPES, decodeCompact, encodeCompact, type CompactAssetJSON, type RuntimeCompactGraph } from '../../shared/graph/compact';
import type { GraphLookupInput, GraphMeta, GraphNeighborhood, GraphNeighborhoodCenterState, GraphNeighborhoodQuery, GraphNode, GraphRelatedNode, GraphSurfaceTargets, GraphWordLookup, KnowledgeProjection, KnowledgeProjectionCollection, KnowledgeProjectionRevision } from '../../shared/graph/ipc';
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
import type { RetentionPolicy } from '../../shared/srs/retentionScheduler';

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
const PROJECTION_COLLECTION_CACHE_SIZE = 4;
// Reserve a separate slot so high-churn single-surface lookups cannot evict
// the reusable whole-library collection shown by Knowledge/Progress.
const PROJECTION_COLLECTION_BROAD_QUERY_THRESHOLD = 64;
const PROJECTION_COLLECTION_BROAD_CACHE_SIZE = 1;
const PROJECTION_COLLECTION_CACHE_TTL_MS = 60_000;
const MAX_ACTIVE_PROJECTION_WORKERS = 4;
const PROJECTION_REVISION_ATTEMPTS = 3;

type ProjectionSnapshot = {
  policy: RetentionPolicy;
  thresholds: EffectiveThresholds;
  languageData?: LanguageData;
  revision: KnowledgeProjectionRevision;
  ledgerId: string;
  profilePath: string;
  journal: Pick<typeof import('./knowledgeEvents'), 'getKnowledgeRows' | 'getKnowledgeArchives' | 'getAddressedKnowledgeKeys' | 'getKnowledgeSequence' | 'ratingLedgerId'>;
};
type ProjectionModules = {
  flashcards: typeof import('./flashcardStorage');
  journal: typeof import('./knowledgeEvents');
  settings: typeof import('./settings');
};

export class LinguisticGraphService {
  private active: LoadedGraph | undefined;
  private loading: { language: string; revision: number; promise: Promise<LoadedGraph | undefined> } | undefined;
  private readonly inFlightProjectionCollections = new Map<string, Promise<KnowledgeProjectionCollection | undefined>>();
  private readonly projectionCollectionCache = new Map<string, { expiresAt: number; collection: KnowledgeProjectionCollection }>();
  private readonly broadProjectionCollectionCache = new Map<string, { expiresAt: number; collection: KnowledgeProjectionCollection }>();
  private activeProjectionWorkers = 0;
  private readonly projectionWorkerQueue: Array<() => void> = [];
  private projectionModulesPromise: Promise<ProjectionModules> | undefined;

  constructor(private readonly dataRoot = getLanguageDataRoot(), private readonly profilePath = path.resolve(dataRoot, '..')) {}

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
        ...(graph.relationDirections ? { direction: graph.relationDirections[edge] as 1 | 2 | 3 } : {}),
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

  private async captureProjectionSnapshot(language: string, loaded: LoadedGraph, requestedThresholds?: EffectiveThresholds): Promise<ProjectionSnapshot> {
    const { flashcards, journal, settings: settingsModule } = await this.projectionModules();
    const { loadFlashcards } = flashcards;
    const store = await loadFlashcards();
    const revision = {
      packageRevision: languagePackageRevision(this.dataRoot, language),
      journalSequence: journal.getKnowledgeSequence(),
      libraryRevision: store.rev ?? 0,
    };
    const meta = store.meta;
    const policy: RetentionPolicy = {
      learningSteps: [...meta.learningSteps],
      relearnSteps: [...meta.relearnSteps],
      graduatingInterval: meta.graduatingInterval,
      easyInterval: meta.easyInterval,
      reviewIntervalModifier: meta.reviewIntervalModifier,
      maxInterval: meta.maxInterval,
    };
    const thresholds = requestedThresholds ?? effectiveThresholds(settingsModule.loadSettings());
    const languageData = Object.prototype.hasOwnProperty.call(settingsModule, 'loadLangData')
      ? this.projectionLanguageData(loaded, settingsModule.loadLangData)
      : undefined;
    return { policy, thresholds, languageData, revision, ledgerId: journal.ratingLedgerId(), profilePath: this.profilePath, journal };
  }

  private async projectionFor(loaded: LoadedGraph, language: string, surfaceId: string, requestedThresholds?: EffectiveThresholds, snapshot?: ProjectionSnapshot): Promise<KnowledgeProjection | undefined> {
    const context = snapshot ?? await this.captureProjectionSnapshot(language, loaded, requestedThresholds);
    if (loaded.revision !== context.revision.packageRevision || loaded.revision !== languagePackageRevision(this.dataRoot, language)) return undefined;
    const plain = this.toLingualGraph(loaded);
    // Graph-relative addressing: evidence recorded through an authoritative
    // variant surface resolves to the shared lexical object, so the
    // projection consults sibling journal keys (never copies state).
    const keys = siblingJournalKeys(plain, surfaceId);
    const { policy, thresholds, languageData } = context;
    const targetIds = projectionEntityIds(plain, surfaceId);
    const addressIds = new Set([surfaceId, ...targetIds]);
    // Resolve the same package-authorized paths used by prediction. Source
    // journals and identity variants are only inputs, never copied mastery.
    for (const id of targetIds) keys.push(journalKeyOfSurfaceEntity(id));
    const targets = learnableTargetsFor(plain, [...targetIds].flatMap(id => {
      const entity = plain.nodes.get(id);
      return entity ? [entity] : [];
    }));
    for (const target of targets) {
      for (const source of resolveSupportSources(plain, target, languageData)) {
        addressIds.add(source.target.entityId);
        keys.push(...siblingJournalKeys(plain, source.target.entityId));
        for (const entry of lexicalContextEntryIds(plain, source.target.entityId)) {
          addressIds.add(entry);
          for (const variant of surfacesRealizingEntry(plain, entry)) { addressIds.add(variant); keys.push(journalKeyOfSurfaceEntity(variant)); }
        }
      }
    }
    keys.push(...context.journal.getAddressedKnowledgeKeys(language, [...addressIds]));
    const distinctKeys = [...new Set(keys)];
    const rowLog = context.journal.getKnowledgeRows(distinctKeys);
    const rows = distinctKeys.flatMap((key) => (rowLog[key] ?? []).map(row => ({ ...row, event: scopeSiblingEvent(row.event, key, keys[0]) })));
    const archives = context.journal.getKnowledgeArchives(distinctKeys)
      .map(({ key, archive }) => archive ? scopeSiblingArchive(archive, key, keys[0]) : undefined)
      .filter((archive): archive is NonNullable<typeof archive> => archive !== undefined);
    const compoundAnalysis = attestedCompoundAnalysis(plain, surfaceId);
    const projection = buildKnowledgeProjection(plain, surfaceId, rows, policy, undefined, undefined, { archives, thresholds, languageData });
    return { ...projection, surfaceKnown: loaded.graph.has(surfaceId), compoundAnalysis };
  }

  private async withProjectionWorker<T>(requestId: string, work: () => Promise<T>): Promise<T> {
    if (this.activeProjectionWorkers >= MAX_ACTIVE_PROJECTION_WORKERS) {
      await new Promise<void>(resolve => this.projectionWorkerQueue.push(resolve));
    }
    this.activeProjectionWorkers += 1;
    log.debug(`projection worker started request=${requestId} activeWorkers=${this.activeProjectionWorkers}`);
    try {
      return await work();
    } finally {
      this.activeProjectionWorkers -= 1;
      log.debug(`projection worker finished request=${requestId} activeWorkers=${this.activeProjectionWorkers}`);
      this.projectionWorkerQueue.shift()?.();
    }
  }

  private async projectionSnapshotIsCurrent(language: string, snapshot: ProjectionSnapshot): Promise<boolean> {
    const { flashcards, journal: currentJournal } = await this.projectionModules();
    const { loadFlashcards } = flashcards;
    const store = await loadFlashcards();
    const meta = store.meta;
    const policy: RetentionPolicy = {
      learningSteps: [...meta.learningSteps],
      relearnSteps: [...meta.relearnSteps],
      graduatingInterval: meta.graduatingInterval,
      easyInterval: meta.easyInterval,
      reviewIntervalModifier: meta.reviewIntervalModifier,
      maxInterval: meta.maxInterval,
    };
    return snapshot.profilePath === this.profilePath
      && snapshot.revision.packageRevision === languagePackageRevision(this.dataRoot, language)
      && snapshot.revision.journalSequence === currentJournal.getKnowledgeSequence()
      && snapshot.ledgerId === currentJournal.ratingLedgerId()
      && snapshot.revision.libraryRevision === (store.rev ?? 0)
      && JSON.stringify(snapshot.policy) === JSON.stringify(policy);
  }

  private projectionModules(): Promise<ProjectionModules> {
    this.projectionModulesPromise ??= Promise.all([
      import('./flashcardStorage'),
      import('./knowledgeEvents'),
      import('./settings'),
    ]).then(([flashcards, journal, settings]) => ({ flashcards, journal, settings }));
    return this.projectionModulesPromise;
  }

  private projectionCollectionKey(
    language: string,
    surfaces: readonly string[],
    evidenceKeys: readonly string[] | undefined,
    snapshot: ProjectionSnapshot,
  ): string {
    return JSON.stringify([
      snapshot.profilePath,
      language,
      snapshot.ledgerId,
      snapshot.revision,
      snapshot.policy,
      snapshot.thresholds,
      [...new Set(surfaces)].sort(),
      evidenceKeys === undefined ? undefined : [...new Set(evidenceKeys)].sort(),
    ]);
  }

  private projectionCollectionCacheFor(requestedSurfaceCount: number): Map<string, { expiresAt: number; collection: KnowledgeProjectionCollection }> {
    return requestedSurfaceCount > PROJECTION_COLLECTION_BROAD_QUERY_THRESHOLD
      ? this.broadProjectionCollectionCache
      : this.projectionCollectionCache;
  }

  private cacheProjectionCollection(key: string, collection: KnowledgeProjectionCollection, requestedSurfaceCount: number): void {
    const cache = this.projectionCollectionCacheFor(requestedSurfaceCount);
    cache.delete(key);
    cache.set(key, { expiresAt: Date.now() + PROJECTION_COLLECTION_CACHE_TTL_MS, collection });
    const maxSize = cache === this.broadProjectionCollectionCache
      ? PROJECTION_COLLECTION_BROAD_CACHE_SIZE
      : PROJECTION_COLLECTION_CACHE_SIZE;
    while (cache.size > maxSize) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  private orderProjectionCollection(collection: KnowledgeProjectionCollection, requested: readonly string[]): KnowledgeProjectionCollection {
    const keys = Object.keys(collection.projections);
    const ordered = [...new Set(requested)].filter(surface => Object.prototype.hasOwnProperty.call(collection.projections, surface));
    if (keys.length === ordered.length && keys.every((surface, index) => surface === ordered[index])) return collection;
    return { ...collection, projections: Object.fromEntries(ordered.map(surface => [surface, collection.projections[surface]])) };
  }

  private async buildProjectionCollection(
    language: string,
    requested: readonly string[],
    evidenceKeys: readonly string[] | undefined,
    loaded: LoadedGraph,
    graphStatus: 'ready' | 'not-installed',
    snapshot: ProjectionSnapshot,
    requestId: string,
  ): Promise<KnowledgeProjectionCollection | undefined> {
    const startedAt = Date.now();
    const selected = evidenceKeys === undefined
      ? [...requested]
      : await this.getEvidenceLinkedSurfaces(language, requested, evidenceKeys);
    const linked = new Set(selected);
    const surfaces = [...new Set(requested)].filter(surface => linked.has(surface));
    const projections = new Map<string, KnowledgeProjection>();
    let cursor = 0;
    let unstable = false;
    const worker = async () => {
      let completed = 0;
      while (cursor < surfaces.length && !unstable) {
        const surface = surfaces[cursor++];
        const hash = crypto.createHash('sha256').update(surface).digest('hex');
        const surfaceId = `${language}:surface:${hash}`;
        try {
          const projection = await this.withProjectionWorker(requestId, () => this.projectionFor(loaded, language, surfaceId, snapshot.thresholds, snapshot));
          if (!projection) { unstable = true; return; }
          projections.set(surface, { ...projection, querySurface: surface, graphStatus });
        } catch {
          projections.set(surface, { status: 'error', targets: [], querySurface: surface, graphStatus });
        }
        completed += 1;
        if (completed === MAX_ACTIVE_PROJECTION_WORKERS) {
          completed = 0;
          await new Promise<void>(resolve => setImmediate(resolve));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_ACTIVE_PROJECTION_WORKERS, surfaces.length) }, worker));
    if (unstable || !(await this.projectionSnapshotIsCurrent(language, snapshot))) {
      const reason = unstable ? 'package-revision-changed-during-projection' : 'snapshot-revision-changed';
      log.debug(`projection collection discarded request=${requestId} reason=${reason} surfaces=${surfaces.length} durationMs=${Date.now() - startedAt}`);
      return undefined;
    }
    const collection: KnowledgeProjectionCollection = {
      projections: Object.fromEntries(surfaces.map(surface => [surface, projections.get(surface)!])),
      revision: snapshot.revision,
    };
    log.debug(`projection collection finished request=${requestId} surfaces=${surfaces.length} durationMs=${Date.now() - startedAt}`);
    return collection;
  }

  async getKnowledgeProjectionCollection(
    language: string,
    requestedSurfaces: readonly string[],
    evidenceKeys?: readonly string[],
    requestedThresholds?: EffectiveThresholds,
  ): Promise<KnowledgeProjectionCollection> {
    const requested = [...new Set(requestedSurfaces)];
    for (let attempt = 0; attempt < PROJECTION_REVISION_ATTEMPTS; attempt += 1) {
      const installed = await this.ensure(language);
      const packageRevision = languagePackageRevision(this.dataRoot, language);
      const loaded: LoadedGraph = installed ?? {
        language,
        revision: packageRevision,
        relationCount: 0,
        graph: decodeCompact(encodeCompact({ schemaVersion: 1, language, generatedAt: '', sourceVersions: {}, entities: [], relations: [] })),
      };
      const snapshot = await this.captureProjectionSnapshot(language, loaded, requestedThresholds);
      if (loaded.revision !== snapshot.revision.packageRevision) continue;
      const key = this.projectionCollectionKey(language, requested, evidenceKeys, snapshot);
      const requestId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
      const cache = this.projectionCollectionCacheFor(requested.length);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        cache.delete(key);
        cache.set(key, cached);
        log.debug(`projection collection cache-hit request=${requestId} surfaces=${Object.keys(cached.collection.projections).length}`);
        return this.orderProjectionCollection(cached.collection, requested);
      }
      if (cached) cache.delete(key);
      const existing = this.inFlightProjectionCollections.get(key);
      if (existing) {
        log.debug(`projection collection joined request=${requestId} surfaces=${requested.length}`);
        const result = await existing;
        if (result) return this.orderProjectionCollection(result, requested);
        continue;
      }
      log.debug(`projection collection started request=${requestId} revisions=${snapshot.revision.packageRevision}:${snapshot.revision.journalSequence}:${snapshot.revision.libraryRevision} surfaces=${requested.length} evidenceKeys=${evidenceKeys?.length ?? 0}`);
      const work = this.buildProjectionCollection(language, requested, evidenceKeys, loaded, installed ? 'ready' : 'not-installed', snapshot, requestId);
      this.inFlightProjectionCollections.set(key, work);
      try {
        const result = await work;
        if (result) {
          if (Object.values(result.projections).every(projection => projection.status !== 'error')) this.cacheProjectionCollection(key, result, requested.length);
          log.debug(`projection collection published request=${requestId} surfaces=${Object.keys(result.projections).length}`);
          return result;
        }
      } finally {
        if (this.inFlightProjectionCollections.get(key) === work) this.inFlightProjectionCollections.delete(key);
      }
    }
    const failed: Record<string, KnowledgeProjection> = Object.fromEntries(requested.map(surface => [surface, { status: 'error', targets: [], querySurface: surface }]));
    return { projections: failed };
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
    const { getAddressedKnowledgeIds } = await import('./knowledgeEvents');
    const revision = languagePackageRevision(this.dataRoot, language);
    const loaded = await this.ensure(language);
    if (revision !== languagePackageRevision(this.dataRoot, language)) return this.getEvidenceLinkedSurfaces(language, surfaces, evidenceKeys);
    const addressed = new Set(getAddressedKnowledgeIds(evidenceKeys));
    // Without structure, only canonical keys and exact authored addresses can link.
    if (!loaded) {
      const keys = new Set(evidenceKeys);
      return [...new Set(surfaces)].filter(surface => {
        const hash = crypto.createHash('sha256').update(surface).digest('hex');
        return keys.has(`${language}:${hash}`) || addressed.has(`${language}:surface:${hash}`);
      });
    }
    const graph = this.toLingualGraph(loaded);
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
    for (const id of [...addressed]) {
      if (!graph.nodes.has(id)) continue;
      for (const entry of realizedEntryIds(graph, id)) for (const sibling of surfacesRealizingEntry(graph, entry)) addressed.add(sibling);
    }
    return [...new Set(surfaces)].filter((surface) =>
      addressed.has(`${language}:surface:${crypto.createHash('sha256').update(surface).digest('hex')}`));
  }

  async getKnowledgeProjection(language: string, surface: string, requestedThresholds?: EffectiveThresholds): Promise<KnowledgeProjection> {
    try {
      return (await this.getKnowledgeProjectionCollection(language, [surface], undefined, requestedThresholds)).projections[surface]
        ?? { status: 'error', targets: [], querySurface: surface };
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
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_GET_PROJECTION_COLLECTION, (_event, language: string, surfaces: string[], evidenceKeys?: string[], thresholds?: EffectiveThresholds) => service.getKnowledgeProjectionCollection(language, surfaces, evidenceKeys, thresholds));
}
