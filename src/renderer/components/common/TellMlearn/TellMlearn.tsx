import { Component, For, Show, createSignal } from 'solid-js';
import {
  CLAIM_SYSTEM_PROMPT,
  LEARNER_CLAIM_TOOLS,
  parseClaimToolCalls,
  type LearnerClaimOp,
} from '../../../services/learnerClaimsInterpreter';
import { streamChat } from '../../../services/llmProvider';
import { Button } from '../Button/Button';
import './TellMlearn.css';

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
  undo: () => void;
}

export interface TellMlearnProps {
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
  onApply: (ops: LearnerClaimOp[]) => AppliedLearnerClaim[];
  /** Translates localization keys for the deterministic summary. */
  translate: (key: string) => string;
}

export const TellMlearn: Component<TellMlearnProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [text, setText] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [summaryKeys, setSummaryKeys] = createSignal<Array<{ labelKey: string; statusKey?: string }> | null>(null);
  const [undoStack, setUndoStack] = createSignal<Array<() => void>>([]);

  const send = () => {
    const statement = text().trim();
    if (!statement || busy()) return;
    setBusy(true);
    setFailed(false);
    setSummaryKeys(null);
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    streamChat(
      [
        { role: 'system', content: CLAIM_SYSTEM_PROMPT },
        { role: 'user', content: `${props.buildContext()}\n\nLearner says: ${statement}` },
      ],
      LEARNER_CLAIM_TOOLS,
      {
        onChunk: () => {},
        onToolCall: (toolCall) => toolCalls.push({ name: toolCall.name, arguments: toolCall.arguments ?? {} }),
        onDone: (_finalContent, allToolCalls) => {
          const ops = parseClaimToolCalls(allToolCalls);
          if (ops.length === 0) {
            setSummaryKeys([]);
          } else {
            const applied = props.onApply(ops);
            setUndoStack(applied.map((entry) => entry.undo));
            setSummaryKeys(applied.map((entry) => ({ labelKey: entry.labelKey, statusKey: entry.statusKey })));
          }
          setText('');
          setBusy(false);
        },
        onError: () => {
          setFailed(true);
          setBusy(false);
        },
      },
    );
  };

  const undoAll = () => {
    for (const undo of undoStack()) undo();
    setUndoStack([]);
    setSummaryKeys(null);
  };

  return (
    <div class="tell-mlearn">
      <Show
        when={expanded()}
        fallback={
          <Button
            buttonType="default"
            variant="ghost"
            size="sm"
            class="tell-mlearn__toggle"
            onClick={() => setExpanded(true)}
          >
            {props.label}
          </Button>
        }
      >
        <div class="tell-mlearn__composer">
          <textarea
            class="tell-mlearn__input"
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
              <Button buttonType="default" variant="ghost" size="sm" onClick={undoAll}>
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
      </Show>
    </div>
  );
};

export default TellMlearn;
