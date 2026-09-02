/**
 * Post-session Dreamer consolidation entry point. Event-driven: fired after a
 * thread integration completes. No timers, no startup sweep; repeat calls are
 * safe because consolidation markers make runDreamer idempotent.
 */

import { getLogger } from '../../shared/utils/logger';
import { getInferencePolicy } from '../../shared/inferencePolicy';
import type { Settings } from '../../shared/types';
import { runDreamer } from './dreamerService';
import { complete } from './dreamerLlm';

const log = getLogger('dreamerRuntime');

export interface DreamerRuntimeDeps {
  getSettings: () => Settings;
}

const inFlight = new Set<string>();

export async function consolidateRoom(roomId: string, deps: DreamerRuntimeDeps): Promise<void> {
  if (inFlight.has(roomId)) return;
  inFlight.add(roomId);
  try {
    const policy = getInferencePolicy(deps.getSettings());
    if (!policy.isPermitted('dreamer')) return;
    await runDreamer(roomId, { policy, llmFn: complete });
  } catch (error) {
    // One room's failure must never propagate into the trigger's IPC path.
    log.error('Dreamer failed for room', roomId, error);
  } finally {
    inFlight.delete(roomId);
  }
}
