/**
 * Bounded IPC frequency instrumentation (main process).
 *
 * Active only when MLEARN_PERF_DIR is set (perf harness). Wraps
 * ipcMain.handle/on registration to count invocations per channel and
 * periodically dumps { channel: { calls, payloadChars } } to
 * $MLEARN_PERF_DIR/ipc-main.json so a renderer-side CDP session can
 * correlate main-side traffic with renderer counters. Zero effect in
 * normal runs.
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

interface IpcMainInvokeEventLike {
  // structurally sufficient for passthrough; no fields are read here
}

interface IpcMainEventLike {
  // structurally sufficient for passthrough; no fields are read here
}

type InvokeListener = (event: IpcMainInvokeEventLike, ...args: never[]) => unknown;
type OnListener = (event: IpcMainEventLike, ...args: never[]) => void;

interface ChannelStats {
  calls: number;
  payloadChars: number;
}

const perfDir = process.env.MLEARN_PERF_DIR;
const channels = new Map<string, ChannelStats>();
let lastFlushAt = Date.now();

let flushTimer: ReturnType<typeof setInterval> | null = null;

function record(channel: string, payloadChars: number): void {
  let entry = channels.get(channel);
  if (!entry) {
    entry = { calls: 0, payloadChars: 0 };
    channels.set(channel, entry);
  }
  entry.calls += 1;
  entry.payloadChars += payloadChars;
}

function flush(): void {
  if (!perfDir) return;
  try {
    fs.mkdirSync(perfDir, { recursive: true });
    const snapshot: Record<string, ChannelStats> = {};
    for (const [channel, entry] of channels) {
      snapshot[channel] = { ...entry };
    }
    fs.writeFileSync(
      path.join(perfDir, 'ipc-main.json'),
      JSON.stringify({ savedAt: Date.now(), since: lastFlushAt, channels: snapshot }, null, 2),
    );
    lastFlushAt = Date.now();
    channels.clear();
  } catch {
    // instrumentation must never break the app
  }
}

export function installPerfIpcCounters(): void {
  if (!perfDir) return;
  const mainWithWrap = ipcMain as unknown as {
    handle: (channel: string, listener: InvokeListener) => void;
    on: (channel: string, listener: OnListener) => void;
  };
  const originalHandle = mainWithWrap.handle.bind(ipcMain);
  mainWithWrap.handle = (channel: string, listener: InvokeListener) => {
    const wrapped = (event: IpcMainInvokeEventLike, ...args: never[]): unknown => {
      record(channel, JSON.stringify(args ?? []).length);
      return listener(event, ...args);
    };
    return originalHandle(channel, wrapped as InvokeListener);
  };
  const originalOn = mainWithWrap.on.bind(ipcMain);
  mainWithWrap.on = (channel: string, listener: OnListener) => {
    const wrapped = (event: IpcMainEventLike, ...args: never[]): void => {
      record(channel, 0);
      return listener(event, ...args);
    };
    return originalOn(channel, wrapped as OnListener);
  };
  flushTimer = setInterval(flush, 5000);
  flushTimer.unref?.();
}
