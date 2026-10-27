import type { ReviewCommand, SourceAnchor } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import type { CaptureCandidate } from './CaptureList';

/** Freeze finite practice membership through the existing native admission owner. */
export async function prepareSourcePractice(
  client: Pick<RuntimeClient, 'materialEligibility' | 'cuePosition' | 'prepareReviewStart'>,
  candidates: readonly CaptureCandidate[],
  signal: AbortSignal,
): Promise<ReviewCommand> {
  const targets = candidates.flatMap(({ content }) => content.targetId
    ? [{ packageId: content.packageId, targetId: content.targetId }] : []);
  const eligibility = await client.materialEligibility(targets);
  if (signal.aborted) throw new Error('Word Practice preparation stopped.');
  const items: { materialId: string; source: SourceAnchor }[] = [];
  const positions = new Map<string, number>();
  for (const candidate of candidates) {
    const saved = eligibility.find(item => item.target.packageId === candidate.content.packageId
      && item.target.targetId === candidate.content.targetId)?.availability;
    let source = candidate.content.source;
    if (saved?.state !== 'existing' || saved.excluded || !source) continue;
    switch (source.locator.kind) {
      case 'image': {
        const { selectionStart, selectionEnd, contextStart } = source.locator;
        const text = new TextDecoder().decode(new TextEncoder().encode(source.text).subarray(selectionStart, selectionEnd));
        source = { ...source, text, locator: { ...source.locator,
          contextStart: contextStart + selectionStart, selectionStart: 0, selectionEnd: selectionEnd - selectionStart } };
        break;
      }
      case 'video': {
        const locator = source.locator;
        if (candidate.resolveCuePosition && locator.cueIndex !== null && locator.subtitleRevision !== null) {
          const key = JSON.stringify([source.sourceId, locator.subtitleRevision, locator.cueIndex]);
          let position = positions.get(key);
          if (position === undefined) {
            position = await client.cuePosition(source.sourceId, locator.subtitleRevision, locator.cueIndex);
            if (signal.aborted) throw new Error('Word Practice preparation stopped.');
            positions.set(key, position);
          }
          source = { ...source, locator: { ...locator, positionMs: position } };
        }
        break;
      }
      case 'document':
      case 'message':
        break;
    }
    items.push({ materialId: saved.materialId, source });
  }
  if (!items.length) throw new Error('Capture eligible words before starting Word Practice.');
  return client.prepareReviewStart({ kind: 'practice', items });
}
