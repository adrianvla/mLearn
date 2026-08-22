#!/usr/bin/env node
// bench-graph.mjs — benchmark graph parse + index build + lookups
// ponytail: inlined loader duplication is bench-only, production stays in load.ts

import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { statSync } from 'node:fs';

const GRAPH_DIR = 'scripts/language-data/source/root-of-app/languages';
const LANGUAGES = ['ja', 'ru']; // de optional — add if time permits
const LOOKUPS = 200_000;
const ADJ_SCANS = 50_000;

const RELATION_CATEGORY = {
  'inflection-of': 'identity',
  'lemma-of': 'identity',
  realizes: 'property',
  'has-sense': 'property',
  'has-pronunciation': 'property',
  'has-gender': 'property',
  'has-prosodic-pattern': 'property',
  'has-character': 'property',
  'has-reading': 'property',
  'has-morpheme': 'property',
  'orthographic-variant-of': 'support',
  'component-of': 'support',
  'derived-from': 'support',
  'semantically-related': 'support',
  'morphologically-related': 'support',
};

function loadLinguisticGraph(asset) {
  const nodes = new Map();
  for (const entity of asset.entities) {
    nodes.set(entity.id, entity);
  }
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
  let next = 0;
  for (const id of nodes.keys()) {
    denseOf.set(id, next);
    persistentOf.push(id);
    next += 1;
  }
  return { asset, nodes, outgoing, incoming, denseOf, persistentOf };
}

function relationsOf(graph, id, opts) {
  const direction = (opts && opts.direction) || 'both';
  const collected = [];
  const push = (relations) => {
    if (!relations) return;
    for (const relation of relations) {
      if (opts && opts.category && RELATION_CATEGORY[relation.type] !== opts.category) continue;
      collected.push(relation);
    }
  };
  if (direction === 'out' || direction === 'both') push(graph.outgoing.get(id));
  if (direction === 'in' || direction === 'both') push(graph.incoming.get(id));
  return collected;
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function benchLang(lang) {
  const path = `${GRAPH_DIR}/${lang}.graph.json`;
  const fileMB = (statSync(path).size / 1024 / 1024).toFixed(1);

  // --- parse ---
  const rssBeforeParse = process.memoryUsage().rss;
  const raw = readFileSync(path, 'utf8');
  const t0 = performance.now();
  const asset = JSON.parse(raw);
  const parseMs = (performance.now() - t0).toFixed(1);

  // --- index build ---
  const rssBeforeIndex = process.memoryUsage().rss;
  const t1 = performance.now();
  const graph = loadLinguisticGraph(asset);
  const indexMs = (performance.now() - t1).toFixed(1);
  const rssAfterIndex = process.memoryUsage().rss;
  const rssDeltaMB = ((rssAfterIndex - rssBeforeParse) / 1024 / 1024).toFixed(1);

  const nodeIds = graph.persistentOf;

  // --- random lookups ---
  const sampleIds = [];
  for (let i = 0; i < LOOKUPS; i++) {
    sampleIds.push(nodeIds[Math.floor(Math.random() * nodeIds.length)]);
  }
  const lookupTimes = [];
  const t2 = performance.now();
  for (const id of sampleIds) {
    const t = performance.now();
    graph.nodes.get(id);
    lookupTimes.push((performance.now() - t) * 1000); // µs
  }
  const lookupTotal = (performance.now() - t2).toFixed(1);
  lookupTimes.sort((a, b) => a - b);
  const lookupP50 = percentile(lookupTimes, 50).toFixed(3);
  const lookupP99 = percentile(lookupTimes, 99).toFixed(3);

  // --- adjacency scans (relationsOf both, no category filter) ---
  const adjSampleIds = [];
  for (let i = 0; i < ADJ_SCANS; i++) {
    adjSampleIds.push(nodeIds[Math.floor(Math.random() * nodeIds.length)]);
  }
  const t3 = performance.now();
  let adjHits = 0;
  for (const id of adjSampleIds) {
    adjHits += relationsOf(graph, id).length;
  }
  const adjacencyMs = (performance.now() - t3).toFixed(1);

  return {
    lang,
    fileMB,
    parseMs,
    indexMs,
    rssDeltaMB,
    nodeCount: asset.entities.length,
    relationCount: asset.relations.length,
    lookupP50,
    lookupP99,
    lookupTotalMs: lookupTotal,
    adjacencyMs,
    adjHits,
  };
}

// --- run ---
console.log('bench-graph.mjs — starting\n');
const results = [];
for (const lang of LANGUAGES) {
  console.log(`bench: ${lang}...`);
  try {
    results.push(benchLang(lang));
  } catch (e) {
    console.error(`bench: ${lang} FAILED:`, e.message);
  }
}

// --- output table ---
const hdr = 'lang | fileMB | parseMs | indexMs | rssDeltaMB | entities | relations | lookupP50µs | lookupP99µs | adjScansMs';
const sep = '-'.repeat(hdr.length);
const lines = [hdr, sep];
for (const r of results) {
  lines.push(
    `${r.lang} | ${r.fileMB} | ${r.parseMs} | ${r.indexMs} | ${r.rssDeltaMB} | ${r.nodeCount} | ${r.relationCount} | ${r.lookupP50} | ${r.lookupP99} | ${r.adjacencyMs}`
  );
}

const output = lines.join('\n');
console.log('\n' + output);

// save to file
writeFileSync('scripts/bench-graph.results.txt', output + '\n', 'utf8');
console.log('\nSaved to scripts/bench-graph.results.txt');
