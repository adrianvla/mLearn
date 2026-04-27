import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { IPC_CHANNELS } from '../../shared/constants';
import {
  getLogger,
  serializeRecord,
  setLogSink,
  type LogRecord,
  type LogSink,
} from '../../shared/utils/logger';
import { getUserDataPath } from '../utils/platform';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const BACKUP_COUNT = 5;

interface RotatingFile {
  readonly path: string;
  size: number;
}

const files = new Map<string, RotatingFile>();
let logDir: string | null = null;
let crashLogPath: string | null = null;
let installed = false;

function ensureDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function rotate(file: RotatingFile): void {
  for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
    const src = `${file.path}.${i}`;
    const dst = `${file.path}.${i + 1}`;
    if (fs.existsSync(src)) {
      try { fs.renameSync(src, dst); } catch { /* swallow */ }
    }
  }
  if (fs.existsSync(file.path)) {
    try { fs.renameSync(file.path, `${file.path}.1`); } catch { /* swallow */ }
  }
  file.size = 0;
}

function getFile(name: string): RotatingFile | null {
  if (!logDir) return null;
  let file = files.get(name);
  if (!file) {
    const fpath = path.join(logDir, name);
    let size = 0;
    try { size = fs.statSync(fpath).size; } catch { /* new file */ }
    file = { path: fpath, size };
    files.set(name, file);
  }
  return file;
}

function appendLine(name: string, line: string): void {
  const file = getFile(name);
  if (!file) return;
  const buf = Buffer.from(`${line}\n`, 'utf8');
  if (file.size + buf.length > MAX_FILE_BYTES) rotate(file);
  try {
    fs.appendFileSync(file.path, buf);
    file.size += buf.length;
  } catch {
    /* disk full, permissions, etc. — never crash on logging */
  }
}

function fileNameForRecord(record: LogRecord, defaultName: string): string {
  if (record.module.startsWith('renderer.') || record.module === 'renderer') {
    return 'renderer.log';
  }
  if (record.module.startsWith('python.') || record.module === 'python') {
    return 'python-mirror.log';
  }
  return defaultName;
}

function formatHumanLine(record: LogRecord, source: string): string {
  const d = new Date(record.ts);
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  const ts =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  let line = `${ts} ${record.level.padEnd(5)} [${source}/${record.module}] ${record.msg}`;
  if (record.stack) line += `\n${record.stack}`;
  return line;
}

const mainSink: LogSink = {
  write(record) {
    const target = fileNameForRecord(record, 'electron.log');
    appendLine(target, formatHumanLine(record, 'main'));
  },
};

function writeRendererRecord(record: LogRecord): void {
  appendLine('renderer.log', formatHumanLine(record, 'renderer'));
}

function writeCrashRecord(header: string, body: string): void {
  if (!crashLogPath) return;
  const ts = new Date().toISOString();
  const block =
    `\n${'='.repeat(70)}\n` +
    `[${ts}] ${header}\n` +
    `pid=${process.pid} node=${process.version} platform=${os.platform()} arch=${os.arch()}\n` +
    `${'='.repeat(70)}\n${body}\n`;
  try {
    fs.appendFileSync(crashLogPath, block);
  } catch {
    /* swallow */
  }
  try {
    process.stderr.write(block);
  } catch {
    /* swallow */
  }
}

function isLogRecord(value: unknown): value is LogRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.level === 'string' &&
    typeof r.module === 'string' &&
    typeof r.ts === 'number' &&
    typeof r.msg === 'string'
  );
}

export function setupLoggingService(): void {
  if (installed) return;
  installed = true;

  const userData = getUserDataPath();
  const dir = path.join(userData, 'logs');
  if (!ensureDir(dir)) {
    process.stderr.write(`[logging] failed to create ${dir}\n`);
    return;
  }
  logDir = dir;
  crashLogPath = path.join(dir, 'electron_crash.log');

  setLogSink(mainSink);

  ipcMain.on(IPC_CHANNELS.LOG_RECORD, (_event, payload: unknown) => {
    if (!isLogRecord(payload)) return;
    writeRendererRecord(payload);
    try {
      process.stdout.write(`${serializeRecord(payload)}\n`);
    } catch {
      /* swallow */
    }
  });

  const log = getLogger('electron.lifecycle');

  process.on('uncaughtException', (err) => {
    const body = err.stack || `${err.name}: ${err.message}`;
    writeCrashRecord(`UNCAUGHT EXCEPTION: ${err.name}: ${err.message}`, body);
    getLogger('electron.crash').fatal(`uncaughtException: ${err.message}`, err);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    const body = err.stack || `${err.name}: ${err.message}`;
    writeCrashRecord(`UNHANDLED REJECTION: ${err.name}: ${err.message}`, body);
    getLogger('electron.crash').error(`unhandledRejection: ${err.message}`, err);
  });

  app.on('render-process-gone', (_event, _wc, details) => {
    writeCrashRecord(
      `RENDERER GONE: reason=${details.reason} exitCode=${details.exitCode}`,
      JSON.stringify(details, null, 2),
    );
    getLogger('electron.crash').error(
      `renderer-process-gone reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });

  app.on('child-process-gone', (_event, details) => {
    writeCrashRecord(
      `CHILD PROCESS GONE: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
      JSON.stringify(details, null, 2),
    );
    getLogger('electron.crash').error(
      `child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });

  log.info(`logging initialised dir=${dir}`);
}

export function getLogDir(): string | null {
  return logDir;
}

export function getCrashLogPath(): string | null {
  return crashLogPath;
}
