/**
 * Automatic scoped reflection/evolution lifecycle (V08).
 *
 * Entry points (all main-owned, policy-gated, deduplicated):
 * - Post-encounter: the conversation surface fires WORLD_TRIGGER_REFLECTION
 *   after a completed foreground turn; the current context (persistent Room
 *   Sea or sandbox Thread journal) is consolidated and the situation evolves.
 * - Idle/maintenance: the scheduler drives persistent Rooms while the app runs.
 * - Recovery: pending maintenance records from an interrupted run are finished
 *   from the durable ledger at startup.
 *
 * Repeat calls are safe: consolidation markers make each pass idempotent,
 * in-flight runs are excluded, and cancellable operations (MEM-02) abort at
 * phase boundaries when the app quits or a sandbox Thread is deleted.
 */

import { getLogger } from '../../shared/utils/logger';
import { getInferencePolicy } from '../../shared/inferencePolicy';
import { WORLD_CONTINUITY_ID } from '../../shared/world';
import { livingWorldEnabled } from '../../shared/livingWorld';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import { loadSettings } from './settings';
import { getUserDataPath } from '../utils/platform';
import { runReflection, reconcilePendingReflections } from './dreamerService';
import { evolveScenario, reconcilePendingScenarioEvolutions } from './scenarioDirector';
import { complete } from './dreamerLlm';
import { loadWorld } from './worldStore';

const log = getLogger('dreamerRuntime');

export interface DreamerRuntimeDeps {
  getSettings: () => Settings;
}

/** What one foreground/maintenance pass may touch. A sandbox Thread is a
 *  distinct context from its Room; reflection output stays thread-local. */
export interface ReflectionTarget {
  roomId: string;
  threadId?: string;
}

export interface MaintenanceContext {
  roomId: string;
  scopeKind: 'sea' | 'thread';
  threadId?: string;
}

const inFlight = new Map<string, { controller: AbortController; done: Promise<void> }>();

/** Resolve the journal context for a trigger. A sandbox Thread reflects on its
 *  own journal; a Room-linked Thread reflects on the Room's Sea stream. */
async function resolveContext(target: ReflectionTarget): Promise<MaintenanceContext | null> {
  const world = await loadWorld();
  if (target.threadId !== undefined) {
    const thread = world.threads.find(item => item.id === target.threadId);
    if (!thread) return null;
    if (thread.sandbox) return { roomId: thread.id, scopeKind: 'thread', threadId: thread.id };
    if (!thread.roomId) return null;
    return { roomId: thread.roomId, scopeKind: 'thread', threadId: thread.id };
  }
  const roomOrContinuity = target.roomId === WORLD_CONTINUITY_ID || world.rooms.some(room => room.id === target.roomId);
  return roomOrContinuity ? { roomId: target.roomId, scopeKind: 'sea' } : null;
}

async function runMaintenance(context: MaintenanceContext, deps: DreamerRuntimeDeps, signal: AbortSignal): Promise<void> {
  const profile = getUserDataPath();
  const settings = deps.getSettings();
  // Living World consent gates every pass (Sea rooms and sandbox Threads
  // alike, including WORLD_TRIGGER_REFLECTION) before any policy or model work.
  if (!livingWorldEnabled(settings)) return;
  const policy = getInferencePolicy(settings);
  if (!(settings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled) || !policy.isPermitted('dreamer')) return;
  const llmFn = (prompt: string): Promise<string> => {
    if (!livingWorldEnabled(deps.getSettings()) || profile !== getUserDataPath() || !(deps.getSettings().llmEnabled ?? DEFAULT_SETTINGS.llmEnabled) || !getInferencePolicy(deps.getSettings()).isPermitted('dreamer')) throw new Error('Maintenance policy changed');
    return complete(prompt, signal);
  };
  await runReflection(context, { policy, llmFn, signal });
  if (!livingWorldEnabled(deps.getSettings()) || profile !== getUserDataPath() || signal.aborted || !getInferencePolicy(deps.getSettings()).isPermitted('dreamer')) return;
  await evolveScenario(context, { policy, llmFn, signal });
}

export async function consolidateContext(target: ReflectionTarget, deps: DreamerRuntimeDeps): Promise<void> {
  const context = await resolveContext(target);
  if (!context) return;
  const key = `${context.roomId}:${context.scopeKind}:${context.threadId ?? ''}:${getUserDataPath()}`;
  const running = inFlight.get(key);
  if (running) return running.done;
  const controller = new AbortController();
  const done = runMaintenance(context, deps, controller.signal)
    .catch((error) => {
      // One context's failure must never propagate into the trigger's IPC path.
      log.error('Maintenance failed for context', context.roomId, error);
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, { controller, done });
  await done;
}

/** Sea-room consolidation after integration admission (existing trigger). */
export async function consolidateRoom(roomId: string, deps: DreamerRuntimeDeps): Promise<void> {
  await consolidateContext({ roomId }, deps);
}

/** Abort the in-flight pass for a context key (shutdown / context deletion). */
export function cancelMaintenanceContext(roomId: string): void {
  for (const [key, running] of inFlight.entries()) {
    if (key.startsWith(`${roomId}:`)) {
      running.controller.abort();

    }
  }
}

/** Abort every in-flight pass (app shutdown). */
export function cancelAllMaintenance(): void {
  for (const running of inFlight.values()) running.controller.abort();

}

/** Startup recovery: finish interrupted maintenance runs from the ledger.
 *  Threads-only defers recovery: nothing publishes into the persistent world
 *  without consent; pending records resolve on the next consented startup. */
export async function reconcilePendingMaintenance(): Promise<void> {
  if (!livingWorldEnabled(loadSettings())) return;
  try {
    await reconcilePendingReflections();
    await reconcilePendingScenarioEvolutions();
  } catch (error) {
    // Records stay pending and retryable; the failure is visible in the log.
    log.error('Maintenance recovery failed', error);
  }
}
