import { Component, For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import {
  CLAIM_SYSTEM_PROMPT,
  LEARNER_CLAIM_TOOLS,
  parseClaimToolCalls,
  type LearnerClaimOp,
} from '../../../services/learnerClaimsInterpreter';
import { streamChat } from '../../../services/llmProvider';
import { Button } from '../Button/Button';
import { Textarea } from '../Input/Input';
import './TellMlearn.css';
import { Popover } from '../Popover/Popover';

/**
 * "Tell mLearn…" — a single-shot natural-language correction field, NOT a
 * chat. The learner's text is translated into typed claim operations by the
 * interpreter service; this component owns only the interaction: prompt,
 * send, deterministic summary of what actually changed, and one-click undo
 * through the append-only claim model.
 */

export interface AppliedLearnerClaim {
  /** Localization key for WHAT was addressed (capability label or word). */
  labelKey: string;
  /** Localization key for the applied status word, when the op sets one. */
  statusKey?: string;
  /** Undo closure — applies the inverse claim through the existing model. */
  undo: () => void | Promise<boolean | void>;
}

export interface TellMlearnProps {
  /** Identity of the word/presentation being explained. */
  resetKey?: string | number;
  label: string;
  placeholder: string;
  sendLabel: string;
  undoLabel: string;
  updatedLabel: string;
  noChangeLabel: string;
  errorLabel: string;
  /** Builds the compact learner context shown to the interpreter. */
  buildContext: () => string;
  /** Applies typed ops and returns what actually changed (with undo closures). */
  onApply: (ops: LearnerClaimOp[]) => AppliedLearnerClaim[] | { applied: AppliedLearnerClaim[]; failed: boolean } | Promise<AppliedLearnerClaim[] | { applied: AppliedLearnerClaim[]; failed: boolean }>;
  /** Translates localization keys for the deterministic summary. */
  translate: (key: string) => string;
}

export const TellMlearn: Component<TellMlearnProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [text, setText] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [summaryKeys, setSummaryKeys] = createSignal<Array<{ labelKey: string; statusKey?: string }> | null>(null);
  const [undoStack, setUndoStack] = createSignal<Array<AppliedLearnerClaim['undo']>>([]);

  let requestVersion = 0;
  let activeRequest: { abort: () => void } | undefined;

  let popupTriggerRef: HTMLButtonElement | undefined;

  const cancelRequest = () => {
    requestVersion += 1;
    activeRequest?.abort();
    activeRequest = undefined;
  };
  createEffect(on(() => props.resetKey, () => {
    cancelRequest();
    setText('');
    setBusy(false);
    setFailed(false);
    setSummaryKeys(null);
    setUndoStack([]);
    setExpanded(false);
  }));
  onCleanup(cancelRequest);

  const send = () => {
    const statement = text().trim();
    if (!statement || busy()) return;
    const version = ++requestVersion;
    setBusy(true);
    setFailed(false);
    setSummaryKeys(null);
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    activeRequest = streamChat(
      [
        { role: 'system', content: CLAIM_SYSTEM_PROMPT },
        { role: 'user', content: `${props.buildContext()}\n\nLearner says: ${statement}` },
      ],
      LEARNER_CLAIM_TOOLS,
      {
        onChunk: () => {},
        onToolCall: (toolCall) => toolCalls.push({ name: toolCall.name, arguments: toolCall.arguments ?? {} }),
        onDone: async (_finalContent, allToolCalls) => {
          if (version !== requestVersion) return;
          activeRequest = undefined;
          const ops = parseClaimToolCalls(allToolCalls);
          if (ops.length === 0) {
            setSummaryKeys([]);
          } else {
            try {
              const result = await props.onApply(ops);
              if (version !== requestVersion) return;
              const applied = Array.isArray(result) ? result : result.applied;
              setFailed(!Array.isArray(result) && result.failed);
              setUndoStack(applied.map((entry) => entry.undo));
              setSummaryKeys(applied.map((entry) => ({ labelKey: entry.labelKey, statusKey: entry.statusKey })));
            } catch {
              if (version !== requestVersion) return;
              setFailed(true);
            }
          }
          setText('');
          setBusy(false);
        },
        onError: () => {
          if (version !== requestVersion) return;
          activeRequest = undefined;
          setFailed(true);
          setBusy(false);
        },
      },
    );
  };

  const undoAll = async () => {
    if (busy()) return;
    const version = ++requestVersion;
    setBusy(true);
    setFailed(false);
    const remaining: Array<AppliedLearnerClaim['undo']> = [];
    for (const undo of [...undoStack()].reverse()) {
      try { if (await undo() === false) remaining.push(undo); }
      catch { remaining.push(undo); }
    }
    if (version !== requestVersion) return;
    setUndoStack(remaining.reverse());
    setFailed(remaining.length > 0);
    if (remaining.length === 0) setSummaryKeys(null);
    setBusy(false);
  };

  return (
    <div class="tell-mlearn">
      <Button
        buttonType="default"
        variant="ghost"
        size="sm"
        ref={(element) => { popupTriggerRef = element; }}
        class="tell-mlearn__toggle"
        aria-haspopup="dialog"
        aria-expanded={expanded()}
        onClick={() => setExpanded((open) => !open)}
      >
        {props.label}
      </Button>
      <Popover
        open={expanded}
        anchor={() => popupTriggerRef}
        onClose={() => setExpanded(false)}
        label={props.label}
        class="tell-mlearn__popover"
      >
        <div class="tell-mlearn__composer">
          <Textarea
            class="tell-mlearn__input"
            fullWidth
            resize="none"
            aria-label={props.label}
            rows={2}
            placeholder={props.placeholder}
            value={text()}
            disabled={busy()}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div class="tell-mlearn__actions">
            <Button
              buttonType="default"
              variant="primary"
              size="sm"
              disabled={busy() || text().trim().length === 0}
              onClick={send}
            >
              {busy() ? '…' : props.sendLabel}
            </Button>
            <Show when={undoStack().length > 0}>
              <Button buttonType="default" variant="ghost" size="sm" disabled={busy()} onClick={() => void undoAll()}>
                {props.undoLabel}
              </Button>
            </Show>
          </div>
        </div>
        <Show when={failed()}>
          <div class="tell-mlearn__error" role="alert">{props.errorLabel}</div>
        </Show>
        <Show when={summaryKeys() !== null}>
          <div class="tell-mlearn__summary" role="status">
            <Show
              when={(summaryKeys() ?? []).length > 0}
              fallback={<span>{props.noChangeLabel}</span>}
            >
              <span class="tell-mlearn__summary-label">{props.updatedLabel}</span>
              <For each={summaryKeys() ?? []}>
                {(entry, index) => (
                  <span class="tell-mlearn__summary-item">
                    <Show when={index() > 0}>
                      <span class="tell-mlearn__summary-sep"> · </span>
                    </Show>
                    {props.translate(entry.labelKey)}
                    <Show when={entry.statusKey}>
                      {': '}
                      {props.translate(entry.statusKey!)}
                    </Show>
                  </span>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </Popover>
    </div>
  );
};

export default TellMlearn;
