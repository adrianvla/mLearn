import type { LLMApplicationTask, LLMChatMessage, Settings } from './types';

/** Matches management login/group readiness; URL overrides denote school endpoints. */
export function usesManagedLlm(settings: Pick<Settings, 'overrideCloudEndpointUrl' | 'cloudApiUrl'>): boolean {
  return settings.overrideCloudEndpointUrl && settings.cloudApiUrl.trim().length > 0;
}

/** Keep local prompting intact while declaring the task's non-policy meaning explicitly. */
export function applicationTaskMessage(
  operation: string,
  instruction: string,
  context: LLMApplicationTask['context'] = {},
  localSystemPrompt: string = instruction,
): LLMChatMessage {
  return { role: 'system', content: localSystemPrompt, applicationTask: { operation, instruction, context } };
}
