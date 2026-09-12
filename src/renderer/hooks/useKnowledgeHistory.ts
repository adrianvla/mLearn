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
  const source = () => [keys(), capability(), version()] as const;
  const [events, { refetch: refetchEvents }] = createResource(
    source,
    async ([keys, activeCapability]) => {
      if (!keys.length || !activeCapability) return [];
      const all = await getEvents(keys);
      // Canonical access addressing: legacy aspect-only events route through
      // ASPECT_CAPABILITY, capability-addressed events match directly.
      return readActiveEvidence(all).filter((event) => eventAppliesToCapability(event, activeCapability)).sort((a, b) => a.t - b.t);
    },
  );

  const [archives, { refetch: refetchArchives }] = createResource(source, async ([keys]) => {
    const results = await Promise.all(keys.map((key) => getKnowledgeArchive(key)));
    return results.flatMap(({ archive }) => archive ? [archive] : []);
  });
  const archivedPoints = createMemo(() => (archives.error ? [] : archives() ?? []).flatMap((archive) => {
    const weekPoints = archive.weekPoints.filter((point: WeekPoint) => {
      const representative = bucketRepresentative(point.b);
      return representative !== undefined && capability() !== undefined && eventAppliesToCapability(representative, capability()!);
    });
    return archivedCurvePoints(weekPoints, { now: Date.now() });
  }).sort((a, b) => a.t - b.t));

  const replay = createMemo(() => replayKnowledgeHistory(events.error ? [] : events() ?? [], { now: Date.now() }));

  return {
    events: () => events.error ? undefined : events(), archivedPoints,
    archives: () => archives.error ? [] : archives() ?? [],
    loading: () => events.loading || archives.loading,
    error: () => !!events.error || !!archives.error,
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
  const [entries, { refetch }] = createResource(() => [forms(), language(), eventsVersion()] as const, async ([forms, language]) =>
    Promise.all(forms.map(async (word) => {
      const key = `${language}:${hashWordSync(word)}`;
      const [events, { archive }] = await Promise.all([getEvents([key]), getKnowledgeArchive(key)]);
      return { word, key, events, archive };
    })),
  );
  return { entries: () => entries.error ? [] : entries() ?? [], loading: () => entries.loading, error: () => !!entries.error, retry: () => { void refetch(); } };
}
