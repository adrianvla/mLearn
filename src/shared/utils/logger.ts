/**
 * Universal structured logger for renderer + Electron main + tethered web.
 *
 * Mirrors the Python backend protocol:
 *   ::STATUS::v2::<LEVEL>::<MODULE>::<TS>::<MESSAGE>
 *
 * One transport per environment installs a {@link LogSink} via {@link setLogSink}:
 *   - renderer       -> forwards records to Electron main via IPC `LOG_RECORD`
 *   - Electron main  -> appends to rotating files under `<userData>/logs/`
 *   - capacitor/web  -> in-memory ring + console fallback
 *
 * Usage:
 *
 *     const log = getLogger("video.player");
 *     log.info("loaded {ms}ms", { ms: 142 });
 *     log.error("decode failed", err);
 */
import { LOG_PATTERN_PREFIX, LOG_PATTERN_VERSION } from '../constants';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogRecord {
  level: LogLevel;
  module: string;
  ts: number;
  msg: string;
  args?: unknown[];
  stack?: string;
}

export interface LogSink {
  write(record: LogRecord): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
};

const ROOT_NAMESPACE = 'mlearn';
const RING_LIMIT = 1000;

const ring: LogRecord[] = [];
let activeSink: LogSink | null = null;
let minLevel: LogLevel = 'DEBUG';

function ringAppend(record: LogRecord): void {
  ring.push(record);
  if (ring.length > RING_LIMIT) ring.shift();
}

function formatArg(arg: unknown): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') {
    return String(arg);
  }
  if (arg instanceof Error) {
    return arg.stack ? `${arg.name}: ${arg.message}\n${arg.stack}` : `${arg.name}: ${arg.message}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

function extractStack(args: unknown[]): string | undefined {
  for (const a of args) {
    if (a instanceof Error && a.stack) return a.stack;
  }
  return undefined;
}

function buildMessage(template: string, args: unknown[]): string {
  if (args.length === 0) return template;
  return `${template} ${args.map(formatArg).join(' ')}`;
}

function emit(level: LogLevel, module: string, template: string, args: unknown[]): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;

  const record: LogRecord = {
    level,
    module,
    ts: Date.now(),
    msg: buildMessage(template, args),
    stack: extractStack(args),
  };

  ringAppend(record);

  if (activeSink) {
    try {
      activeSink.write(record);
    } catch {
      consoleFallback(record);
    }
  } else {
    consoleFallback(record);
  }
}

function consoleFallback(record: LogRecord): void {
  const tag = `[${record.level} ${record.module}]`;
  const line = record.stack ? `${tag} ${record.msg}\n${record.stack}` : `${tag} ${record.msg}`;
  switch (record.level) {
    case 'DEBUG':
      console.debug(line);
      break;
    case 'INFO':
      console.info(line);
      break;
    case 'WARN':
      console.warn(line);
      break;
    case 'ERROR':
    case 'FATAL':
      console.error(line);
      break;
  }
}

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  fatal(msg: string, ...args: unknown[]): void;
  child(suffix: string): Logger;
}

function makeLogger(module: string): Logger {
  return {
    debug: (msg, ...args) => emit('DEBUG', module, msg, args),
    info: (msg, ...args) => emit('INFO', module, msg, args),
    warn: (msg, ...args) => emit('WARN', module, msg, args),
    error: (msg, ...args) => emit('ERROR', module, msg, args),
    fatal: (msg, ...args) => emit('FATAL', module, msg, args),
    child: (suffix) => makeLogger(`${module}.${suffix}`),
  };
}

export function getLogger(module = 'general'): Logger {
  const trimmed = module.trim() || 'general';
  return makeLogger(trimmed);
}

export function setLogSink(sink: LogSink | null): void {
  activeSink = sink;
}

export function setMinLevel(level: LogLevel): void {
  minLevel = level;
}

export function getRecentRecords(): readonly LogRecord[] {
  return ring;
}

/**
 * Serialise a record to the wire format consumed by tools that already parse
 * the Python backend's stdout protocol. Newlines escaped to keep one record
 * per line; tracebacks appended after literal `\n`.
 */
export function serializeRecord(record: LogRecord): string {
  const ts = formatTimestamp(record.ts);
  const tag = record.module.startsWith(`${ROOT_NAMESPACE}.`)
    ? record.module.slice(ROOT_NAMESPACE.length + 1)
    : record.module;
  let body = record.msg;
  if (record.stack) body = `${body}\n${record.stack}`;
  body = body.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
  return `${LOG_PATTERN_PREFIX}${LOG_PATTERN_VERSION}::${record.level}::${tag}::${ts}::${body}`;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
