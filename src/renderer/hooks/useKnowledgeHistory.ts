import { createMemo, createResource } from 'solid-js';
import { useLanguage, useSettings } from '../context';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import { eventCapability } from '../../shared/knowledgeEvents';
import type { CapabilityKind } from '../../shared/graph/types';
import { eventsVersion, getEvents } from '../services/knowledgeEvents';
import { hashWordSync } from '../services/srsAlgorithm';
import { replayKnowledgeHistory } from '../utils/knowledgeHistory';
import { getWordFormCandidates } from '../utils/wordForms';
import { legacyCasingCandidates } from '../../shared/utils/normalizationVersion';

export interface KnowledgeHistoryResult {
  events: () => KnowledgeEvent[] | undefined;
  replay: () => ReturnType<typeof replayKnowledgeHistory>;
}

export function useKnowledgeHistory(word: () => string, capability: () => CapabilityKind): KnowledgeHistoryResult {
  const { settings } = useSettings();
  const { langData, currentLangData, getCanonicalFormForLanguage, getWordVariantsForLanguage } = useLanguage();
  const version = createMemo(() => eventsVersion());

  const [events] = createResource(
    () => [word(), capability(), settings.language, version()] as const,
    async ([surface, activeCapability, language]) => {
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

  const replay = createMemo(() => replayKnowledgeHistory(events() ?? [], { now: Date.now() }));

  return { events, replay };
}
