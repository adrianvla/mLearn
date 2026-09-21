/** Main-owned V09 lifecycle wrapper. Renderer windows never own this engine. */

import { getInferencePolicy } from '../../shared/inferencePolicy';
import { livingWorldEnabled } from '../../shared/livingWorld';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';
import { loadSettings } from './settings';
import { completeJob } from './llmRouter';
import { loadWorld } from './worldStore';
import { consolidateContext } from './dreamerRuntime';
import {
  AUTONOMY_LIMITS,
  reconcilePendingAutonomy,
  runAutonomyPass,
  type AutonomyPassResult,
} from './autonomyService';

const log = getLogger('autonomyRuntime');

export const MAX_CONCURRENT_AUTONOMY_INFERENCE = 1;
export const MAX_AUTONOMY_RECOVERY_ROOMS = 4;

let active: { roomId: string; controller: AbortController; done: Promise<AutonomyPassResult> } | undefined;

function enabled(settings: Settings): boolean {
  return livingWorldEnabled(settings)
    && (settings.worldAutonomyEnabled ?? DEFAULT_SETTINGS.worldAutonomyEnabled);
}

export async function runRoomAutonomy(roomId: string): Promise<AutonomyPassResult> {
  const settings = loadSettings();
  if (!enabled(settings)) return { kind: 'waiting' };
  if (active) return active.roomId === roomId ? active.done : { kind: 'waiting' };
  const profile = getUserDataPath();
  const controller = new AbortController();
  const done = runAutonomyPass(roomId, {
    policy: getInferencePolicy(settings),
    getSettings: loadSettings,
    llmFn: async (prompt) => {
      const current = loadSettings();
      if (!enabled(current) || profile !== getUserDataPath() || controller.signal.aborted) {
        throw new Error('Autonomy policy changed');
      }
      return completeJob(
        [{ role: 'user', content: prompt }],
        controller.signal,
        AUTONOMY_LIMITS.outputCharacters,
        'background',
      );
    },
  }).then(async (result) => {
    if (result.kind === 'committed') {
      // Ordinary V08 machinery consumes the new canonical occurrence. If the
      // process stops here, the next scheduler/startup pass heals this derived
      // work without duplicating the authoritative occurrence.
      await consolidateContext({ roomId }, { getSettings: loadSettings });
    }
    return result;
  }).catch((error): AutonomyPassResult => {
    log.error('Autonomy pass failed', roomId, error);
    return { kind: 'failed' };
  }).finally(() => {
    if (active?.controller === controller) active = undefined;
  });
  active = { roomId, controller, done };
  return done;
}

export async function reconcilePendingAutonomyRuntime(): Promise<void> {
  if (!enabled(loadSettings())) return;
  const recovered = new Set(await reconcilePendingAutonomy());
  const world = await loadWorld();
  // A crash may land after the authoritative world.json commit but before the
  // caller schedules V08 reflection. Revisit a bounded set of newest committed
  // episode Rooms on startup; maintenance markers make this exact replay a
  // no-op once their consequences have already been projected.
  const roomIds = [...new Set((world.autonomyJobs ?? [])
    .filter(job => recovered.has(job.jobId) || (job.status === 'committed' && job.result === 'episode'))
    .sort((a, b) => (b.settledAt ?? b.createdAt) - (a.settledAt ?? a.createdAt))
    .map(job => job.roomId))]
    .slice(0, MAX_AUTONOMY_RECOVERY_ROOMS);
  for (const roomId of roomIds) await consolidateContext({ roomId }, { getSettings: loadSettings });
}

export function cancelAllAutonomy(): void {
  active?.controller.abort();
}
