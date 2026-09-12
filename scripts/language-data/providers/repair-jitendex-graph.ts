/** Repair old Jitendex glossary extraction without reallocating learner targets.
 * Bundle with esbuild --bundle --platform=node --format=esm, then run with
 * --graph <installed asset> --dictionary <jitendex directory> --output <new asset>.
 * The input is never overwritten. Keep the emitted audit beside the backup.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { COMPACT_RELATION_TYPES, decodeCompact, type CompactAssetJSON } from '../../../src/shared/graph/compact';

type EntryContent = { glosses: Set<string>; badges: Map<string, Set<string>> };
const normalized = (value: string): string => value.replaceAll('*', '').normalize('NFC').replace(/\s+/gu, ' ').trim();

function collectContent(value: unknown, entry: EntryContent, glossary = false, code?: string): void {
  if (typeof value === 'string') {
    const label = normalized(value);
    if (glossary) entry.glosses.add(label);
    else if (code) {
      const codes = entry.badges.get(label) ?? new Set<string>();
      codes.add(code);
      entry.badges.set(label, codes);
    }
  } else if (Array.isArray(value)) {
    for (const child of value) collectContent(child, entry, glossary, code);
  } else if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    const data = node.data as Record<string, unknown> | undefined;
    collectContent(node.content, entry, glossary || data?.content === 'glossary', typeof data?.code === 'string' ? data.code : code);
  }
}

export function collectEntryContent(banks: Iterable<unknown[]>): Map<string, EntryContent> {
  const entries = new Map<string, EntryContent>();
  for (const rows of banks) for (const row of rows) {
    if (!Array.isArray(row) || !row[6]) continue;
    const id = `ja:entry:${row[6]}`;
    const entry = entries.get(id) ?? { glosses: new Set<string>(), badges: new Map<string, Set<string>>() };
    collectContent(row[5], entry);
    entries.set(id, entry);
  }
  return entries;
}

export function repairJitendexGraph(asset: CompactAssetJSON, entries: Map<string, EntryContent>) {
  if (asset.language !== 'ja' || !asset.sourceVersions.dictionary?.startsWith('jitendex-')) throw new Error('Expected a Jitendex graph');
  const graph = decodeCompact(asset);
  const senseType = COMPACT_RELATION_TYPES.indexOf('has-sense');
  const posType = COMPACT_RELATION_TYPES.indexOf('has-pos');
  const removedPairs = new Set<string>();
  const audit: { entryId: string; senseId: string; label: string; grammarTargetIds: string[] }[] = [];
  const pairKey = (a: number, b: number): string => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (const [entryId, content] of entries) {
    const source = graph.denseOf.get(entryId);
    if (source === undefined || graph.nodeKind(entryId) !== 'dictionary-entry') continue;
    const grammar = new Map<string, string>();
    for (let edge = graph.relationOffsets[source]; edge < graph.relationOffsets[source + 1]; edge++) {
      if (graph.relationTypeIds[edge] !== posType) continue;
      const targetId = graph.persistentOf[graph.relationTargets[edge]];
      if (targetId.startsWith('ja:pos:')) grammar.set(targetId.slice('ja:pos:'.length), targetId);
    }
    for (let edge = graph.relationOffsets[source]; edge < graph.relationOffsets[source + 1]; edge++) {
      if (graph.relationTypeIds[edge] !== senseType) continue;
      const target = graph.relationTargets[edge];
      const senseId = graph.persistentOf[target];
      if (graph.nodeKind(senseId) !== 'sense') continue;
      const label = asset.stringTable[asset.entities.labelStringIds[target]] ?? '';
      const key = normalized(label);
      // A matching real gloss wins, including glosses from another reading row.
      if (content.glosses.has(key)) continue;
      const grammarTargetIds = [...(content.badges.get(key) ?? [])].flatMap((code) => grammar.has(code) ? [grammar.get(code)!] : []);
      if (grammarTargetIds.length === 0) continue;
      removedPairs.add(pairKey(source, target));
      audit.push({ entryId, senseId, label, grammarTargetIds });
    }
  }
  const keep: number[] = [];
  const offsets = [0];
  for (let source = 0; source < graph.entityKindIds.length; source++) {
    for (let edge = graph.relationOffsets[source]; edge < graph.relationOffsets[source + 1]; edge++) {
      if (graph.relationTypeIds[edge] !== senseType || !removedPairs.has(pairKey(source, graph.relationTargets[edge]))) keep.push(edge);
    }
    offsets.push(keep.length);
  }
  const relations = { ...asset.relations, offsets };
  for (const [column, values] of Object.entries(asset.relations)) {
    if (column === 'offsets' || column === 'extensionTypeStrings') continue;
    if (!Array.isArray(values) || values.length !== graph.relationTargets.length) throw new Error(`Unrecognized relation column: ${column}`);
    Object.assign(relations, { [column]: keep.map((edge) => values[edge]) });
  }
  const repaired = { ...asset, relations };
  decodeCompact(repaired);
  return { repaired, audit, removedEdges: graph.relationTargets.length - keep.length };
}

if (process.argv.includes('--graph')) {
  const { values } = parseArgs({ options: { graph: { type: 'string' }, dictionary: { type: 'string' }, output: { type: 'string' } } });
  if (!values.graph || !values.dictionary || !values.output) throw new Error('--graph, --dictionary and --output are required');
  if (resolve(values.graph) === resolve(values.output)) throw new Error('Output must differ from input');
  const dictionary = values.dictionary;
  function* banks(): Generator<unknown[]> {
    for (const name of readdirSync(dictionary).sort()) if (/^term_bank_\d+\.json$/u.test(name)) yield JSON.parse(readFileSync(join(dictionary, name), 'utf8'));
  }
  const result = repairJitendexGraph(JSON.parse(readFileSync(values.graph, 'utf8')), collectEntryContent(banks()));
  writeFileSync(values.output, JSON.stringify(result.repaired), { flag: 'wx' });
  writeFileSync(`${values.output}.audit.json`, JSON.stringify({ removedEdges: result.removedEdges, relations: result.audit }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ correctedMeaningLinks: result.audit.length, removedEdges: result.removedEdges, output: values.output }));
}
