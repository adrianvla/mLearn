import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { RuntimeToolObservation } from '../../shared/runtimeInspection';
import { runtimeTrace, subscribeRuntimeCapture } from './runtimeTraceService';
import { subscribeWorldChanges } from './worldChanges';
import { loadWorld, withWorldMutation } from './worldStore';
import { getLogger } from '../../shared/utils/logger';
const log = getLogger('runtimeInspection');

export function setupRuntimeInspectionIPC(): void {
  const broadcast = (channel: string, payload?: unknown): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        try { window.webContents.send(channel, payload); } catch { /* Window closed during delivery. */ }
      }
    }
  };
  subscribeWorldChanges(notice => broadcast(IPC_CHANNELS.WORLD_CHANGED, notice));
  subscribeRuntimeCapture(() => broadcast(IPC_CHANNELS.RUNTIME_TRACE_CHANGED));
  ipcMain.handle(IPC_CHANNELS.RUNTIME_TRACE_LIST, () => runtimeTrace().list());
  ipcMain.handle(IPC_CHANNELS.RUNTIME_TRACE_GET, (_event, id: string) => runtimeTrace().get(id));
  ipcMain.handle(IPC_CHANNELS.RUNTIME_TRACE_CLEAR, () => { runtimeTrace().clear(); });
  ipcMain.handle(IPC_CHANNELS.RUNTIME_WORLD_GET, async () => {
    if (!runtimeTrace().list().enabled) throw new Error('Developer mode is disabled');
    // Developer inspection includes pending/prepared records, explicitly separate
    // from the canonical product projection returned by getWorldState().
    return withWorldMutation(async () => {
      if (!runtimeTrace().list().enabled) throw new Error('Developer mode is disabled');
      return loadWorld();
    });
  });
  ipcMain.on(IPC_CHANNELS.RUNTIME_TRACE_TOOL, (event, observation: RuntimeToolObservation) => {
    try {
      const store = runtimeTrace();
      if (!store.list().enabled || !observation || typeof observation.id !== 'string'
        || observation.id.length > 160 || typeof observation.name !== 'string'
        || !observation.context || typeof observation.context.source !== 'string') return;
      // Renderer observations cannot overwrite a main-owned inference record.
      const id = `tool:${event.sender.id}:${observation.id}`;
      if (observation.status === 'running') {
        store.begin({ id, kind: 'tool', context: observation.context,
          input: { name: observation.name, arguments: observation.arguments } }); store.start(id);
      } else if (observation.status === 'completed' || observation.status === 'failed') {
        store.finish(id, observation.status, { result: observation.result, error: observation.error });
      }
    } catch (error) { log.warn('Could not capture tool observation', error); }
  });
}
