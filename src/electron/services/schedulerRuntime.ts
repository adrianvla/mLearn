import { powerMonitor } from 'electron';
import { getLogger } from '../../shared/utils/logger';
import { livingWorldEnabled } from '../../shared/livingWorld';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { loadSettings } from './settings';
import { loadWorld } from './worldStore';
import { consolidateContext } from './dreamerRuntime';
import { runRoomAutonomy } from './autonomyRuntime';
import { reconcileRoomContactDelivery, runRoomContact } from './contactRuntime';

const log = getLogger('schedulerRuntime');
const RECONCILE_INTERVAL_MS = 60_000;
export const MAX_SCHEDULER_MAINTENANCE_ROOMS = 8;
export const MAX_AUTONOMY_JOBS_PER_RECONCILE = 2;
export const MAX_CONTACT_ROOMS_PER_RECONCILE = 1;

let timer: ReturnType<typeof setInterval> | undefined;
let maintenanceRoomCursor = 0;
let autonomyRoomCursor = 0;
let contactRoomCursor = 0;
let reconcilePromise: Promise<void> | undefined;

function nextMaintenanceRooms<T>(rooms: T[]): T[] {
  if (rooms.length === 0) return [];
  const count = Math.min(rooms.length, MAX_SCHEDULER_MAINTENANCE_ROOMS);
  const start = maintenanceRoomCursor % rooms.length;
  const selected = Array.from({ length: count }, (_, offset) => rooms[(start + offset) % rooms.length]);
  maintenanceRoomCursor = (start + count) % rooms.length;
  return selected;
}

function nextAutonomyRooms<T>(rooms: T[]): T[] {
  if (rooms.length === 0) return [];
  const count = Math.min(rooms.length, MAX_AUTONOMY_JOBS_PER_RECONCILE);
  const start = autonomyRoomCursor % rooms.length;
  const selected = Array.from({ length: count }, (_, offset) => rooms[(start + offset) % rooms.length]);
  autonomyRoomCursor = (start + count) % rooms.length;
  return selected;
}

function nextContactRooms<T>(rooms: T[]): T[] {
  if (rooms.length === 0) return [];
  const count = Math.min(rooms.length, MAX_CONTACT_ROOMS_PER_RECONCILE);
  const start = contactRoomCursor % rooms.length;
  const selected = Array.from({ length: count }, (_, offset) => rooms[(start + offset) % rooms.length]);
  contactRoomCursor = (start + count) % rooms.length;
  return selected;
}

async function reconcileAllOnce(): Promise<void> {
  // Threads-only (consent off): no proactive initiative and no autonomous
  // world participation of any kind — the whole pass is skipped, including
  // the proactive notification reconcile. proactivityEnabled stays as the
  // fine-grained control WITHIN Living World.
  if (!livingWorldEnabled(loadSettings())) return;
  try {
    const world = await loadWorld();
    const contactRooms = nextContactRooms(world.rooms);
    const attemptedContactRooms = new Set<string>();
    // V10 delivery reconciliation runs before new inference so a contact
    // committed immediately before a crash is recovered without generating a
    // replacement. Each attempt uses the stable contact id as the OS id.
    for (const room of contactRooms) {
      try {
        const result = await reconcileRoomContactDelivery(room.id);
        if (result.attempted.length > 0 || result.unavailable.length > 0) attemptedContactRooms.add(room.id);
      } catch (error) {
        log.error('Contact delivery reconcile failed for room', room.id, error);
      }
    }
    // V09 autonomy is separate from V10 delivery reconciliation above. It
    // cannot create schedules, notifications, calls, or user-facing contact.
    // One main-owned pass considers a small fair Room subset and performs at
    // most one durable job per Room, serially (foreground queue priority is
    // enforced by llmRouter).
    const settings = loadSettings();
    if (settings.worldAutonomyEnabled ?? DEFAULT_SETTINGS.worldAutonomyEnabled) {
      for (const room of nextAutonomyRooms(world.rooms)) await runRoomAutonomy(room.id);
    }
    // One fair Room per pass may decide to contact the user from an existing
    // canonical cause. No-contact is a valid result. A newly ready contact is
    // delivered only after its journal row and ledger commit both exist.
    if (settings.proactivityEnabled ?? DEFAULT_SETTINGS.proactivityEnabled) {
      for (const room of contactRooms) {
        await runRoomContact(room.id);
        // Recovery plus newly-created work share one external side-effect
        // budget for this selected Room in a scheduler pass.
        if (!attemptedContactRooms.has(room.id)) await reconcileRoomContactDelivery(room.id);
      }
    }
    // Idle/maintenance opportunities (MEM-02/LIFE-03): persistent Rooms with
    // eligible unconsolidated activity are reflected/evolved. Sandbox Threads
    // are never driven from here; policy gates bound the spend. No eligible
    // work means no model call (each pass no-ops on an empty window).
    for (const room of nextMaintenanceRooms(world.rooms)) {
      void consolidateContext({ roomId: room.id }, { getSettings: loadSettings });
    }
  } catch (error) {
    log.error('Scheduler failed to load world', error);
  }
}

async function reconcileAll(): Promise<void> {
  if (reconcilePromise) return reconcilePromise;
  const running = reconcileAllOnce().finally(() => {
    if (reconcilePromise === running) reconcilePromise = undefined;
  });
  reconcilePromise = running;
  return running;
}

function onSuspend(): void {
  void reconcileAll();
}

function onResume(): void {
  void reconcileAll();
}

export function startScheduler(): void {
  if (timer !== undefined) return;
  timer = setInterval(() => void reconcileAll(), RECONCILE_INTERVAL_MS);
  powerMonitor.on('suspend', onSuspend);
  powerMonitor.on('resume', onResume);
  void reconcileAll();
}

export function stopScheduler(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  maintenanceRoomCursor = 0;
  autonomyRoomCursor = 0;
  contactRoomCursor = 0;
  reconcilePromise = undefined;
  powerMonitor.removeListener('suspend', onSuspend);
  powerMonitor.removeListener('resume', onResume);
}
