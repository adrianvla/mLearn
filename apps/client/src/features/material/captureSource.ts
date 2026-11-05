import type { MaterialCaptureResult, MaterialCreate, SourceRecord } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { cueAnchor, emptyMaterial } from './content';

type CaptureClient = Pick<RuntimeClient, 'analyzeTranscript' | 'materialEligibility' | 'inspectTargets' |
  'prepareMaterial' | 'captureMaterials'>;

export type SourceCapturePage = {
  readonly saved: number;
  readonly failed: readonly MaterialCreate[];
  readonly results: readonly MaterialCaptureResult[];
  readonly next: number | null;
  readonly done: boolean;
};

/** Streams one native page, retaining only one failed group for exact retry. */
export async function captureSourcePage(client: CaptureClient, source: SourceRecord,
  after: number | null, signal: AbortSignal, onSaved?: (count: number) => void): Promise<SourceCapturePage> {
  function check() {
    if (signal.aborted) throw new RuntimeError('cancelled', 'Source capture stopped. Saved Material is retained.');
  }
  check();
  const batch = await client.analyzeTranscript(source.id, after, '');
  check();
  if (batch.sourceId !== source.id || batch.subtitleRevision !== source.subtitleRevision ||
    batch.packageId !== source.packageId || batch.packageVersion !== source.packageVersion)
    throw new RuntimeError('cancelled', 'Source context changed; reopen capture.');
  if (!batch.cues.length) return { saved: 0, failed: [], results: [], next: null, done: true };
  const next = batch.cues.at(-1)?.cue.index;
  if (next === undefined || after !== null && next <= after)
    throw new RuntimeError('protocol', 'Source capture page did not advance.');
  const candidates = new Map<string, { cue: typeof batch.cues[number]['cue']; token: typeof batch.cues[number]['tokens'][number] }>();
  for (const { cue, tokens } of batch.cues) for (const token of tokens) {
    const target = token.targets[0];
    if (target && !candidates.has(target)) candidates.set(target, { cue, token });
  }
  let saved = 0;
  const targets = [...candidates.keys()];
  // Dictionary reads share the existing six-target native batch. Knowledge is
  // deliberately not eligibility: known words can still be authored.
  for (let offset = 0; offset < targets.length; offset += 6) {
    check();
    const group = targets.slice(offset, offset + 6);
    const eligibility = await client.materialEligibility(group.map(targetId => ({ packageId: source.packageId, targetId })));
    check();
    const eligible = group.filter(id => eligibility.some(item => item.target.targetId === id && item.availability.state === 'eligible'));
    if (!eligible.length) continue;
    const dictionary = await client.inspectTargets(source.id, batch.subtitleRevision, batch.packageRevision, eligible);
    check();
    const commands = eligible.map(id => {
      const candidate = candidates.get(id);
      if (!candidate) throw new RuntimeError('protocol', 'Missing source capture candidate.');
      const entry = dictionary.items.find(item => item.state === 'available' && item.summary.targetId === id);
      if (!entry || entry.state !== 'available')
        throw new RuntimeError('operation', `Dictionary entry unavailable for ${candidate.token.text}; retry capture.`);
      return client.prepareMaterial({
        ...emptyMaterial(source.packageId), targetId: id, packageRevision: batch.packageRevision,
        phrase: candidate.token.text, meaning: entry.summary.summary, reading: entry.summary.reading ?? '',
        context: candidate.cue.text,
        source: cueAnchor(source, candidate.cue, candidate.token, Math.max(0, candidate.cue.startMs - source.subtitleOffsetMs)),
      });
    });
    const results = await client.captureMaterials({ packageId: source.packageId, commands });
    const committed = results.filter(result => result.state === 'saved').length;
    saved += committed;
    onSaved?.(committed);
    const failed = commands.filter(command => results.some(result => result.commandId === command.commandId && result.state === 'failed'));
    if (failed.length) return { saved, failed, results, next: after, done: false };
  }
  return { saved, failed: [], results: [], next, done: false };
}
