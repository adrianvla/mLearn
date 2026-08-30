#!/usr/bin/env node
// bench-journal.mjs — REQ57 performance measurements for the evidence journal
// and Word DB neighborhood queries (graph ops live in bench-graph.mjs).
//
// ponytail: the replay fold below mirrors src/shared/utils/projectionReplay.ts
// (bench-only duplication, mirrored 2026-08-30 against knowledgeEvents.ts +
// knowledgeStrength.ts: Rating strings, EvidenceSource union, `retracts`
// tombstones, t-sorted last-outcome ease fold, EXPLICIT_STATUS_SOURCES) so this
// runs as plain node without a TS toolchain. If replay semantics change,
// refresh the mirror before re-benchmarking.
//
// Usage: node scripts/bench-journal.mjs [--lang=de] [--keys=50000] [--json]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const LANG = opt('lang', 'de');
const KEYS = Number(opt('keys', 50_000));

// src/shared/constants.ts — SRS ease scale anchors.
const SRS_EASE = { MIN: 1.3, DEFAULT_LEARNING: 1.55, DEFAULT_KNOWN: 1.8 };

// src/shared/utils/projectionReplay.ts
const EXPLICIT_STATUS_SOURCES = new Set(['manual', 'srs', 'anki', 'migration']);

// src/shared/knowledgeEvents.ts — Rating; src/shared/constants.ts — AttemptQuality.
const RATINGS = ['again', 'hard', 'good', 'easy'];
const ATTEMPT_QUALITIES = ['missed', 'struggled', 'fluent'];

// src/shared/utils/knowledgeStrength.ts mirrors.
function normalizeEvidenceEase(source, ease) {
  return source === 'anki' && ease >= 1000 ? ease / 1000 : ease;
}
function statusToEase(status) {
  if (status === 'known') return SRS_EASE.DEFAULT_KNOWN;
  if (status === 'learning') return SRS_EASE.DEFAULT_LEARNING;
  return SRS_EASE.MIN;
}

// ---------------------------------------------------------------------------
// 1. Synthetic-but-schema-faithful journal
// ---------------------------------------------------------------------------
function makeJournal() {
  const journal = new Map();
  let attemptSeq = 0;
  let t = Date.now() - 1000 * 60 * 60 * 24 * 90; // 90 days of history
  for (let k = 0; k < KEYS; k++) {
    const lk = `ja:${String(k).padStart(64, '0')}`;
    const events = [];
    const n = 3 + Math.floor(Math.random() * 12);
    for (let e = 0; e < n; e++) {
      t += 1000 * 60 * 17; // ~17 min apart
      const roll = Math.random();
      if (roll < 0.5) {
        // Attempt rating (RatingMatrix route): quality + attemptId; the ease
        // outcome rides on rating rows only when the writer recorded one.
        const attemptId = `a${attemptSeq++}`;
        events.push({
          t, kind: 'rating', source: 'manual',
          aspect: 'meaning', quality: ATTEMPT_QUALITIES[(Math.random() * ATTEMPT_QUALITIES.length) | 0],
          attemptId, presentedSurface: '食べた', latencyMs: 900 + Math.random() * 2500,
        });
      } else if (roll < 0.72) {
        events.push({
          t, kind: 'review', source: 'srs', aspect: 'meaning',
          rating: RATINGS[(Math.random() * RATINGS.length) | 0],
          easeBefore: 1.3 + Math.random() * 0.6, easeAfter: 1.3 + Math.random() * 0.9,
          intervalBefore: 1, intervalAfter: 3, schedulerCardId: 'c1',
        });
      } else if (roll < 0.9) {
        events.push({
          t, kind: 'rollup', source: 'passiveTracking', aspect: 'meaning',
          easeAfter: SRS_EASE.MIN + Math.random() * 0.3, timesSeenDelta: 1 + Math.floor(Math.random() * 5),
        });
      } else if (roll < 0.96) {
        events.push({ t, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' });
      } else if (events.length > 1) {
        // Retraction tombstone: retracts the first retracted-eligible attempt.
        const victim = events.find((ev) => ev.attemptId !== undefined);
        if (victim) events.push({ t, kind: 'retraction', source: 'manual', aspect: 'meaning', retracts: victim.attemptId });
      }
    }
    journal.set(lk, events);
  }
  return journal;
}

// ---------------------------------------------------------------------------
// 2. Replay fold (mirror of projectionReplay.ts — see header)
// ---------------------------------------------------------------------------
function stripRetractions(events) {
  const retracted = new Set();
  for (const e of events) if (e.kind === 'retraction' && e.retracts !== undefined) retracted.add(`${e.retracts}`);
  if (retracted.size === 0) return events.filter((e) => e.kind !== 'retraction');
  return events.filter((e) => {
    if (e.kind === 'retraction') return false;
    return !(e.attemptId !== undefined && retracted.has(`${e.attemptId}`));
  });
}
function outcomeEase(event) {
  if (event.easeAfter !== undefined) return normalizeEvidenceEase(event.source, event.easeAfter);
  if (event.toStatus !== undefined && EXPLICIT_STATUS_SOURCES.has(event.source)) return statusToEase(event.toStatus);
  return undefined;
}
function replayKeyProjection(events) {
  const active = stripRetractions(events);
  if (active.length === 0) return null;
  const sorted = [...active].sort((a, b) => a.t - b.t);
  let ease;
  let claim;
  let timesSeen = 0;
  let timesHovered = 0;
  let hasEvidence = false;
  let hasActiveEvidence = false;
  for (const event of sorted) {
    switch (event.kind) {
      case 'claim':
        claim = event.toStatus;
        break;
      case 'rating':
      case 'status':
      case 'review':
      case 'rollup': {
        hasEvidence = true;
        if (event.source !== 'passiveTracking') hasActiveEvidence = true;
        const nextEase = outcomeEase(event);
        if (nextEase !== undefined) ease = nextEase;
        break;
      }
      case 'retraction':
        break; // stripped above
    }
    if (event.timesSeenDelta) timesSeen += event.timesSeenDelta;
    if (event.kind === 'status' && event.source === 'passiveTracking' && event.aspect === 'meaning') timesHovered++;
  }
  if (ease === undefined && claim === undefined) return null;
  return { ease: ease ?? 0, claim, timesSeen, timesHovered, hasEvidence, hasActiveEvidence };
}

// ---------------------------------------------------------------------------
// 3. Run journal benchmarks
// ---------------------------------------------------------------------------
function pct(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
const journal = makeJournal();
const totalEvents = [...journal.values()].reduce((n, evs) => n + evs.length, 0);

let t0 = performance.now();
for (const events of journal.values()) stripRetractions(events);
const stripMs = performance.now() - t0;

const perKeyUs = [];
t0 = performance.now();
let rebuilt = 0;
for (const events of journal.values()) {
  const k0 = performance.now();
  if (replayKeyProjection(events)) rebuilt++;
  perKeyUs.push((performance.now() - k0) * 1000);
}
const replayMs = performance.now() - t0;

// Append persistence cost: serialize + parse a 1k-event append the way the
// journal service round-trips JSON rows.
const appendBatch = [];
for (const events of [...journal.values()].slice(0, 200)) appendBatch.push(...events.slice(0, 5));
t0 = performance.now();
const serialized = JSON.stringify(appendBatch);
const serializeMs = performance.now() - t0;
t0 = performance.now();
JSON.parse(serialized);
const parseMs = performance.now() - t0;

// ---------------------------------------------------------------------------
// 4. Neighborhood query (depth-1 relationsOf + assembly, plain runtime shape)
// ---------------------------------------------------------------------------
const GRAPH_PATH = join('scripts', 'language-data', 'source', 'root-of-app', 'languages', `${LANG}.graph.json`);
const asset = JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));
const nodes = new Map();
const outgoing = new Map();
const incoming = new Map();
for (const entity of asset.entities) nodes.set(entity.id, entity);
for (const relation of asset.relations) {
  const out = outgoing.get(relation.from);
  if (out) out.push(relation); else outgoing.set(relation.from, [relation]);
  const inc = incoming.get(relation.to);
  if (inc) inc.push(relation); else incoming.set(relation.to, [relation]);
}
const surfaceIds = [...nodes.values()].filter((n) => n.kind === 'surface').map((n) => n.id);
const SAMPLES = Math.min(20_000, surfaceIds.length);
const neighUs = [];
t0 = performance.now();
let touched = 0;
for (let i = 0; i < SAMPLES; i++) {
  const k0 = performance.now();
  const id = surfaceIds[(Math.random() * surfaceIds.length) | 0];
  const rels = [...(outgoing.get(id) ?? []), ...(incoming.get(id) ?? [])];
  touched += rels.length;
  neighUs.push((performance.now() - k0) * 1000);
}
const neighMs = performance.now() - t0;

const result = {
  journal: {
    keys: KEYS,
    events: totalEvents,
    stripRetractionsMs: +stripMs.toFixed(1),
    replayAllKeysMs: +replayMs.toFixed(1),
    rebuiltKeys: rebuilt,
    replayP50us: +pct(perKeyUs, 0.5).toFixed(1),
    replayP99us: +pct(perKeyUs, 0.99).toFixed(1),
    append1kSerializeMs: +serializeMs.toFixed(3),
    append1kParseMs: +parseMs.toFixed(3),
  },
  neighborhood: {
    lang: LANG,
    entities: asset.entities.length,
    relations: asset.relations.length,
    sampledSurfaces: SAMPLES,
    avgDegree: +(touched / SAMPLES).toFixed(2),
    depth1QueryMs: +neighMs.toFixed(1),
    depth1P50us: +pct(neighUs, 0.5).toFixed(1),
    depth1P99us: +pct(neighUs, 0.99).toFixed(1),
    note: 'plain runtime shape (Map adjacency) — production compact CSR is faster; numbers are an upper bound',
  },
};
console.log(JSON.stringify(result, null, 2));
