import { Notification, powerMonitor } from 'electron';
import { getLogger } from '../../shared/utils/logger';
import { livingWorldEnabled } from '../../shared/livingWorld';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { loadSettings } from './settings';
import { createSchedulerService } from './schedulerService';
import { loadWorld } from './worldStore';
import { openRoomAt } from './worldIpc';
import { consolidateContext } from './dreamerRuntime';
import { runRoomAutonomy } from './autonomyRuntime';

const log = getLogger('schedulerRuntime');
const RECONCILE_INTERVAL_MS = 60_000;
export const MAX_SCHEDULER_MAINTENANCE_ROOMS = 8;
export const MAX_AUTONOMY_JOBS_PER_RECONCILE = 2;

type SchedulerService = ReturnType<typeof createSchedulerService>;

let timer: ReturnType<typeof setInterval> | undefined;
let service: SchedulerService | undefined;
let maintenanceRoomCursor = 0;
let autonomyRoomCursor = 0;
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

async function reconcileAllOnce(): Promise<void> {
  if (!service) return;
  // Threads-only (consent off): no proactive initiative and no autonomous
  // world participation of any kind — the whole pass is skipped, including
  // the proactive notification reconcile. proactivityEnabled stays as the
  // fine-grained control WITHIN Living World.
  if (!livingWorldEnabled(loadSettings())) return;
  try {
    const world = await loadWorld();
    for (const room of world.rooms) {
      try {
        const result = await service.reconcile(room.id);
        if (result.fired.length > 0 || result.suppressed.length > 0) {
          log.info('Scheduler reconciled room', room.id, result);
        }
      } catch (error) {
        log.error('Scheduler reconcile failed for room', room.id, error);
      }
    }
    // V09 autonomy is separate from the legacy delivery scheduler above. It
    // cannot create schedules, notifications, calls, or user-facing contact.
    // One main-owned pass considers a small fair Room subset and performs at
    // most one durable job per Room, serially (foreground queue priority is
    // enforced by llmRouter).
    const settings = loadSettings();
    if (settings.worldAutonomyEnabled ?? DEFAULT_SETTINGS.worldAutonomyEnabled) {
      for (const room of nextAutonomyRooms(world.rooms)) await runRoomAutonomy(room.id);
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
  service = createSchedulerService({
    now: () => Date.now(),
    notify: (title, body, roomId) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body });
      notification.on('click', () => openRoomAt({ roomId }));
      notification.show();
    },
    getSettings: () => loadSettings(),
    openRoomEvent: (roomId, callId) => openRoomAt({ roomId, callId }),
  });
  timer = setInterval(() => void reconcileAll(), RECONCILE_INTERVAL_MS);
  powerMonitor.on('suspend', onSuspend);
  powerMonitor.on('resume', onResume);
  void reconcileAll();
}

export function stopScheduler(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  service = undefined;
  maintenanceRoomCursor = 0;
  autonomyRoomCursor = 0;
  reconcilePromise = undefined;
  powerMonitor.removeListener('suspend', onSuspend);
  powerMonitor.removeListener('resume', onResume);
}
