#!/usr/bin/env node
// bench-graph.mjs — benchmark graph parse + index build + compact runtime
// ponytail: inlined loader/compact duplication is bench-only, production stays in src/shared/graph.

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const GRAPH_DIR = 'scripts/language-data/source/root-of-app/languages';
const LANGUAGES = ['ja', 'de', 'ru', 'zh'];
const LOOKUPS = 200_000;
// Per-lookup latency sample for p50/p99 (individual timings; kept separate
// from the throughput loop so timer overhead does not pollute it).
const LATENCY_SAMPLE = 20_000;
const ADJ_SCANS = 50_000;
const COMPACT = process.argv.includes('--compact');
const JSON_OUTPUT = process.argv.includes('--json');
const COMPACT_CHILD_PATH = process.argv.find((arg) => arg.startsWith('--compact-child='))?.slice('--compact-child='.length);
const OLD_CHILD_PATH = process.argv.find((arg) => arg.startsWith('--old-child='))?.slice('--old-child='.length);

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
  for (const entity of asset.entities) {
    const dense = entityIds.get(entity.id);
    kindIds.push(KIND_IDS.get(entity.kind));
    domainIds.push(DOMAIN_IDS.get(entity.domain));
    labelStringIds.push(entity.label === undefined ? -1 : stringId(entity.label));
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
  const denseOf = new Map();
  for (let dense = 0; dense < persistentOf.length; dense += 1) denseOf.set(persistentOf[dense], dense);
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

function measuredLookups(nodeIds, lookup) {
  const sampleIds = Array.from({ length: LOOKUPS }, () => nodeIds[Math.floor(Math.random() * nodeIds.length)]);
  const start = performance.now();
  for (const id of sampleIds) {
    lookup(id);
  }
  const ops = Math.round((LOOKUPS * 1000) / (performance.now() - start));
  // Individual-timing sample → p50/p99 in microseconds.
  const latencies = new Array(LATENCY_SAMPLE);
  for (let i = 0; i < LATENCY_SAMPLE; i += 1) {
    const id = nodeIds[Math.floor(Math.random() * nodeIds.length)];
    const t0 = performance.now();
    lookup(id);
    latencies[i] = performance.now() - t0;
  }
  latencies.sort((a, b) => a - b);
  const pct = (p) => +(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] * 1000).toFixed(2);
  return { ops, p50us: pct(0.5), p99us: pct(0.99) };
}

function memory() {
  const usage = process.memoryUsage();
  return Object.fromEntries(Object.entries(usage).map(([name, bytes]) => [name, +(bytes / 1024 / 1024).toFixed(1)]));
}

function maxRss(...snapshots) {
  return Math.max(...snapshots.map((snapshot) => snapshot.rss));
}

function benchmarkGraph(graph, lookup) {
  const { ops: lookupOps, p50us, p99us } = measuredLookups(graph.persistentOf, lookup);
  const sample = Array.from({ length: ADJ_SCANS }, () => graph.persistentOf[Math.floor(Math.random() * graph.persistentOf.length)]);
  const start = performance.now();
  let adjHits = 0;
  for (const id of sample) adjHits += graph.neighborsByCategory ? graph.neighborsByCategory(id, 'identity').length : relationsOf(graph, id).length;
  return { lookupOps, p50us, p99us, adjacencyMs: +(performance.now() - start).toFixed(1), adjHits };
}

function typedArrayBytes(graph) {
  return Object.fromEntries(Object.entries(graph).filter(([, value]) => ArrayBuffer.isView(value)).map(([name, value]) => [name, value.byteLength]));
}

function compactBreakdown(graph) {
  let stringUtf8Bytes = 0;
  let stringUtf16Bytes = 0;
  for (const value of graph.stringTable) {
    stringUtf8Bytes += Buffer.byteLength(value);
    stringUtf16Bytes += value.length * 2;
  }
  const arrays = typedArrayBytes(graph);
  return {
    stringCount: graph.stringTable.length,
    stringUtf8Bytes,
    stringUtf16Bytes,
    persistentIdCount: graph.persistentOf.length,
    denseMapEntries: graph.persistentOf.length,
    typedArrayBytes: arrays,
    totalTypedArrayBytes: Object.values(arrays).reduce((sum, bytes) => sum + bytes, 0),
  };
}

function benchOldChild(path) {
  global.gc?.();
  const baseline = memory();
  let raw = readFileSync(path, 'utf8');
  const t0 = performance.now();
  const asset = JSON.parse(raw);
  const parseMs = (performance.now() - t0).toFixed(1);
  const parsed = memory();
  raw = null;
  global.gc?.();
  const parsedGc = memory();
  const t1 = performance.now();
  const graph = loadLinguisticGraph(asset);
  const indexMs = (performance.now() - t1).toFixed(1);
  const decoded = memory();
  global.gc?.();
  const steady = memory();
  return {
    parseMs, indexMs, baseline, parsed, parsedGc, decoded, steady,
    peakRssMB: maxRss(baseline, parsed, parsedGc, decoded, steady),
    steadyRssMB: steady.rss,
    ...benchmarkGraph(graph, (id) => graph.nodes.get(id)),
  };
}

function benchCompactChild(path) {
  global.gc?.();
  const baseline = memory();
  let encoded = readFileSync(path, 'utf8');
  const t0 = performance.now();
  let compact = JSON.parse(encoded);
  const decodeMs = (performance.now() - t0).toFixed(1);
  const parsed = memory();
  encoded = null;
  global.gc?.();
  const parsedGc = memory();
  const t1 = performance.now();
  const graph = decodeCompact(compact);
  const indexMs = (performance.now() - t1).toFixed(1);
  const decoded = memory();
  const breakdown = compactBreakdown(graph);
  compact = null;
  global.gc?.();
  const steady = memory();
  return {
    decodeMs, indexMs, baseline, parsed, parsedGc, decoded, steady, breakdown,
    peakRssMB: maxRss(baseline, parsed, parsedGc, decoded, steady),
    steadyRssMB: steady.rss,
    ...benchmarkGraph(graph, (id) => graph.has(id)),
  };
}

if (COMPACT_CHILD_PATH) {
  process.stdout.write(JSON.stringify(benchCompactChild(COMPACT_CHILD_PATH)));
  process.exit(0);
}
if (OLD_CHILD_PATH) {
  process.stdout.write(JSON.stringify(benchOldChild(OLD_CHILD_PATH)));
  process.exit(0);
}

function runChild(argument) {
  const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1], argument], { encoding: 'utf8' });
  if (child.status !== 0) throw new Error(child.stderr || `graph child exited ${child.status}`);
  return JSON.parse(child.stdout);
}

function benchLang(lang) {
  const path = `${GRAPH_DIR}/${lang}.graph.json`;
  const asset = JSON.parse(readFileSync(path, 'utf8'));
  return {
    lang,
    artifactMB: +(statSync(path).size / 1024 / 1024).toFixed(1),
    gzipMB: +(gzipSync(readFileSync(path)).byteLength / 1024 / 1024).toFixed(1),
    nodeCount: asset.entities.length,
    relationCount: asset.relations.length,
    ...runChild(`--old-child=${path}`),
  };
}

function benchCompactLang(lang) {
  const path = `${GRAPH_DIR}/${lang}.graph.json`;
  const asset = JSON.parse(readFileSync(path, 'utf8'));
  const encoded = JSON.stringify(encodeCompact(asset));
  const directory = mkdtempSync(join(tmpdir(), 'mlearn-compact-'));
  const compactPath = join(directory, `${lang}.compact.json`);
  writeFileSync(compactPath, encoded);
  try {
    return {
      lang,
      artifactMB: +(Buffer.byteLength(encoded) / 1024 / 1024).toFixed(1),
      gzipMB: +(gzipSync(encoded).byteLength / 1024 / 1024).toFixed(1),
      nodeCount: asset.entities.length,
      relationCount: asset.relations.length,
      ...runChild(`--compact-child=${compactPath}`),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const results = [];
for (const lang of LANGUAGES) {
  console.log(`bench: ${lang}...`);
  results.push(COMPACT ? benchCompactLang(lang) : benchLang(lang));
}
const header = COMPACT
  ? 'lang | artifactMB | gzipMB | decodeMs | indexMs | peakRssMB | steadyRssMB | entities | relations | lookupOps/s | p50us | p99us | adjScansMs'
  : 'lang | artifactMB | gzipMB | parseMs | indexMs | peakRssMB | steadyRssMB | entities | relations | lookupOps/s | p50us | p99us | adjScansMs';
const output = [header, '-'.repeat(header.length), ...results.map((r) => COMPACT
  ? `${r.lang} | ${r.artifactMB} | ${r.gzipMB} | ${r.decodeMs} | ${r.indexMs} | ${r.peakRssMB} | ${r.steadyRssMB} | ${r.nodeCount} | ${r.relationCount} | ${r.lookupOps} | ${r.p50us} | ${r.p99us} | ${r.adjacencyMs}`
  : `${r.lang} | ${r.artifactMB} | ${r.gzipMB} | ${r.parseMs} | ${r.indexMs} | ${r.peakRssMB} | ${r.steadyRssMB} | ${r.nodeCount} | ${r.relationCount} | ${r.lookupOps} | ${r.p50us} | ${r.p99us} | ${r.adjacencyMs}`)].join('\n');
console.log(`\n${COMPACT ? 'COMPACT\n' : ''}${output}`);
if (JSON_OUTPUT) console.log(JSON.stringify(results, null, 2));
const resultPath = 'scripts/bench-graph.results.txt';
const baseline = COMPACT ? readFileSync(resultPath, 'utf8').split('\n\nCOMPACT\n')[0].trimEnd() : '';
writeFileSync(resultPath, COMPACT ? `${baseline}\n\nCOMPACT\n${output}\n` : `${output}\n`, 'utf8');
console.log(`\nSaved to ${resultPath}`);
