import { Component, For, Show, createEffect, onMount, createSignal } from 'solid-js';
import { LogLine } from '../api/types';
import { redactLine } from '../redact';
import './LogViewer.css';

interface LogViewerProps {
  lines: LogLine[];
  loading?: boolean;
  autoScroll?: boolean;
  maxHeight?: string;
  onRefresh?: () => void;
  showTimestamps?: boolean;
}

const NEAR_BOTTOM_THRESHOLD_PX = 32;

const LogViewer: Component<LogViewerProps> = (props) => {
  let bodyRef: HTMLDivElement | undefined;
  const [stickToBottom, setStickToBottom] = createSignal(true);
  const [copied, setCopied] = createSignal(false);

  const isNearBottom = (el: HTMLDivElement): boolean =>
    el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;

  const scrollToBottom = () => {
    if (bodyRef) {
      bodyRef.scrollTop = bodyRef.scrollHeight;
    }
  };

  const handleScroll = () => {
    if (bodyRef) {
      setStickToBottom(isNearBottom(bodyRef));
    }
  };

  onMount(() => {
    scrollToBottom();
  });

  createEffect(() => {
    const lineCount = props.lines.length;
    if (props.autoScroll !== false && stickToBottom() && lineCount > 0) {
      scrollToBottom();
    }
  });

  const handleCopy = async () => {
    const text = props.lines
      .map((line) =>
        props.showTimestamps !== false && line.timestamp
          ? `${line.timestamp} ${line.message}`
          : line.message,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      void text;
    }
  };

  return (
    <div class="log-viewer">
      <div class="log-viewer__header">
        <div class="log-viewer__title">
          <span>Logs</span>
          <span class="log-viewer__badge">{props.lines.length}</span>
        </div>
        <div class="log-viewer__actions">
          <Show when={props.onRefresh}>
            <button
              type="button"
              class="log-viewer__btn"
              classList={{ 'log-viewer__btn--spin': props.loading }}
              onClick={() => props.onRefresh?.()}
              aria-label="Refresh logs"
              disabled={props.loading}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.74 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
                />
              </svg>
            </button>
          </Show>
          <button
            type="button"
            class="log-viewer__btn"
            onClick={handleCopy}
            aria-label="Copy logs to clipboard"
            disabled={props.lines.length === 0}
          >
            <Show
              when={!copied()}
              fallback={
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
                  />
                </svg>
              }
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"
                />
              </svg>
            </Show>
          </button>
        </div>
      </div>
      <div
        class="log-viewer__body"
        ref={bodyRef}
        onScroll={handleScroll}
        style={{ 'max-height': props.maxHeight ?? '400px' }}
      >
        <Show
          when={props.lines.length > 0 || !props.loading}
          fallback={
            <div class="log-viewer__state">
              <span class="log-viewer__spinner" aria-hidden="true" />
              <span>Loading…</span>
            </div>
          }
        >
          <Show
            when={props.lines.length > 0}
            fallback={<div class="log-viewer__state">No logs available</div>}
          >
            <For each={props.lines}>
              {(line) => (
                <div
                  class="log-viewer__line"
                  classList={{
                    'log-viewer__line--stderr': line.stream === 'stderr',
                    'log-viewer__line--stdout': line.stream === 'stdout',
                  }}
                >
                  <Show when={props.showTimestamps !== false && line.timestamp}>
                    <span class="log-viewer__timestamp">{line.timestamp}</span>
                  </Show>
                  <span class="log-viewer__message">{redactLine(line.message)}</span>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default LogViewer;
