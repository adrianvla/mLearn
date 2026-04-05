/**
 * LogConsole Component
 * A console-like display for showing log output
 */

import { Component, JSX, Show, For, createEffect } from 'solid-js';
import { useLocalization } from '../../../context';
import { formatLogTimestamp } from '../../../utils/timeFormatting';
import './LogConsole.css';

export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'debug';
export type LogSize = 'sm' | 'md' | 'lg';

export interface LogEntry {
  /** Log message */
  message: string;
  /** Log level */
  level?: LogLevel;
  /** Timestamp */
  timestamp?: Date | string | number;
}

export interface LogConsoleProps {
  /** Array of log entries */
  logs: (string | LogEntry)[];
  /** Console title */
  title?: string;
  /** Size variant */
  size?: LogSize;
  /** Auto-scroll to bottom on new logs */
  autoScroll?: boolean;
  /** Show timestamps */
  showTimestamps?: boolean;
  /** Show level indicators */
  showLevels?: boolean;
  /** Show clear button */
  showClear?: boolean;
  /** Clear handler */
  onClear?: () => void;
  /** Custom height */
  height?: string;
  /** Additional class names */
  class?: string;
  /** Additional inline styles */
  style?: JSX.CSSProperties;
}

// Clear icon
const ClearIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

/**
 * Format timestamp
 */
function formatTimestamp(ts: Date | string | number | undefined, appLocale: string): string {
  return formatLogTimestamp(ts, appLocale);
}

/**
 * Parse log entry
 */
function parseLogEntry(entry: string | LogEntry): LogEntry {
  if (typeof entry === 'string') {
    // Try to detect level from message content
    let level: LogLevel = 'info';
    const lower = entry.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('fail')) {
      level = 'error';
    } else if (lower.includes('warn')) {
      level = 'warning';
    } else if (lower.includes('success') || lower.includes('done') || lower.includes('complete')) {
      level = 'success';
    } else if (lower.includes('debug')) {
      level = 'debug';
    }
    return { message: entry, level, timestamp: new Date() };
  }
  return { ...entry, timestamp: entry.timestamp || new Date() };
}

/**
 * LogConsole - A console-like display for showing log output
 */
export const LogConsole: Component<LogConsoleProps> = (props) => {
  const { t, locale } = useLocalization();
  let contentRef: HTMLDivElement | undefined;
  
  // Auto-scroll to bottom when logs change
  createEffect(() => {
    const logs = props.logs;
    if (props.autoScroll !== false && contentRef && logs.length > 0) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (contentRef) {
          contentRef.scrollTop = contentRef.scrollHeight;
        }
      });
    }
  });

  const handleClear = () => {
    if (props.onClear) {
      props.onClear();
    }
  };

  const contentStyle = (): JSX.CSSProperties => {
    if (props.height) {
      return { 'max-height': props.height, 'min-height': props.height };
    }
    return {};
  };

  return (
    <div
      class={`log-console ${props.size ? `log-console--${props.size}` : ''} ${props.class || ''}`}
      style={props.style}
    >
      {/* Header */}
      <Show when={props.title || props.showClear}>
        <div class="log-console__header">
          <h4 class="log-console__title">{props.title || t('mlearn.Components.LogConsole.DefaultTitle')}</h4>
          <div class="log-console__actions">
            <Show when={props.showClear}>
              <button
                class="log-console__action-btn"
                onClick={handleClear}
                title={t('mlearn.Components.LogConsole.ClearTooltip')}
              >
                <ClearIcon />
              </button>
            </Show>
          </div>
        </div>
      </Show>

      {/* Content */}
      <div
        ref={contentRef}
        class="log-console__content"
        style={contentStyle()}
      >
        <Show
          when={props.logs.length > 0}
          fallback={
            <div class="log-console__empty">
              {t('mlearn.Components.LogConsole.NoLogs')}
            </div>
          }
        >
          <For each={props.logs}>
            {(entry) => {
              const parsed = parseLogEntry(entry);
              return (
                <div class={`log-console__entry log-console__entry--${parsed.level || 'info'}`}>
                  <Show when={props.showTimestamps}>
                    <span class="log-console__timestamp">
                      {formatTimestamp(parsed.timestamp, locale())}
                    </span>
                  </Show>
                  <Show when={props.showLevels}>
                    <span class="log-console__level">
                      {parsed.level || 'info'}
                    </span>
                  </Show>
                  <span class="log-console__message">{parsed.message}</span>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
};

export default LogConsole;
