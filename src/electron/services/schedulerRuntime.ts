import { Notification, powerMonitor } from 'electron';
import { getLogger } from '../../shared/utils/logger';
import { loadSettings } from './settings';
import { createSchedulerService } from './schedulerService';
import { loadWorld } from './worldStore';
import { openRoomAt } from './worldIpc';

const log = getLogger('schedulerRuntime');
const RECONCILE_INTERVAL_MS = 60_000;

type SchedulerService = ReturnType<typeof createSchedulerService>;

let timer: ReturnType<typeof setInterval> | undefined;
let service: SchedulerService | undefined;

async function reconcileAll(): Promise<void> {
  if (!service) return;
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
  } catch (error) {
    log.error('Scheduler failed to load world', error);
  }
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
  powerMonitor.removeListener('suspend', onSuspend);
  powerMonitor.removeListener('resume', onResume);
}
