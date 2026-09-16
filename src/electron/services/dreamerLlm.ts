/** Maintenance uses the same bounded, cancellable provider queue as foreground work. */
import { completeJob } from './llmRouter';

export const MAINTENANCE_OUTPUT_CHARACTERS = 12000;
export const MAINTENANCE_INPUT_CHARACTERS = 32000;

export async function complete(prompt: string, signal: AbortSignal = new AbortController().signal): Promise<string> {
  if (prompt.length > MAINTENANCE_INPUT_CHARACTERS) throw new Error('Maintenance input exceeds its context budget');
  return completeJob([{ role: 'user', content: prompt }], signal, MAINTENANCE_OUTPUT_CHARACTERS);
}
