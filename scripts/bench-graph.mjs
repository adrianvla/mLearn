#!/usr/bin/env node
// bench-graph.mjs — benchmark graph parse + index build + compact runtime
// ponytail: inlined loader/compact duplication is bench-only, production stays in src/shared/graph.

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const GRAPH_DIR = 'scripts/language-data/source/root-of-app/languages';
const LANGUAGES = ['ja', 'ru'];
const LOOKUPS = 200_000;
const ADJ_SCANS = 50_000;
const COMPACT = process.argv.includes('--compact');
const COMPACT_CHILD_PATH = process.argv.find((arg) => arg.startsWith('--compact-child='))?.slice('--compact-child='.length);

const RELATION_CATEGORY = {
  'inflection-of': 'identity', 'lemma-of': 'identity', realizes: 'property', 'has-sense': 'property',
  'has-pronunciation': 'property', 'has-gender': 'property', 'has-prosodic-pattern': 'property',
  'has-character': 'property', 'has-reading': 'property', 'has-morpheme': 'property',
  'orthographic-variant-of': 'support', 'component-of': 'support', 'derived-from': 'support',
  'semantically-related': 'support', 'morphologically-related': 'support',
};
const ENTITY_KINDS = ['dictionary-entry', 'lexeme', 'surface', 'sense', 'pronunciation', 'character', 'morpheme', 'grammar-pattern'];
const RELATION_TYPES = Object.keys(RELATION_CATEGORY);
const KIND_IDS = new Map(ENTITY_KINDS.map((value, index) => [value, index]));
const TYPE_IDS = new Map(RELATION_TYPES.map((value, index) => [value, index]));
const DOMAIN_IDS = new Map([[undefined, 0], ['common', 1], ['names', 2], ['archaic', 3], ['technical', 4], ['dialectal', 5]]);
const TYPE_CATEGORIES = RELATION_TYPES.map((type) => RELATION_CATEGORY[type]);

function loadLinguisticGraph(asset) {
  const nodes = new Map();
  for (const entity of asset.entities) nodes.set(entity.id, entity);
  const outgoing = new Map();
  const incoming = new Map();
  for (const relation of asset.relations) {
    const out = outgoing.get(relation.from);
    if (out) out.push(relation); else outgoing.set(relation.from, [relation]);
    const inc = incoming.get(relation.to);
    if (inc) inc.push(relation); else incoming.set(relation.to, [relation]);
  }
  const denseOf = new Map();
  const persistentOf = [];
  for (const id of nodes.keys()) {
    denseOf.set(id, persistentOf.length);
    persistentOf.push(id);
  }
  return { nodes, outgoing, incoming, denseOf, persistentOf };
}

function relationsOf(graph, id) {
  return [...(graph.outgoing.get(id) ?? []), ...(graph.incoming.get(id) ?? [])];
}

function encodeCompact(asset) {
  const stringTable = [];
  const stringIds = new Map();
  const stringId = (value) => {
    let id = stringIds.get(value);
    if (id === undefined) {
      id = stringTable.length;
      stringTable.push(value);
      stringIds.set(value, id);
    }
    return id;
  };
  const entityIds = new Map();
  for (const entity of asset.entities) {
    entityIds.set(entity.id, entityIds.size);
    stringId(entity.id);
  }
  const kindIds = [];
  const domainIds = [];
  const labelStringIds = [];
  const surfaceHashStringIds = [];
  const surfaceLocalIds = [];
  const prefix = `${asset.language}:surface:`;
  for (const entity of asset.entities) {
    const dense = entityIds.get(entity.id);
    kindIds.push(KIND_IDS.get(entity.kind));
    domainIds.push(DOMAIN_IDS.get(entity.domain));
    labelStringIds.push(entity.label === undefined ? -1 : stringId(entity.label));
    if (entity.id.startsWith(prefix)) {
      surfaceHashStringIds.push(stringId(entity.id.slice(prefix.length)));
      surfaceLocalIds.push(dense);
    }
  }
  const adjacency = Array.from({ length: kindIds.length }, () => []);
  for (const relation of asset.relations) {
    const edge = {
      target: entityIds.get(relation.to), type: TYPE_IDS.get(relation.type), confidence: relation.confidence,
      transparency: relation.transparency, predictability: relation.predictability,
      provenance: relation.provenance === undefined ? undefined : stringId(relation.provenance),
    };
    adjacency[entityIds.get(relation.from)].push(edge);
    adjacency[entityIds.get(relation.to)].push({ ...edge, target: entityIds.get(relation.from) });
  }
  const offsets = [0];
  const targets = [];
  const typeIds = [];
  const confidence = [];
  const transparency = [];
  const predictability = [];
  const provenanceStringIds = [];
  let hasConfidence = false;
  let hasTransparency = false;
  let hasPredictability = false;
  let hasProvenance = false;
  for (const edges of adjacency) {
    for (const edge of edges) {
      targets.push(edge.target);
      typeIds.push(edge.type);
      confidence.push(edge.confidence ?? -1);
      transparency.push(edge.transparency ?? -1);
      predictability.push(edge.predictability ?? -1);
      provenanceStringIds.push(edge.provenance ?? -1);
      hasConfidence ||= edge.confidence !== undefined;
      hasTransparency ||= edge.transparency !== undefined;
      hasPredictability ||= edge.predictability !== undefined;
      hasProvenance ||= edge.provenance !== undefined;
    }
    offsets.push(targets.length);
  }
  return {
    schemaVersion: 1, language: asset.language, generatedAt: asset.generatedAt, sourceVersions: asset.sourceVersions, stringTable,
    entities: { kindIds, domainIds, labelStringIds },
    relations: {
      offsets, targets, typeIds,
      ...(hasConfidence ? { confidence } : {}), ...(hasTransparency ? { transparency } : {}),
      ...(hasPredictability ? { predictability } : {}), ...(hasProvenance ? { provenanceStringIds } : {}),
    },
    meta: { surfaceHashStringIds, surfaceLocalIds },
  };
}

function decodeCompact(compact) {
  const stringTable = compact.stringTable;
  const kindIds = Uint8Array.from(compact.entities.kindIds);
  const domainIds = Uint8Array.from(compact.entities.domainIds);
  const labelStringIds = Int32Array.from(compact.entities.labelStringIds);
  const offsets = Uint32Array.from(compact.relations.offsets);
  const targets = Uint32Array.from(compact.relations.targets);
  const typeIds = Uint8Array.from(compact.relations.typeIds);
  const confidence = compact.relations.confidence === undefined ? undefined : Float32Array.from(compact.relations.confidence);
  const transparency = compact.relations.transparency === undefined ? undefined : Float32Array.from(compact.relations.transparency);
  const predictability = compact.relations.predictability === undefined ? undefined : Float32Array.from(compact.relations.predictability);
  const provenanceStringIds = compact.relations.provenanceStringIds === undefined ? undefined : Int32Array.from(compact.relations.provenanceStringIds);
  const persistentOf = stringTable.slice(0, kindIds.length);
  const denseOf = new Map(persistentOf.map((id, dense) => [id, dense]));
  return {
    stringTable, kindIds, domainIds, labelStringIds, offsets, targets, typeIds, confidence, transparency, predictability, provenanceStringIds, persistentOf,
    has: (id) => denseOf.has(id),
    neighborsByCategory(id, category) {
      const dense = denseOf.get(id);
      if (dense === undefined) return [];
      const neighbors = [];
      for (let edge = offsets[dense]; edge < offsets[dense + 1]; edge += 1) {
        if (TYPE_CATEGORIES[typeIds[edge]] === category) neighbors.push(persistentOf[targets[edge]]);
      }
      return neighbors;
    },
  };
}

function percentile(sorted, p) {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function measuredLookups(nodeIds, lookup) {
  const sampleIds = Array.from({ length: LOOKUPS }, () => nodeIds[Math.floor(Math.random() * nodeIds.length)]);
  const times = [];
  for (const id of sampleIds) {
    const t = performance.now();
    lookup(id);
    times.push((performance.now() - t) * 1000);
  }
  times.sort((a, b) => a - b);
  return { lookupP50: percentile(times, 50).toFixed(3), lookupP99: percentile(times, 99).toFixed(3) };
}

function benchLang(lang) {
  const path = `${GRAPH_DIR}/${lang}.graph.json`;
  const fileMB = (statSync(path).size / 1024 / 1024).toFixed(1);
  const rssBefore = process.memoryUsage().rss;
  const raw = readFileSync(path, 'utf8');
  const t0 = performance.now();
  const asset = JSON.parse(raw);
  const parseMs = (performance.now() - t0).toFixed(1);
  const t1 = performance.now();
  const graph = loadLinguisticGraph(asset);
  const indexMs = (performance.now() - t1).toFixed(1);
  const lookup = measuredLookups(graph.persistentOf, (id) => graph.nodes.get(id));
  const sample = Array.from({ length: ADJ_SCANS }, () => graph.persistentOf[Math.floor(Math.random() * graph.persistentOf.length)]);
  const t2 = performance.now();
  let adjHits = 0;
  for (const id of sample) adjHits += relationsOf(graph, id).length;
  return { lang, fileMB, parseMs, indexMs, rssDeltaMB: ((process.memoryUsage().rss - rssBefore) / 1024 / 1024).toFixed(1), nodeCount: asset.entities.length, relationCount: asset.relations.length, ...lookup, adjacencyMs: (performance.now() - t2).toFixed(1), adjHits };
}

function benchCompactLang(lang) {
  const path = `${GRAPH_DIR}/${lang}.graph.json`;
  const asset = JSON.parse(readFileSync(path, 'utf8'));
  const encoded = JSON.stringify(encodeCompact(asset));
  const encodedMB = (Buffer.byteLength(encoded) / 1024 / 1024).toFixed(1);
  const gzipMB = (gzipSync(encoded).byteLength / 1024 / 1024).toFixed(1);
  const nodeCount = asset.entities.length;
  const relationCount = asset.relations.length;
  const directory = mkdtempSync(join(tmpdir(), 'mlearn-compact-'));
  const compactPath = join(directory, `${lang}.compact.json`);
  writeFileSync(compactPath, encoded);
  const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1], `--compact-child=${compactPath}`], { encoding: 'utf8' });
  rmSync(directory, { recursive: true, force: true });
  if (child.status !== 0) throw new Error(child.stderr || `compact child exited ${child.status}`);
  return { lang, encodedMB, gzipMB, nodeCount, relationCount, ...JSON.parse(child.stdout) };
}

function benchCompactChild(path) {
  global.gc?.();
  const rssBefore = process.memoryUsage().rss;
  let encoded = readFileSync(path, 'utf8');
  const t0 = performance.now();
  let compact = JSON.parse(encoded);
  const decodeMs = (performance.now() - t0).toFixed(1);
  encoded = null;
  global.gc?.();
  const t1 = performance.now();
  const graph = decodeCompact(compact);
  const indexMs = (performance.now() - t1).toFixed(1);
  compact = null;
  global.gc?.();
  const lookup = measuredLookups(graph.persistentOf, (id) => graph.has(id));
  const sample = Array.from({ length: ADJ_SCANS }, () => graph.persistentOf[Math.floor(Math.random() * graph.persistentOf.length)]);
  const t2 = performance.now();
  let adjHits = 0;
  for (const id of sample) adjHits += graph.neighborsByCategory(id, 'identity').length;
  return { decodeMs, indexMs, steadyRssDeltaMB: ((process.memoryUsage().rss - rssBefore) / 1024 / 1024).toFixed(1), ...lookup, adjacencyMs: (performance.now() - t2).toFixed(1), adjHits };
}

if (COMPACT_CHILD_PATH) {
  process.stdout.write(JSON.stringify(benchCompactChild(COMPACT_CHILD_PATH)));
  process.exit(0);
}

const results = [];
for (const lang of LANGUAGES) {
  console.log(`bench: ${lang}...`);
  results.push(COMPACT ? benchCompactLang(lang) : benchLang(lang));
}
const header = COMPACT
  ? 'lang | encodedMB | gzipMB | decodeMs | indexMs | steadyRssDeltaMB | entities | relations | lookupP50µs | lookupP99µs | adjScansMs'
  : 'lang | fileMB | parseMs | indexMs | rssDeltaMB | entities | relations | lookupP50µs | lookupP99µs | adjScansMs';
const output = [header, '-'.repeat(header.length), ...results.map((r) => COMPACT
  ? `${r.lang} | ${r.encodedMB} | ${r.gzipMB} | ${r.decodeMs} | ${r.indexMs} | ${r.steadyRssDeltaMB} | ${r.nodeCount} | ${r.relationCount} | ${r.lookupP50} | ${r.lookupP99} | ${r.adjacencyMs}`
  : `${r.lang} | ${r.fileMB} | ${r.parseMs} | ${r.indexMs} | ${r.rssDeltaMB} | ${r.nodeCount} | ${r.relationCount} | ${r.lookupP50} | ${r.lookupP99} | ${r.adjacencyMs}`)].join('\n');
console.log(`\n${COMPACT ? 'COMPACT\n' : ''}${output}`);
const resultPath = 'scripts/bench-graph.results.txt';
const baseline = COMPACT ? readFileSync(resultPath, 'utf8').split('\n\nCOMPACT\n')[0].trimEnd() : '';
writeFileSync(resultPath, COMPACT ? `${baseline}\n\nCOMPACT\n${output}\n` : `${output}\n`, 'utf8');
console.log(`\nSaved to ${resultPath}`);
