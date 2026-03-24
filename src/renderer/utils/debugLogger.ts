/**
 * On-Screen Debug Logger
 * Provides a visual console overlay for mobile debugging where browser devtools
 * are unavailable. Mirrors the `console` API and renders logs in a hideable
 * fullscreen panel. Only active when `settings.devMode` is true or toggled on.
 */

type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

interface LogEntry {
  level: LogLevel;
  timestamp: number;
  args: unknown[];
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
let container: HTMLDivElement | null = null;
let logList: HTMLDivElement | null = null;
let visible = false;

// ============================================================================
// Styling (injected once)
// ============================================================================

function injectStyles() {
  if (document.getElementById('debug-logger-styles')) return;
  const style = document.createElement('style');
  style.id = 'debug-logger-styles';
  style.textContent = `
    .debug-logger-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0, 0, 0, 0.92);
      display: none;
      flex-direction: column;
      font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
      font-size: 11px;
      color: #e0e0e0;
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .debug-logger-overlay.visible {
      display: flex;
    }
    .debug-logger-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.08);
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      flex-shrink: 0;
    }
    .debug-logger-header span {
      font-weight: 600;
      font-size: 12px;
    }
    .debug-logger-header button {
      background: rgba(255, 255, 255, 0.12);
      border: none;
      color: #e0e0e0;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      margin-left: 6px;
    }
    .debug-logger-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
      -webkit-overflow-scrolling: touch;
    }
    .debug-logger-entry {
      padding: 3px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.4;
    }
    .debug-logger-entry.warn {
      color: #f0c040;
      background: rgba(240, 192, 64, 0.06);
    }
    .debug-logger-entry.error {
      color: #f06060;
      background: rgba(240, 96, 96, 0.06);
    }
    .debug-logger-entry.info {
      color: #60a0f0;
    }
    .debug-logger-entry.debug {
      color: #888;
    }
    .debug-logger-entry .ts {
      color: #666;
      margin-right: 6px;
    }
    .debug-logger-toggle {
      position: fixed;
      bottom: calc(80px + env(safe-area-inset-bottom));
      right: 10px;
      z-index: 99998;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #e0e0e0;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
  `;
  document.head.appendChild(style);
}

// ============================================================================
// DOM creation
// ============================================================================

function ensureDOM() {
  if (container) return;
  injectStyles();

  // Overlay container
  container = document.createElement('div');
  container.className = 'debug-logger-overlay';

  // Header
  const header = document.createElement('div');
  header.className = 'debug-logger-header';
  const title = document.createElement('span');
  title.textContent = 'Debug Console';
  const btnClear = document.createElement('button');
  btnClear.textContent = 'Clear';
  btnClear.onclick = () => clearLogs();
  const btnClose = document.createElement('button');
  btnClose.textContent = 'Close';
  btnClose.onclick = () => hide();
  header.appendChild(title);
  header.appendChild(btnClear);
  header.appendChild(btnClose);
  container.appendChild(header);

  // Log list
  logList = document.createElement('div');
  logList.className = 'debug-logger-list';
  container.appendChild(logList);

  document.body.appendChild(container);

  // Floating toggle button
  const toggle = document.createElement('div');
  toggle.className = 'debug-logger-toggle';
  toggle.textContent = '🐛';
  toggle.onclick = () => {
    if (visible) hide();
    else show();
  };
  document.body.appendChild(toggle);
}

// ============================================================================
// Rendering
// ============================================================================

function formatArgs(args: unknown[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
    try {
      return JSON.stringify(a, null, 2);
    } catch {
      return String(a);
    }
  }).join(' ');
}

function renderEntry(entry: LogEntry) {
  if (!logList) return;
  const el = document.createElement('div');
  el.className = `debug-logger-entry ${entry.level}`;
  const ts = document.createElement('span');
  ts.className = 'ts';
  const d = new Date(entry.timestamp);
  ts.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  el.appendChild(ts);
  el.appendChild(document.createTextNode(formatArgs(entry.args)));
  logList.appendChild(el);
  // Auto-scroll to bottom
  logList.scrollTop = logList.scrollHeight;
}

function clearLogs() {
  entries.length = 0;
  if (logList) logList.innerHTML = '';
}

// ============================================================================
// Public API
// ============================================================================

function addEntry(level: LogLevel, ...args: unknown[]) {
  const entry: LogEntry = { level, timestamp: Date.now(), args };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  // Also pass through to real console
  const original = (console as unknown as Record<string, unknown>)[`__orig_${level}`] as ((...a: unknown[]) => void) | undefined;
  if (original) original.apply(console, args);
  else (console as unknown as Record<string, (...a: unknown[]) => void>)[level]?.(...args);

  // Render if DOM is ready
  if (logList) renderEntry(entry);
}

function show() {
  ensureDOM();
  // Render any entries that were captured before DOM was ready
  if (logList && logList.children.length === 0 && entries.length > 0) {
    for (const e of entries) renderEntry(e);
  }
  visible = true;
  container!.classList.add('visible');
}

function hide() {
  visible = false;
  container?.classList.remove('visible');
}

/**
 * Initialize the debug logger. Call once at app startup.
 * Patches console.log/warn/error/info/debug to also capture logs on-screen.
 */
export function initDebugLogger() {
  const levels: LogLevel[] = ['log', 'warn', 'error', 'info', 'debug'];
  for (const level of levels) {
    const original = (console as unknown as Record<string, unknown>)[level] as (...args: unknown[]) => void;
    (console as unknown as Record<string, unknown>)[`__orig_${level}`] = original;
    (console as unknown as Record<string, (...args: unknown[]) => void>)[level] = (...args: unknown[]) => {
      addEntry(level, ...args);
    };
  }

  // Capture unhandled errors
  window.addEventListener('error', (e) => {
    addEntry('error', `[Uncaught] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    addEntry('error', `[Unhandled Rejection]`, e.reason);
  });

  // Create DOM on next frame so body exists
  requestAnimationFrame(() => ensureDOM());
}

/** Programmatically show the debug overlay */
export function showDebugLogger() { show(); }

/** Programmatically hide the debug overlay */
export function hideDebugLogger() { hide(); }
