import { createMemo, createResource } from 'solid-js';
import { useLanguage, useSettings } from '../context';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import { eventCapability } from '../../shared/knowledgeEvents';
import type { CapabilityKey } from '../../shared/graph/types';
import { eventsVersion, getEvents, getKnowledgeArchive } from '../services/knowledgeEvents';
import { hashWordSync } from '../services/srsAlgorithm';
import { archivedCurvePoints, replayKnowledgeHistory, type ArchivedHistoryPoint } from '../utils/knowledgeHistory';
import { bucketRepresentative, type WeekPoint } from '../../shared/knowledge/historyArchive';
import { eventAppliesToCapability } from '../../shared/graph/addressing';
import { getWordFormCandidates } from '../utils/wordForms';
import { legacyCasingCandidates } from '../../shared/utils/normalizationVersion';

export interface KnowledgeHistoryResult {
  events: () => KnowledgeEvent[] | undefined;
  archivedPoints: () => ArchivedHistoryPoint[];
  replay: () => ReturnType<typeof replayKnowledgeHistory>;
}

export function useKnowledgeHistory(word: () => string, capability: () => CapabilityKey | undefined): KnowledgeHistoryResult {
  const { settings } = useSettings();
  const { langData, currentLangData, getCanonicalFormForLanguage, getWordVariantsForLanguage } = useLanguage();
  const version = createMemo(() => eventsVersion());

  const [events] = createResource(
    () => [word(), capability(), settings.language, version()] as const,
    async ([surface, activeCapability, language]) => {
      if (!surface || !activeCapability) return [];
      const languageData = language === settings.language ? currentLangData() : langData[language] ?? null;
      const forms = getWordFormCandidates(
        surface,
        (value) => getCanonicalFormForLanguage(language, value),
        (value) => getWordVariantsForLanguage(language, value),
        { languageData, language },
      );
      // D4 lazy salvage: probe legacy ambient-locale casing variants after the
      // current-version keys so pre-migration history stays visible. Read-only.
      const legacyForms = forms.flatMap((form) => legacyCasingCandidates(form));
      const keys = [...forms, ...legacyForms].map((form) => `${language}:${hashWordSync(form)}`);
      const all = await getEvents(keys);
      // Canonical access addressing: legacy aspect-only events route through
      // ASPECT_CAPABILITY, capability-addressed events match directly.
      return all.filter((event) => eventCapability(event) === activeCapability).sort((a, b) => a.t - b.t);
    },
  );

  // LOD: coarse archive points for the archived range, capability-scoped via
  // the same raw-address bucket matcher the projection uses.
  const [archivedPoints] = createResource(
    () => [word(), capability(), settings.language, version()] as const,
    async ([surface, activeCapability, language]) => {
      if (!surface || !activeCapability) return [];
      const languageData = language === settings.language ? currentLangData() : langData[language] ?? null;
      const forms = getWordFormCandidates(
        surface,
        (value) => getCanonicalFormForLanguage(language, value),
        (value) => getWordVariantsForLanguage(language, value),
        { languageData, language },
      );
      const keys = [...forms, ...forms.flatMap((form) => legacyCasingCandidates(form))].map((form) => `${language}:${hashWordSync(form)}`);
      const points: ArchivedHistoryPoint[] = [];
      for (const key of [...new Set(keys)]) {
        try {
          const { archive } = await getKnowledgeArchive(key);
          if (!archive) continue;
          const weekPoints = archive.weekPoints.filter((point: WeekPoint) => {
            const representative = bucketRepresentative(point.b);
            return representative !== undefined && eventAppliesToCapability(representative, activeCapability);
          });
          points.push(...archivedCurvePoints(weekPoints, { now: Date.now() }));
        } catch {
          // Archive queries degrade silently in the history view.
        }
      }
      return points.sort((a, b) => a.t - b.t);
    },
  );

  const replay = createMemo(() => replayKnowledgeHistory(events() ?? [], { now: Date.now() }));

  return { events, archivedPoints: () => archivedPoints() ?? [], replay };
}
