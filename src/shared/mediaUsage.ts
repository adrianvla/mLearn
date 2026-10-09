import type { MediaStats, MediaStatsWordEntry, MediaStatsGrammarEntry, MediaSession } from './types';
import { hashWordSync } from './utils/wordHash';

export function mediaUsageIdentity(type: MediaStats['mediaType'], sourceId: string, language: string): string {
  if (!sourceId.trim() || !language.trim()) throw new Error('Media usage requires an admitted source and language');
  return hashWordSync(JSON.stringify([type, sourceId, language]));
}

/** Per-session cumulative snapshots merge by sequence, never by whole-file replacement. */
export function mergeMediaUsage(current: MediaStats | null, incoming: MediaStats): MediaStats {
  if (!incoming.sourceId || !incoming.usageSessions) return incoming;
  if (incoming.mediaHash !== mediaUsageIdentity(incoming.mediaType, incoming.sourceId, incoming.language)) {
    throw new Error('Media usage identity mismatch');
  }
  if (current && (current.mediaHash !== incoming.mediaHash || current.sourceId !== incoming.sourceId
    || current.language !== incoming.language || current.mediaType !== incoming.mediaType)) throw new Error('Media usage source mismatch');
  const usageSessions = { ...current?.usageSessions };
  for (const [id, session] of Object.entries(incoming.usageSessions)) {
    if (session.id !== id || !Number.isSafeInteger(session.sequence) || session.sequence < 0
      || !Number.isFinite(session.duration) || session.duration < 0) throw new Error('Invalid media session contribution');
    for (const entry of Object.values(session.grammarEncountered)) {
      if (!Number.isFinite(entry.timesFailed) || entry.timesFailed < 0) throw new Error('Invalid media grammar usage');
    }
    const previous = usageSessions[id];
    if (previous && session.sequence > previous.sequence && !previous.finalized) {
      if (session.duration < previous.duration || Object.entries(previous.wordsEncountered).some(([key, entry]) => {
        const next = session.wordsEncountered[key]; return !next || next.timesSeen < entry.timesSeen || next.timesHovered < entry.timesHovered;
      }) || Object.entries(previous.grammarEncountered).some(([key, entry]) => !session.grammarEncountered[key] || session.grammarEncountered[key].timesFailed < entry.timesFailed)) throw new Error('Media usage contributions must be cumulative');
    }
    if (!previous || (session.sequence > previous.sequence && !previous.finalized)) usageSessions[id] = session;
  }
  const wordsEncountered: Record<string, MediaStatsWordEntry> = {};
  const grammarEncountered: Record<string, MediaStatsGrammarEntry> = {};
  for (const session of Object.values(usageSessions).sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))) {
    for (const [key, entry] of Object.entries(session.wordsEncountered)) {
      if (!Number.isFinite(entry.timesSeen) || entry.timesSeen < 0 || !Number.isFinite(entry.timesHovered) || entry.timesHovered < 0) throw new Error('Invalid media word usage');
      const previous = wordsEncountered[key];
      wordsEncountered[key] = { ...entry, timesSeen: (previous?.timesSeen ?? 0) + entry.timesSeen, timesHovered: (previous?.timesHovered ?? 0) + entry.timesHovered };
    }
    for (const [key, entry] of Object.entries(session.grammarEncountered)) {
      const previous = grammarEncountered[key];
      grammarEncountered[key] = { ...entry, timesFailed: (previous?.timesFailed ?? 0) + entry.timesFailed };
    }
  }
  const contributions = Object.values(usageSessions).sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0) || a.id.localeCompare(b.id));
  const annotationLevel = [...contributions].reverse().find(session => session.assessedLevel !== undefined)?.assessedLevel;
  return {
    ...incoming, ...current, usageSessions, wordsEncountered, grammarEncountered,
    assessedLevel: annotationLevel ?? current?.assessedLevel ?? incoming.assessedLevel,
    sessions: contributions.filter(session => session.finalized).map(session => ({
      date: session.date, duration: session.duration, wordsLearned: 0, startTime: session.startTime, endTime: session.endTime,
      wordsEncounteredCount: Object.keys(session.wordsEncountered).length, engagedIntervals: session.engagedIntervals,
    })),
    totalTimeSpent: recordedMediaDuration(contributions),
    lastAccessed: Math.max(current?.lastAccessed ?? 0, incoming.lastAccessed),
    ocrCache: Object.assign({}, incoming.ocrCache, current?.ocrCache, ...contributions.map(session => session.ocrCache)),
  };
}

/** Count only recorded engagement; overlapping physical intervals count once. */
export function recordedMediaDuration(sessions: Array<Pick<MediaSession, 'duration' | 'startTime' | 'endTime' | 'engagedIntervals'>>): number {
  const intervals = sessions.flatMap(session => session.engagedIntervals !== undefined
    ? session.engagedIntervals.map(segment => ({ start: segment.startTime, end: segment.endTime }))
    : session.startTime !== undefined && session.endTime !== undefined ? [{ start: session.startTime, end: session.endTime }] : [])
    .filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end >= segment.start)
    .sort((a, b) => a.start - b.start);
  let total = sessions.filter(session => session.engagedIntervals === undefined && (session.startTime === undefined || session.endTime === undefined))
    .reduce((sum, session) => sum + session.duration, 0);
  let start: number | undefined; let end = 0;
  for (const interval of intervals) {
    if (start === undefined) { start = interval.start; end = interval.end; }
    else if (interval.start <= end) end = Math.max(end, interval.end);
    else { total += Math.max(0, end - start); start = interval.start; end = interval.end; }
  }
  return total + (start === undefined ? 0 : Math.max(0, end - start));
}

/** An acknowledged interrupted session still owns its already recorded engagement. */
export function recordedMediaSessions(media: MediaStats): MediaSession[] {
  return media.usageSessions ? Object.values(media.usageSessions) : media.sessions;
}
