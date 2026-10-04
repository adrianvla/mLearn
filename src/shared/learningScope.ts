import { activeLearningGoals, learningGoalsForSettings, type LearningGoal } from './learningGoals';
import { resolveLearningOutcome } from './learningOutcomes';
import { buildWordFrequencyMapFromLanguageData, resolveLanguageFrequencyPayload } from './languageFeatures';
import type { WordFrequencyMap, LanguageData, Settings } from './types';

/** One package-resolved target boundary for Home, Plan and activity policy. */
export function learningScopeForSettings(settings: Pick<Settings, 'learningGoals' | 'examGoal'> & { language?: string },
  data: LanguageData | null | undefined, language = settings.language ?? '') {
  const selected = activeLearningGoals(learningGoalsForSettings(settings), language);
  const goals: LearningGoal[] = [];
  const words = new Set<string>();
  const patterns = new Set<string>();
  const unavailable: string[] = [];
  const frequency: WordFrequencyMap = {};
  for (const goal of selected) {
    const resolved = resolveLearningOutcome(data, goal.outcomeRef!.id, goal.outcomeRef!.groupIds);
    if (!resolved?.complete) { unavailable.push(goal.id); continue; }
    goals.push({ ...goal, outcome: resolved.declaration.label, scope: { ...goal.scope,
      provenance: resolved.declaration.provenance, reference: resolved.declaration.reference,
      words: resolved.words, requirements: resolved.declaration.requirements } });
    const membership = new Set(resolved.words);
    for (const group of resolved.declaration.groups.filter(group => !goal.outcomeRef?.groupIds || goal.outcomeRef.groupIds.includes(group.id))) {
      for (const selector of group.selectors.filter(selector => selector.source === 'frequency')) {
        const payload = resolveLanguageFrequencyPayload(data, selector.provider);
        for (const [word, entry] of Object.entries(buildWordFrequencyMapFromLanguageData(payload.languageData))) {
          if (membership.has(word)) frequency[word] = entry;
        }
      }
    }
    resolved.words.forEach(word => words.add(word));
    resolved.patterns.forEach(pattern => patterns.add(pattern));
  }
  return { selected: selected.length > 0, goals, words: [...words], patterns: [...patterns], frequency, unavailable };
}
