/**
 * Living World consent — the single authoritative boundary between
 * Threads-only use and the persistent living world.
 *
 * Threads-only (consent off): deliberate Conversation tool use only. No
 * persistent social/persona inference, no Sea admission, no persistent
 * relationship development, no persistent Dreamer/reflection, no autonomous
 * world participation, no proactive initiative. Disposable Threads remain
 * fully usable.
 *
 * Living World (consent on): the coherent persistent system as a whole —
 * Rooms, reflection, scenario evolution, relationships, open loops. There is
 * deliberately NO per-feature matrix: partial worlds would be incoherent.
 *
 * Enforcement is main-process-side at the few entry points that create or
 * extend persistent world state (worldIpc, integration, journal IPC,
 * dreamerRuntime, schedulerRuntime). UI checks only route the user to consent;
 * they are never the boundary.
 */

import type { Settings } from './types';

export type LivingWorldSettings = Pick<Settings, 'livingWorldEnabled'>;

export const LIVING_WORLD_DISABLED_ERROR =
  'Living World is disabled: this operation would extend your persistent world. Enable Living World to continue.';

export function livingWorldEnabled(settings: LivingWorldSettings | undefined): boolean {
  return settings?.livingWorldEnabled === true;
}

/** Main-side gate for persistent world state mutations. Throws with the
 *  user-facing consent message so renderer surfaces can explain the boundary. */
export function requireLivingWorld(settings: LivingWorldSettings | undefined): void {
  if (!livingWorldEnabled(settings)) throw new Error(LIVING_WORLD_DISABLED_ERROR);
}
