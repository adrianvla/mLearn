import type { TutorSessionConfig } from '../../shared/types';

/** Learner-authored practice request, persisted by the existing scenario/thread intent owner. */
export function tutorSessionIntent(config: TutorSessionConfig): string {
  const parts = [config.customInstructions.trim()];
  if (config.selectedWords.length) parts.push(`Words selected for practice (not evidence of difficulty): ${config.selectedWords.map(item => item.word).join(', ')}`);
  if (config.selectedGrammar.length) parts.push(`Grammar selected for practice (not evidence of difficulty): ${config.selectedGrammar.map(item => `${item.pattern}: ${item.meaning}`).join('; ')}`);
  for (const media of config.selectedMedia) {
    parts.push(`Practise material from ${media.mediaName}.`);
    if (media.failedWords.length) parts.push(`Previously difficult words from this material (recheck current knowledge): ${media.failedWords.map(item => item.word).join(', ')}`);
    if (media.failedGrammar.length) parts.push(`Previously difficult grammar from this material (recheck current knowledge): ${media.failedGrammar.map(item => item.pattern).join(', ')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}
