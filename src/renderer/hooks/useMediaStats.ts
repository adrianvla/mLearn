/** Source-scoped usage. Learner competence remains in the canonical evidence owner. */
import { createSignal, createEffect, onMount, onCleanup, untrack, type Accessor } from 'solid-js';
import type { MediaStats, MediaUsageSession, MediaUsageEventContext, MediaStatsSaveAck, Token } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { SRS_EASE } from '../../shared/constants';
import { mediaUsageIdentity, mergeMediaUsage } from '../../shared/mediaUsage';

interface UseMediaStatsOptions {
  mediaType: 'video' | 'book';
  language: string | Accessor<string>;
  engaged?: Accessor<boolean>;
}
const PENDING_PREFIX = 'mlearn-pending-media-usage::';
function emptyStats(mediaType: MediaStats['mediaType'], language: string): MediaStats {
  return { mediaHash: '', mediaName: '', mediaType, language, wordsEncountered: {}, grammarEncountered: {},
    assessedLevel: null, sessions: [], usageSessions: {}, totalTimeSpent: 0, lastAccessed: Date.now() };
}
export function useMediaStats(options: UseMediaStatsOptions) {
  const language = () => typeof options.language === 'function' ? options.language() : options.language;
  const [stats, setStats] = createSignal(emptyStats(options.mediaType, language()));
  const [isActive, setIsActive] = createSignal(false);
  const [saveErrors, setSaveErrors] = createSignal<Record<string, unknown>>({});
  const saveError = () => Object.values(saveErrors())[0] ?? null;
  const setFailure = (key: string, error: unknown): void => { setSaveErrors(previous => ({ ...previous, [key]: error })); };
  const clearFailure = (key: string): void => { setSaveErrors(previous => { const next = { ...previous }; delete next[key]; return next; }); };
  const acknowledged = (ack: MediaStatsSaveAck, snapshot: MediaStats): boolean => Boolean(ack && ack.mediaHash === snapshot.mediaHash
    && ack.sessionSequences && Object.entries(snapshot.usageSessions ?? {}).every(([id, session]) =>
      Number.isSafeInteger(ack.sessionSequences[id]) && ack.sessionSequences[id] >= session.sequence));
  const [sessionId, setSessionId] = createSignal('');
  const seenEvents = new Set<string>();
  const lastAcknowledged = new Map<string, number>();
  let lastTick = Date.now(); let wasEngaged = false;
  let saveInterval: ReturnType<typeof setInterval> | undefined;
  let loadGeneration = 0; let mediaStatsCleanup: (() => void) | undefined;
  const mediaHash = () => stats().mediaHash;
  const eventContext = (): MediaUsageEventContext | undefined => {
    const current = stats();
    return isActive() ? { mediaHash: current.mediaHash, sourceId: current.sourceId!, sessionId: sessionId(), language: current.language } : undefined;
  };
  const accepts = (context?: MediaUsageEventContext): boolean => {
    const admitted = eventContext();
    return Boolean(admitted && (!context || (admitted.mediaHash === context.mediaHash && admitted.sourceId === context.sourceId
      && admitted.sessionId === context.sessionId && admitted.language === context.language)));
  };
  const updateSession = (mutate: (session: MediaUsageSession) => MediaUsageSession): void => {
    if (!isActive()) return;
    const current = stats(); const id = sessionId(); const previous = current.usageSessions?.[id];
    if (!previous || previous.finalized) return;
    const next = { ...mutate(previous), sequence: previous.sequence + 1 };
    setStats(mergeMediaUsage(current, { ...current, usageSessions: { [id]: next }, lastAccessed: Date.now() }));
  };
  const refreshEngagement = (requested = options.engaged?.() ?? true): void => {
    const now = Date.now(); const elapsed = Math.max(0, now - lastTick);
    if (isActive() && wasEngaged && elapsed > 0) updateSession(session => {
      const intervals = [...(session.engagedIntervals ?? [])];
      const last = intervals.at(-1);
      if (last?.endTime === lastTick) intervals[intervals.length - 1] = { ...last, endTime: now };
      else intervals.push({ startTime: lastTick, endTime: now });
      return { ...session, duration: session.duration + elapsed, engagedIntervals: intervals };
    });
    lastTick = now;
    wasEngaged = isActive() && requested && document.visibilityState !== 'hidden' && document.hasFocus();
  };
  createEffect(() => { const requested = options.engaged?.(); untrack(() => refreshEngagement(requested)); });

  const retryPending = async (hash?: string): Promise<void> => {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index); if (key?.startsWith(hash ? `${PENDING_PREFIX}${hash}::` : PENDING_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key); if (!raw) continue;
      const snapshot: MediaStats = JSON.parse(raw);
      const acknowledgement = await getBridge().mediaStats.saveMediaStats(snapshot.mediaHash, snapshot);
      if (!acknowledged(acknowledgement, snapshot)) {
        throw new Error('Recovered media usage was not acknowledged');
      }
      if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
      clearFailure(key);
    }
  };
  const saveStats = async (): Promise<void> => {
    refreshEngagement();
    const current = stats(); const id = sessionId(); const own = current.usageSessions?.[id];
    if (!current.mediaHash || !own) return;
    if (lastAcknowledged.get(id) === own.sequence) { await retryPending(current.mediaHash); return; }
    const snapshot = { ...current, usageSessions: { [id]: own } };
    const key = `${PENDING_PREFIX}${current.mediaHash}::${id}`;
    try {
      localStorage.setItem(key, JSON.stringify(snapshot));
      const acknowledgement = await getBridge().mediaStats.saveMediaStats(current.mediaHash, snapshot);
      if (!acknowledged(acknowledgement, snapshot)) {
        throw new Error('Media usage was not acknowledged');
      }
      lastAcknowledged.set(id, Math.max(lastAcknowledged.get(id) ?? -1, acknowledgement.sessionSequences[id]));
      const pending = localStorage.getItem(key);
      if (pending && JSON.parse(pending).usageSessions?.[id]?.sequence <= acknowledgement.sessionSequences[id]) localStorage.removeItem(key);
      await retryPending(current.mediaHash);
      clearFailure(key);
    } catch (error) {
      setFailure(key, error);
      throw error;
    }
  };
  const flush = (): void => { void saveStats().catch(() => { /* Visible error and retained intent own retry. */ }); };
  const endSession = (): void => {
    if (!isActive()) return;
    refreshEngagement();
    updateSession(session => ({ ...session, finalized: true, endTime: Date.now(), wordsEncounteredCount: Object.keys(session.wordsEncountered).length }));
    setIsActive(false); wasEngaged = false;
    flush();
  };
  const loadStats = (hash: string): void => {
    const generation = ++loadGeneration;
    mediaStatsCleanup?.();
    const bridge = getBridge();
    const receive = (loaded: MediaStats | null): void => {
      if (generation !== loadGeneration || mediaHash() !== hash) return;
      clearFailure(`${hash}::load`);
      if (!loaded || loaded.mediaHash !== hash) return;
      // New interactions admitted during load win by session sequence.
      setStats(mergeMediaUsage(loaded, stats()));
    };
    mediaStatsCleanup = bridge.mediaStats.onMediaStats(receive);
    const pending = bridge.mediaStats.getMediaStats(hash);
    if (pending && typeof pending.then === 'function') void pending.then(receive).catch(error => { if (generation === loadGeneration && mediaHash() === hash) setFailure(`${hash}::load`, error); });
    // The event subscription remains solely for retained legacy callers.
  };
  const setMedia = (name: string, source: { resourceId: string; language?: string }): void => {
    if (!name.trim()) return;
    const admittedLanguage = source.language ?? language();
    const hash = mediaUsageIdentity(options.mediaType, source.resourceId, admittedLanguage);
    if (mediaHash() === hash) { if (stats().mediaName !== name) setStats(previous => ({ ...previous, mediaName: name })); return; }
    endSession(); seenEvents.clear();
    const id = crypto.randomUUID(); const now = Date.now();
    let initial: MediaStats = { ...emptyStats(options.mediaType, admittedLanguage), mediaHash: hash, mediaName: name, sourceId: source.resourceId };
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(`${PENDING_PREFIX}${hash}::`)) initial = mergeMediaUsage(initial, JSON.parse(localStorage.getItem(key)!));
      }
    } catch (error) { setFailure(`${hash}::pending`, error); }
    const session: MediaUsageSession = { id, sequence: 0, finalized: false, date: new Date(now).toISOString().split('T')[0],
      duration: 0, wordsLearned: 0, startTime: now, wordsEncountered: {}, grammarEncountered: {} };
    setSessionId(id); setStats(mergeMediaUsage(initial, { ...initial, usageSessions: { [id]: session } }));
    setIsActive(true); lastTick = now; wasEngaged = false; refreshEngagement(); loadStats(hash);
    void retryPending(hash).catch(error => { setFailure(`${PENDING_PREFIX}${hash}::recovery`, error); });
  };
  const recordWord = (word: string, ease: number, context?: MediaUsageEventContext): void => {
    if (!accepts(context)) return;
    updateSession(session => {
      const existing = session.wordsEncountered[word] ?? { word, ease: SRS_EASE.MIN, timesSeen: 0, timesHovered: 0 };
      return { ...session, wordsEncountered: { ...session.wordsEncountered, [word]: { ...existing, ease, timesSeen: existing.timesSeen + 1 } } };
    });
  };
  const recordWordHover = (word: string, ease: number, context?: MediaUsageEventContext): void => {
    if (!accepts(context)) return;
    updateSession(session => {
      const existing = session.wordsEncountered[word] ?? { word, ease: SRS_EASE.MIN, timesSeen: 0, timesHovered: 0 };
      return { ...session, wordsEncountered: { ...session.wordsEncountered, [word]: { ...existing, ease, timesHovered: existing.timesHovered + 1 } } };
    });
  };
  const grammar = (pattern: string, ease: number, failed: boolean): void => updateSession(session => {
    const existing = session.grammarEncountered[pattern] ?? { pattern, ease: SRS_EASE.MIN, timesFailed: 0 };
    return { ...session, grammarEncountered: { ...session.grammarEncountered, [pattern]: { ...existing, ease, timesFailed: existing.timesFailed + (failed ? 1 : 0) } } };
  });
  const cacheOcrPage = (pageNum: number, tokens: Token[]): void => {
    if (!isActive() || tokens.some(token => token.analysisAuthority === 'display-only')) return;
    updateSession(session => ({ ...session, ocrCache: { ...session.ocrCache, [pageNum]: tokens } }));
  };
  const receiveEvent = (event: Event, hovered: boolean): void => {
    const detail = (event as CustomEvent<MediaUsageEventContext & { word: string; ease: number; encounterId?: string }>).detail;
    if (!detail?.mediaHash || !detail.sessionId || !detail.sourceId || !accepts(detail)) return;
    if (!hovered && detail.encounterId) {
      const key = JSON.stringify([detail.sessionId, detail.encounterId, detail.word]);
      if (seenEvents.has(key)) return; seenEvents.add(key);
    }
    if (hovered) recordWordHover(detail.word, detail.ease, detail); else recordWord(detail.word, detail.ease, detail);
  };
  const seen = (event: Event) => receiveEvent(event, false);
  const hovered = (event: Event) => receiveEvent(event, true);
  const engagementChanged = () => refreshEngagement();
  onMount(() => {
    saveInterval = setInterval(() => { if (isActive()) flush(); }, 30000);
    window.addEventListener('mlearn:word-seen', seen); window.addEventListener('mlearn:word-hovered', hovered);
    window.addEventListener('beforeunload', endSession); window.addEventListener('focus', engagementChanged); window.addEventListener('blur', engagementChanged);
    document.addEventListener('visibilitychange', engagementChanged);
  });
  onCleanup(() => {
    if (saveInterval) clearInterval(saveInterval); loadGeneration++; mediaStatsCleanup?.(); endSession();
    window.removeEventListener('mlearn:word-seen', seen); window.removeEventListener('mlearn:word-hovered', hovered);
    window.removeEventListener('beforeunload', endSession); window.removeEventListener('focus', engagementChanged); window.removeEventListener('blur', engagementChanged);
    document.removeEventListener('visibilitychange', engagementChanged);
  });
  return { stats, mediaHash, isActive, sessionId, eventContext, setMedia, recordWord, recordWordHover,
    recordGrammar: (pattern: string, ease: number) => grammar(pattern, ease, false),
    recordGrammarFailed: (pattern: string, ease: number) => grammar(pattern, ease, true), cacheOcrPage,
    getCachedOcrPage: (pageNum: number) => stats().ocrCache?.[pageNum] ?? null,
    setAssessedLevel: (level: number) => { if (Number.isFinite(level)) updateSession(session => ({ ...session, assessedLevel: level })); },
    saveStats, retrySaveStats: async () => {
      lastAcknowledged.delete(sessionId());
      await retryPending();
      // Only clear recovered write failures; reload errors stay visible until a successful read.
      setSaveErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key.endsWith('::load'))));
      loadStats(mediaHash());
      await saveStats();
    }, saveError, endSession };
}
