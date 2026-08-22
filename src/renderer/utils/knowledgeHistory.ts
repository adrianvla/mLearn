import { ANKI_EASE } from '../../shared/constants';
import type { EvidenceSource, KnowledgeEvent, KnowledgeEventKind } from '../../shared/knowledgeEvents';
import { stripRetractions } from '../../shared/knowledgeEvents';
import { normalizedStrength, statusToStrength } from '../../shared/utils/knowledgeStrength';

export interface HistoryCurvePoint {
  t: number;
  strength: number;
  source: EvidenceSource;
  kind: KnowledgeEventKind;
  event: KnowledgeEvent;
}

export interface SourceReignBand {
  from: number;
  to: number;
  source: EvidenceSource;
}

export interface ReplayedHistory {
  points: HistoryCurvePoint[];
  bands: SourceReignBand[];
}

export interface ReplayOptions {
  now: number;
  learningThreshold?: number;
  knownThreshold?: number;
  minEase?: number;
}

function eventStrength(event: KnowledgeEvent, learning: number, known: number, min: number): number {
  if (typeof event.easeAfter === 'number') {
    // Anki events carry the raw factor; every other source carries SRS ease (×1000 domain).
    const scaled = event.source === 'anki' ? event.easeAfter : event.easeAfter * 1000;
    return normalizedStrength(scaled, learning, known, min);
  }
  if (event.toStatus) return statusToStrength(event.toStatus);
  return 0;
}

/**
 * Replay a word's event log (single aspect) into a step curve plus source-reign
 * bands. Points sit at event timestamps; the value holds until the next event
 * (step transitions, never interpolated). Same-timestamp events collapse to the
 * last write. The final band extends to `now`.
 */
export function replayKnowledgeHistory(events: readonly KnowledgeEvent[], opts: ReplayOptions): ReplayedHistory {
  const learning = opts.learningThreshold ?? ANKI_EASE.DEFAULT_LEARNING;
  const known = opts.knownThreshold ?? ANKI_EASE.DEFAULT_KNOWN;
  const min = opts.minEase ?? ANKI_EASE.MIN;

  // Undone attempts (retraction tombstones) must not shape the curve.
  const sorted = stripRetractions(events).sort((a, b) => a.t - b.t);
  const points: HistoryCurvePoint[] = [];
  for (const event of sorted) {
    const point: HistoryCurvePoint = {
      t: event.t,
      strength: eventStrength(event, learning, known, min),
      source: event.source,
      kind: event.kind,
      event,
    };
    if (points.length > 0 && points[points.length - 1].t === event.t) {
      points[points.length - 1] = point;
    } else {
      points.push(point);
    }
  }

  const bands: SourceReignBand[] = points.map((point, index) => ({
    from: point.t,
    to: index + 1 < points.length ? points[index + 1].t : opts.now,
    source: point.source,
  }));

  return { points, bands };
}
