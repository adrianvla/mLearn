import { createMemo, createResource } from 'solid-js';
import { useLanguage, useSettings } from '../context';
import type { KnowledgeAspect, KnowledgeEvent } from '../../shared/knowledgeEvents';
import { eventsVersion, getEvents } from '../services/knowledgeEvents';
import { hashWordSync } from '../services/srsAlgorithm';
import { replayKnowledgeHistory } from '../utils/knowledgeHistory';
import { getWordFormCandidates } from '../utils/wordForms';
import { legacyCasingCandidates } from '../../shared/utils/normalizationVersion';

export interface KnowledgeHistoryResult {
  events: () => KnowledgeEvent[] | undefined;
  replay: () => ReturnType<typeof replayKnowledgeHistory>;
}

export function useKnowledgeHistory(word: () => string, aspect: () => KnowledgeAspect): KnowledgeHistoryResult {
  const { settings } = useSettings();
  const { langData, currentLangData, getCanonicalFormForLanguage, getWordVariantsForLanguage } = useLanguage();
  const version = createMemo(() => eventsVersion());

  const [events] = createResource(
    () => [word(), aspect(), settings.language, version()] as const,
    async ([surface, activeAspect, language]) => {
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
      return all.filter((event) => event.aspect === activeAspect).sort((a, b) => a.t - b.t);
    },
  );

  const replay = createMemo(() => replayKnowledgeHistory(events() ?? [], { now: Date.now() }));

  return { events, replay };
}
