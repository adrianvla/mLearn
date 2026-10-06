import { createMemo, createResource } from 'solid-js';
import { useLanguage, useSettings } from '../context';
import { readActiveEvidence, type KnowledgeEvent } from '../../shared/knowledgeEvents';
import { isSurfaceScopedCapability } from '../../shared/graph/targets';
import type { CapabilityKey } from '../../shared/graph/types';
import { eventsVersion, getEvents, getKnowledgeArchive } from '../services/knowledgeEvents';
import { hashWordSync } from '../services/srsAlgorithm';
import { archivedCurvePoints, replayKnowledgeHistory, type ArchivedHistoryPoint } from '../utils/knowledgeHistory';
import { bucketRepresentative, type KeyArchive, type WeekPoint } from '../../shared/knowledge/historyArchive';
import { eventAppliesToCapability } from '../../shared/graph/addressing';
import { getWordFormCandidates } from '../utils/wordForms';
import { legacyCasingCandidates } from '../../shared/utils/normalizationVersion';

export interface KnowledgeHistoryResult {
  events: () => KnowledgeEvent[] | undefined;
  archives: () => KeyArchive[];
  loading: () => boolean;
  error: () => boolean;
  retry: () => void;
  archivedPoints: () => ArchivedHistoryPoint[];
  replay: () => ReturnType<typeof replayKnowledgeHistory>;
}

export function useKnowledgeHistory(word: () => string, capability: () => CapabilityKey | undefined, languageOverride?: () => string): KnowledgeHistoryResult {
  const { settings } = useSettings();
  const { langData, currentLangData, getCanonicalFormForLanguage, getWordVariantsForLanguage } = useLanguage();
  const version = createMemo(() => eventsVersion());

  // Resolve keys once for the exact tail and compressed archive. Directed
  // surface capabilities must never borrow another spelling's history.
  const keys = createMemo(() => {
    const surface = word();
    const activeCapability = capability();
    const language = languageOverride?.() ?? settings.language;
    if (!surface || !activeCapability) return [];
    if (isSurfaceScopedCapability(activeCapability)) return [`${language}:${hashWordSync(surface)}`];
    const languageData = language === settings.language ? currentLangData() : langData[language] ?? null;
    const forms = getWordFormCandidates(
      surface,
      (value) => getCanonicalFormForLanguage(language, value),
      (value) => getWordVariantsForLanguage(language, value),
      { languageData, language },
    );
    return [...new Set([...forms, ...forms.flatMap(legacyCasingCandidates)].map((form) => `${language}:${hashWordSync(form)}`))];
  });
  const scopeKey = createMemo(() => JSON.stringify([keys(), capability()]));
  const source = () => ({ keys: keys(), capability: capability(), scopeKey: scopeKey(), version: version() });
  const [eventSnapshot, { refetch: refetchEvents }] = createResource(
    source,
    async ({ keys, capability: activeCapability, scopeKey }) => {
      if (!keys.length || !activeCapability) return { scopeKey, events: [] as KnowledgeEvent[] };
      const all = await getEvents(keys);
      // Canonical access addressing: legacy aspect-only events route through
      // ASPECT_CAPABILITY, capability-addressed events match directly.
      return { scopeKey, events: readActiveEvidence(all).filter((event) => eventAppliesToCapability(event, activeCapability)).sort((a, b) => a.t - b.t) };
    },
  );

  const [archiveSnapshot, { refetch: refetchArchives }] = createResource(source, async ({ keys, scopeKey }) => {
    const results = await Promise.all(keys.map((key) => getKnowledgeArchive(key)));
    return { scopeKey, archives: results.flatMap(({ archive }) => archive ? [archive] : []) };
  });
  const events = () => {
    const snapshot = eventSnapshot();
    return !eventSnapshot.error && snapshot?.scopeKey === scopeKey() ? snapshot.events : undefined;
  };
  const archives = () => {
    const snapshot = archiveSnapshot();
    return !archiveSnapshot.error && snapshot?.scopeKey === scopeKey() ? snapshot.archives : [];
  };
  const archivedPoints = createMemo(() => archives().flatMap((archive) => {
    const weekPoints = archive.weekPoints.filter((point: WeekPoint) => {
      const representative = bucketRepresentative(point.b);
      return representative !== undefined && capability() !== undefined && eventAppliesToCapability(representative, capability()!);
    });
    return archivedCurvePoints(weekPoints, { now: Date.now() });
  }).sort((a, b) => a.t - b.t));

  const replay = createMemo(() => replayKnowledgeHistory(eventSnapshot.error ? [] : events() ?? [], { now: Date.now() }));

  return {
    events, archivedPoints,
    archives,
    loading: () => eventSnapshot.loading || archiveSnapshot.loading,
    error: () => !!eventSnapshot.error || !!archiveSnapshot.error,
    retry: () => { void refetchEvents(); void refetchArchives(); }, replay,
  };
}

/** Whole-word ease keeps per-form provenance so the canonical word resolver,
 * rather than a blended event stream, selects the overall value. */
export function useWordEaseHistory(word: () => string, language: () => string) {
  const { settings } = useSettings();
  const { langData, currentLangData, getCanonicalFormForLanguage, getWordVariantsForLanguage } = useLanguage();
  const forms = createMemo(() => {
    const activeLanguage = language();
    const languageData = activeLanguage === settings.language ? currentLangData() : langData[activeLanguage] ?? null;
    const candidates = getWordFormCandidates(word(), (value) => getCanonicalFormForLanguage(activeLanguage, value),
      (value) => getWordVariantsForLanguage(activeLanguage, value), { languageData, language: activeLanguage });
    return [...new Set([...candidates, ...candidates.flatMap(legacyCasingCandidates)])];
  });
  const scopeKey = createMemo(() => JSON.stringify([forms(), language()]));
  const [entrySnapshot, { refetch }] = createResource(() => ({ forms: forms(), language: language(), scopeKey: scopeKey(), version: eventsVersion() }), async ({ forms, language, scopeKey }) =>
    ({ scopeKey, entries: await Promise.all(forms.map(async (word) => {
      const key = `${language}:${hashWordSync(word)}`;
      const [events, { archive }] = await Promise.all([getEvents([key]), getKnowledgeArchive(key)]);
      return { word, key, events, archive };
    })) }),
  );
  return {
    entries: () => {
      const snapshot = entrySnapshot();
      return snapshot?.scopeKey === scopeKey() ? snapshot.entries : undefined;
    },
    loading: () => entrySnapshot.loading,
    error: () => !!entrySnapshot.error,
    retry: () => { void refetch(); },
  };
}
