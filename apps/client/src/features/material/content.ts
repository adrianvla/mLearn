import type { AnalyzedToken, Cue, MaterialContent, SourceAnchor, SourceRecord } from '@mlearn/contracts';

export function emptyMaterial(packageId: string): MaterialContent {
  return { packageId, targetId: null, packageRevision: null, sense: null, phrase: '', reading: '', meaning: '',
    context: '', notes: '', examples: [], source: null, attachments: [] };
}

/** The offsets are package-produced UTF-8 byte coordinates in the untouched cue. */
export function cueAnchor(source: SourceRecord, cue: Cue, token: Pick<AnalyzedToken, 'start' | 'end'>, positionMs: number): SourceAnchor {
  return { sourceId: source.id, contentRevision: source.mediaRevision, packageId: source.packageId,
    packageVersion: source.packageVersion, text: cue.text,
    locator: { kind: 'video', subtitleRevision: source.subtitleRevision, cueIndex: cue.index,
      selectionStart: token.start, selectionEnd: token.end, positionMs: Math.round(positionMs),
      subtitleOffsetMs: source.subtitleOffsetMs, playbackRate: source.playbackRate } };
}
