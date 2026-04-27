import { getPlatform } from '@shared/platform';
import { setLogSink, type LogSink } from '@shared/utils/logger';
import { getBridge } from '@shared/bridges';

let installed = false;

export function installRendererLogSink(): void {
  if (installed) return;
  installed = true;

  if (getPlatform() !== 'electron') return;

  const bridge = getBridge();
  const sink: LogSink = {
    write(record) {
      try {
        bridge.server.sendLogRecord(record);
      } catch {
        /* bridge missing or IPC closed; logger console fallback already ran */
      }
    },
  };
  setLogSink(sink);
}
