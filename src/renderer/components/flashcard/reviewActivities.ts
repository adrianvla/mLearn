import type { Flashcard, LanguageData, LanguageReviewActivity, Settings } from '../../../shared/types';
import { getAvailableAccesses } from '../../../shared/types';
import { getTestedAccesses, getProsodyPositionLabel } from '../../../shared/languageFeatures';
import { providedAccessScaffolds } from '../../../shared/knowledgeEvents';
import type { LearningTaskSnapshot } from '../../../shared/learningDecision';
import type { AccessStatusResult } from '../../utils/accessKnowledge';

export interface ReviewActivity extends Omit<LanguageReviewActivity, 'kind'> {
  id: string;
  kind: 'holistic' | LanguageReviewActivity['kind'];
}

/** Resource availability is explicit; absent resources never become an alternate cue. */
export function eligibleReviewActivities(card: Flashcard, data: LanguageData | null | undefined,
  preferences: Settings['reviewActivities'], audioAvailable: boolean,
  labels?: { focused: string; focusedTarget: string; focusedPrompt: (target: string) => string; audio: string; audioPrompt: string }): ReviewActivity[] {
  const result: ReviewActivity[] = [];
  if (preferences.holistic) result.push({ id: 'holistic', kind: 'holistic', label: '', prompt: '', targets: [...getTestedAccesses({
    languageData: data, surface: card.content.front,
    hasReadingData: !!card.content.reading && card.content.reading !== card.content.front,
    hasProsodyData: !!card.content.prosody && (card.content.prosody.position !== undefined || !!card.content.prosody.display),
    taskType: 'srs-review',
  })] });
  const available = getAvailableAccesses(data ?? undefined);
  // Older installed packages already declare the necessary representation capabilities.
  // The two shipped presentation mechanisms can use those declarations without a catalog upgrade.
  const builtins: Record<string, LanguageReviewActivity> = {};
  if (labels && available.includes('prosodic-pattern')) {
    const targetLabel = data?.learning?.capabilities?.['prosodic-pattern']?.label ?? getProsodyPositionLabel(data) ?? labels.focusedTarget;
    builtins['written-reading-recall'] = { kind: 'written-reading-recall', label: targetLabel,
      prompt: labels.focusedPrompt(targetLabel), targets: ['prosodic-pattern'] };
  }
  if (labels && available.includes('spoken-recognition')) builtins['audio-recognition'] = {
    kind: 'audio-recognition', label: labels.audio, prompt: labels.audioPrompt, targets: ['spoken-recognition'],
  };
  for (const [id, activity] of Object.entries(data?.learning?.reviewActivities ?? builtins)) {
    // Fail closed for unsupported package presentation kinds or malformed declarations.
    if (!activity || typeof activity.label !== 'string' || typeof activity.prompt !== 'string'
      || !Array.isArray(activity.targets) || !activity.targets.length
      || activity.targets.some(target => typeof target !== 'string' || !target.trim())) continue;
    if (activity.kind === 'written-reading-recall' && preferences.focused && card.content.reading?.trim()
      && card.content.prosody && (Number.isFinite(card.content.prosody.position) || !!card.content.prosody.display?.trim())) {
      result.push({ ...activity, id, targets: [...activity.targets] });
    }
    if (activity.kind === 'audio-recognition' && preferences.audio && audioAvailable
      && card.content.front.trim() && card.content.back.trim()) result.push({ ...activity, id, targets: [...activity.targets] });
  }
  return result;
}

/** Ordinal selection preference, never calibrated mastery/confidence or evidence. */
export function selectReviewActivity(activities: readonly ReviewActivity[], state: (capability: string) => AccessStatusResult,
  now = Date.now()): ReviewActivity {
  if (!activities.length) throw new Error('No eligible review activity');
  const score = (activity: ReviewActivity) => activity.targets.reduce((sum, target) => {
    const access = state(target);
    const need = access.status === 'known' ? 0.2 : access.status === 'learning' ? 0.65 : 1;
    const age = access.lastStatusChange === undefined ? Infinity : Math.max(0, now - access.lastStatusChange);
    // Recorded recency pads recently practiced accesses; schedule admission remains authoritative.
    return sum + need * (age < 10 * 60_000 ? 0.2 : 1);
  }, 0) / activity.targets.length;
  return activities.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
}

export function activityTask(activity: ReviewActivity): LearningTaskSnapshot {
  return {
    taskTemplateId: activity.id,
    inputModality: activity.kind === 'audio-recognition' ? 'audio' : 'written-form',
    responseModality: 'self-assessment',
    supplied: activity.kind === 'audio-recognition' ? ['word-audio'] : activity.kind === 'written-reading-recall' ? ['written-form', 'reading'] : ['written-form'],
    requested: [...activity.targets], fluencyRequired: false, ratingMode: 'profile',
  };
}

export function activityScaffolds(activity: ReviewActivity) {
  return activity.kind === 'written-reading-recall'
    ? { reading: true, ...providedAccessScaffolds(['surface-recognition', 'surface-reading']) }
    : activity.kind === 'audio-recognition' ? { audio: true } : {};
}
