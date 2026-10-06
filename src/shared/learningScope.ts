import { activeLearningGoals, learningGoalsForSettings, type LearningGoal } from './learningGoals';
import { resolveLearningOutcome, type ResolvedLearningOutcome } from './learningOutcomes';
import { buildWordFrequencyMapFromLanguageData, resolveLanguageFrequencyPayload } from './languageFeatures';
import { DEFAULT_SETTINGS, type WordFrequencyMap, type LanguageData, type Settings } from './types';

export interface ResolvedLearningGoal extends LearningGoal {
  /** Derived package snapshot. Settings-owned scope/provenance/conditions stay untouched. */
  resolvedOutcome: ResolvedLearningOutcome;
}

/** One package-resolved target boundary for Home, Plan and activity policy. */
export function learningScopeForSettings(settings: Pick<Settings, 'learningGoals' | 'examGoal'> & { language?: string },
  data: LanguageData | null | undefined, language = settings.language ?? '') {
  const selected = activeLearningGoals(learningGoalsForSettings(settings), language);
  const goals: ResolvedLearningGoal[] = [];
  const words = new Set<string>();
  const patterns = new Set<string>();
  const unavailable: string[] = [];
  const frequency: WordFrequencyMap = {};
  for (const goal of selected) {
    const packageVersion = data?.languageData?.version;
    if (goal.outcomeRef?.packageVersion && goal.outcomeRef.packageVersion !== packageVersion) {
      unavailable.push(goal.id);
      continue;
    }
    const resolved = resolveLearningOutcome(data, goal.outcomeRef!.id, goal.outcomeRef!.groupIds);
    if (!resolved?.complete) { unavailable.push(goal.id); continue; }
    goals.push({ ...goal, outcome: resolved.declaration.label, resolvedOutcome: resolved });
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

/** Deliberately change preparation scope through the existing settings owner.
 * Assessment evidence and structured package outcomes are never rewritten here.
 */
export function learningTargetSettingsUpdate(
  settings: Pick<Settings, 'learningLanguageLevels' | 'frequencyProviderTargets' | 'frequencyProviderSelections'>,
  language: string,
  level: number | null,
  data?: LanguageData | null,
): Partial<Settings> {
  const providers = data?.frequencyProviders ?? {};
  const providerId = [settings.frequencyProviderSelections?.[language], data?.activeFrequencyProvider,
    data?.defaultFrequencyProvider, Object.keys(providers)[0]]
    .find((candidate): candidate is string => typeof candidate === 'string' && Object.prototype.hasOwnProperty.call(providers, candidate));
  const targets = settings.frequencyProviderTargets ?? DEFAULT_SETTINGS.frequencyProviderTargets;
  return {
    learningLanguageLevels: { ...(settings.learningLanguageLevels ?? DEFAULT_SETTINGS.learningLanguageLevels), [language]: level },
    ...(providerId ? { frequencyProviderTargets: { ...targets,
      [language]: { ...targets[language], [providerId]: level } } } : {}),
  };
}
