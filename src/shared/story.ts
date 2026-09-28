/** User-declared source progress, NOT playback telemetry and NOT shared franchise canon. */
import type { CanonAnchor, Participant } from './world';

export interface UnitRange { from: number; to: number }
/** An explicitly reviewed mapping to a source page. A range is indivisible for spoiler filtering. */
export interface StorySource extends UnitRange {
  id: string;
  url: string;
  label?: string;
  section?: string;
  confirmed: boolean;
}
export interface StoryRelation {
  targetTrackId: string;
  /** Human-authored relationship, never an assertion that two tracks' facts are interchangeable. */
  label: string;
  note?: string;
}
export interface StoryTrack {
  id: string;
  title: string;
  /** Edition/adaptation/continuity is explicit; a franchise title is not identity. */
  edition: string;
  collection?: string;
  unitLabel: string;
  totalUnits?: number;
  /** Sparse labels allow e.g. a route/checkpoint or Chapter 0.5 at ordinal 3. */
  unitNames?: Record<string, string>;
  completed: UnitRange[];
  sources: StorySource[];
  relations: StoryRelation[];
  sourceWiki?: string;
  externalUrl?: string;
  autoAdvance: boolean;
  archived?: boolean;
  revision: number;
  updatedAt: number;
}
export type StoryTrackDraft = Omit<StoryTrack, 'id' | 'revision' | 'updatedAt'>;
export interface SaveStoryTrackInput { id?: string; expectedRevision?: number; track: StoryTrackDraft }
export type ProgressChange = { kind: 'through' | 'complete' | 'remove'; unit: number } | { kind: 'ranges'; ranges: UnitRange[] };
export interface SetStoryProgressInput { trackId: string; expectedRevision: number; change: ProgressChange }
export type StoryFollowMode = 'follow' | 'pinned' | 'independent';
export interface StoryBranch {
  mode: StoryFollowMode;
  /** Owner-authored alternative premises. They are not fabricated observed events. */
  adaptations: string[];
  revision: number;
}
export interface UpdateStoryBranchInput { threadId: string; expectedRevision: number; mode: StoryFollowMode; adaptations: string[]; adoptCurrentSources?: boolean }
export interface StoryAdvanceProposal { participantId: string; beforeHash: string; canon: CanonAnchor }
export interface StoryAdvanceRecord {
  id: string;
  trackId: string;
  trackRevision: number;
  status: 'running' | 'ready' | 'applied' | 'held' | 'failed' | 'cancelled' | 'stale';
  createdAt: number;
  finishedAt?: number;
  /** Source-derived proposal, never the live person's memories or identity. */
  proposals: StoryAdvanceProposal[];
  error?: string;
}
export interface StoryAdvanceInput { trackId: string; expectedRevision: number; automatic?: boolean }

export const STORY_LIMITS = { unit: 1_000_000, ranges: 512, sources: 512, text: 1200, tracks: 1000, sourcePagesPerRun: 16, castPerRun: 24, history: 64 } as const;
const unit = (n: number, zero = false): void => {
  if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1) || n > STORY_LIMITS.unit) throw new Error('Invalid story unit');
};
export function normalizeProgress(ranges: readonly UnitRange[]): UnitRange[] {
  if (!Array.isArray(ranges) || ranges.length > STORY_LIMITS.ranges) throw new Error('Too many story progress ranges');
  const sorted = ranges.map(range => {
    if (!range || typeof range !== 'object') throw new Error('Invalid story range');
    unit(range.from); unit(range.to);
    if (range.to < range.from) throw new Error('Reversed story range');
    return { from: range.from, to: range.to };
  }).sort((a, b) => a.from - b.from);
  const result: UnitRange[] = [];
  for (const range of sorted) {
    const last = result.at(-1);
    if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to);
    else result.push(range);
  }
  return result;
}
export function covered(completed: readonly UnitRange[], range: UnitRange): boolean {
  return normalizeProgress(completed).some(item => item.from <= range.from && item.to >= range.to);
}
export function progressSummary(completed: readonly UnitRange[]): { count: number; through: number; furthest: number } {
  const ranges = normalizeProgress(completed);
  return { count: ranges.reduce((sum, range) => sum + range.to - range.from + 1, 0), through: ranges[0]?.from === 1 ? ranges[0].to : 0, furthest: ranges.at(-1)?.to ?? 0 };
}
export function changeProgress(current: readonly UnitRange[], change: ProgressChange): UnitRange[] {
  if (!change || typeof change !== 'object') throw new Error('Invalid story progress change');
  if (change.kind === 'ranges') return normalizeProgress(change.ranges);
  unit(change.unit, change.kind === 'through');
  if (change.kind === 'through') return change.unit === 0 ? [] : [{ from: 1, to: change.unit }];
  if (change.kind === 'complete') return normalizeProgress([...current, { from: change.unit, to: change.unit }]);
  if (change.kind !== 'remove') throw new Error('Unknown story progress change');
  return normalizeProgress(current).flatMap(range => change.unit < range.from || change.unit > range.to ? [range] : [
    ...(change.unit > range.from ? [{ from: range.from, to: change.unit - 1 }] : []),
    ...(change.unit < range.to ? [{ from: change.unit + 1, to: range.to }] : []),
  ]);
}
function boundedText(value: unknown, required = false): void {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > STORY_LIMITS.text) throw new Error('Invalid story text');
}
export function validateStoryTrack(track: StoryTrack): void {
  if (!track || typeof track !== 'object') throw new Error('Invalid story track');
  boundedText(track.id, true); boundedText(track.title, true); boundedText(track.edition, true); boundedText(track.unitLabel, true);
  if (track.collection !== undefined) boundedText(track.collection);
  if (!Number.isSafeInteger(track.revision) || track.revision < 1 || !Number.isFinite(track.updatedAt) || typeof track.autoAdvance !== 'boolean') throw new Error('Invalid story track revision');
  const completed = normalizeProgress(track.completed);
  if (track.totalUnits !== undefined) { unit(track.totalUnits); if ((completed.at(-1)?.to ?? 0) > track.totalUnits) throw new Error('Progress exceeds total units'); }
  if (!Array.isArray(track.sources) || track.sources.length > STORY_LIMITS.sources || !Array.isArray(track.relations) || track.relations.length > 100) throw new Error('Invalid story sources');
  const ids = new Set<string>();
  for (const source of track.sources) {
    boundedText(source.id, true); if (ids.has(source.id)) throw new Error('Duplicate source mapping'); ids.add(source.id);
    normalizeProgress([source]);
    if (typeof source.confirmed !== 'boolean') throw new Error('Source mapping needs explicit confirmation');
    validatePublicSourceUrl(source.url);
    if (source.label !== undefined) boundedText(source.label);
    if (source.section !== undefined) boundedText(source.section);
    if (track.totalUnits !== undefined && source.to > track.totalUnits) throw new Error('Source mapping exceeds total units');
  }
  for (const relation of track.relations) { boundedText(relation.targetTrackId, true); boundedText(relation.label, true); if (relation.note !== undefined) boundedText(relation.note); if (relation.targetTrackId === track.id) throw new Error('A track cannot relate to itself'); }
  if (track.unitNames) {
    if (Object.keys(track.unitNames).length > STORY_LIMITS.sources) throw new Error('Too many unit labels');
    for (const [key, value] of Object.entries(track.unitNames)) { unit(Number(key)); boundedText(value, true); }
  }
  if (track.sourceWiki) validatePublicSourceUrl(track.sourceWiki);
  if (track.externalUrl) validatePublicSourceUrl(track.externalUrl);
}
/** URL syntax boundary. The network reader additionally validates DNS/redirects. */
export function validatePublicSourceUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid source URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Sources must use public HTTPS URLs without credentials');
  return url;
}
export function eligibleSources(track: StoryTrack): StorySource[] {
  return track.sources.filter(source => source.confirmed && covered(track.completed, source)).sort((a, b) => a.from - b.from);
}
export function formatProgress(track: StoryTrack): string {
  return track.completed.map(range => range.from === range.to ? String(range.from) : `${range.from}–${range.to}`).join(', ');
}
export function sameCanonSource(a: CanonAnchor | undefined, b: CanonAnchor | undefined): boolean {
  return Boolean(a && b && a.trackId && a.trackId === b.trackId && a.fandomBaseUrl.replace(/\/+$/, '').toLowerCase() === b.fandomBaseUrl.replace(/\/+$/, '').toLowerCase() && a.characterPageTitle.replace(/_/g, ' ') === b.characterPageTitle.replace(/_/g, ' '));
}
/** No history is changed. Branch adaptations conservatively hold new source material for review. */
export function resolveStoryCanon(frozen: Participant, current: Participant | undefined, mode: StoryFollowMode, adaptations: readonly string[]): CanonAnchor | undefined {
  if (mode !== 'follow' || adaptations.length || !sameCanonSource(frozen.canon, current?.canon)) return frozen.canon;
  const previous = frozen.canon?.coverage, next = current?.canon?.coverage;
  if (!previous || !next || !previous.every(range => covered(next, range))) return frozen.canon;
  return current?.canon;
}

/** Shared validation for creation and revision-checked editing of a local story. */
export function validateStoryBranch(value: Pick<StoryBranch, 'mode' | 'adaptations'>): void {
  if (!value || !['follow', 'pinned', 'independent'].includes(value.mode) || !Array.isArray(value.adaptations)
    || value.adaptations.length > 24 || value.adaptations.some(item => typeof item !== 'string' || !item.trim() || item.length > 1600)) {
    throw new Error('Invalid alternative-story settings');
  }
}
