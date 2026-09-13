// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { TellMlearn, type AppliedLearnerClaim } from './TellMlearn';
import type { LearnerClaimOp } from '../../../services/learnerClaimsInterpreter';

type StreamCallbacks = {
  onToolCall: (tc: { id: string; name: string; arguments: Record<string, unknown> }) => void;
  onDone: (finalContent: string, allToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>) => void;
  onError: (error: unknown) => void;
};

const streamImpl = vi.hoisted(() => vi.fn());

vi.mock('../../../services/llmProvider', () => ({
  streamChat: (...args: unknown[]) => streamImpl(...args),
}));

const t = (key: string) => ({
  'mlearn.TellMlearn.Label': 'Tell mLearn…',
  'mlearn.TellMlearn.Placeholder': '…',
  'mlearn.TellMlearn.Send': 'Apply',
  'mlearn.TellMlearn.Undo': 'Undo',
  'mlearn.TellMlearn.Updated': 'Updated:',
  'mlearn.TellMlearn.NoChange': 'Nothing to change',
  'mlearn.TellMlearn.Error': 'Could not process that',
  'mlearn.Knowledge.Capability.spoken-recognition': 'Listening',
  'mlearn.TellMlearn.Status.Known': 'known',
  'mlearn.TellMlearn.Status.Learning': 'learning',
  'mlearn.TellMlearn.Status.Unknown': 'unknown',
}[key] ?? key);

describe('TellMlearn', () => {
  let container: HTMLDivElement;
  const onApply = vi.fn();
  const appliedByOp = new Map<string, AppliedLearnerClaim>();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    appliedByOp.clear();
    streamImpl.mockImplementation((_messages, _tools, _callbacks: StreamCallbacks) => ({ abort: vi.fn() }));
    onApply.mockImplementation((ops: LearnerClaimOp[]) =>
      ops.map((op) => {
        const applied: AppliedLearnerClaim = {
          labelKey: op.op === 'setWordClaim' || op.op === 'clearWordClaim'
            ? 'mlearn.TellMlearn.Word'
            : `mlearn.Knowledge.Capability.${'capability' in op ? op.capability : ''}`,
          statusKey: op.op === 'setAccessClaim' || op.op === 'setWordClaim'
            ? `mlearn.TellMlearn.Status.${op.status.charAt(0).toUpperCase()}${op.status.slice(1)}`
            : undefined,
          undo: () => {},
        };
        return applied;
      }),
    );
  });

  afterEach(() => {
    container.remove();
  });

  const renderField = () =>
    render(
      () => (
        <TellMlearn
          label={t('mlearn.TellMlearn.Label')}
          placeholder={t('mlearn.TellMlearn.Placeholder')}
          sendLabel={t('mlearn.TellMlearn.Send')}
          undoLabel={t('mlearn.TellMlearn.Undo')}
          updatedLabel={t('mlearn.TellMlearn.Updated')}
          noChangeLabel={t('mlearn.TellMlearn.NoChange')}
          errorLabel={t('mlearn.TellMlearn.Error')}
          buildContext={() => 'CTX'}
          onApply={onApply}
          translate={t}
        />
      ),
      container,
    );

  const sendStatement = async (statement: string, emit: (cbs: StreamCallbacks) => void) => {
    container.querySelector<HTMLButtonElement>('.tell-mlearn__toggle')!.click();
    await Promise.resolve();
    const input = container.querySelector<HTMLTextAreaElement>('.tell-mlearn__input')!;
    input.value = statement;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('.tell-mlearn__actions button')!.click();
    expect(streamImpl).toHaveBeenCalledTimes(1);
    const callbacks = streamImpl.mock.calls[0][2] as StreamCallbacks;
    emit(callbacks);
  };

  it('discards a pending explanation and its undo state when the word changes', async () => {
    const [resetKey, setResetKey] = createSignal('first');
    const abort = vi.fn();
    streamImpl.mockReturnValue({ abort });
    const dispose = render(() => <TellMlearn label="Explain" placeholder="Explain" sendLabel="Apply"
      undoLabel="Undo" updatedLabel="Updated" noChangeLabel="No change" errorLabel="Error"
      resetKey={resetKey()} buildContext={() => resetKey()} onApply={onApply} translate={t} />, container);
    await sendStatement('I know this word', () => {});
    const callbacks = streamImpl.mock.calls[0][2] as StreamCallbacks;
    setResetKey('second');
    expect(abort).toHaveBeenCalledOnce();
    callbacks.onDone('', [{ id: 'old', name: 'set_word_claim', arguments: { status: 'known' } }]);
    expect(onApply).not.toHaveBeenCalled();
    expect(container.querySelector('.tell-mlearn__summary')).toBeNull();
    dispose();
  });

  it('uses the shared textarea with an accessible name and no native resize control', () => {
    const dispose = renderField();
    container.querySelector<HTMLButtonElement>('.tell-mlearn__toggle')?.click();
    const input = container.querySelector<HTMLTextAreaElement>('.tell-mlearn__input');
    expect(input?.getAttribute('aria-label')).toBe('Tell mLearn…');
    expect(input?.style.resize).toBe('none');
    dispose();
  });

  it('applies parsed tool calls and renders the deterministic summary (acceptance M)', async () => {
    const dispose = renderField();
    await sendStatement('I know this word when I hear it.', (cbs) => {
      cbs.onToolCall({ id: '1', name: 'set_access_claim', arguments: { capability: 'spoken-recognition', status: 'known', basis: 'unassisted' } });
      cbs.onDone('', [
        { id: '1', name: 'set_access_claim', arguments: { capability: 'spoken-recognition', status: 'known', basis: 'unassisted' } },
      ]);
    });
    await Promise.resolve();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Updated:');
    expect(container.textContent).toContain('Listening: known');
    dispose();
  });

  it('reports no-change when the model emits no valid ops and never calls apply', async () => {
    const dispose = renderField();
    await sendStatement('the weather is nice', (cbs) => {
      cbs.onToolCall({ id: '1', name: 'write_evidence', arguments: { quality: 'fluent' } });
      cbs.onDone('', [{ id: '1', name: 'write_evidence', arguments: { quality: 'fluent' } }]);
    });
    await Promise.resolve();
    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Nothing to change');
    dispose();
  });

  // The LLM is mocked at the existing transport boundary: these exercise
  // interpreted cue conditions through application, not live-model accuracy.
  it.each([
    ['I know what 内科 means ONLY when I see the ないか scaffold.', 'cue-dependent', 'learning'],
    ['I recognize it after you show me the reading; I need that help.', 'cue-dependent', 'learning'],
    ['I can retrieve the reading only with the hint/scaffold.', 'cue-dependent', 'learning'],
    ['Once I see the reading I recognize it; I cannot get there without it.', 'cue-dependent', 'learning'],
    ['The hint helps, but I can read it myself.', 'unassisted', 'known'],
    ['I do not need the scaffold to read it.', 'unassisted', 'known'],
  ])('applies the retrieval condition for "%s"', async (statement, basis, status) => {
    const dispose = renderField();
    await sendStatement(statement, (cbs) => cbs.onDone('', [
      { id: '1', name: 'set_access_claim', arguments: { capability: 'surface-reading', status: 'known', basis } },
    ]));
    expect(onApply).toHaveBeenCalledExactlyOnceWith([
      { op: 'setAccessClaim', capability: 'surface-reading', status },
    ]);
    const messages = streamImpl.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain('separate ability WITHOUT an answer-supplying cue from recognition AFTER that cue');
    expect(messages[1].content).toContain(statement);
    dispose();
  });

  it('leaves independent reading unchanged when only seeing the supplied reading was reported', async () => {
    const dispose = renderField();
    await sendStatement('I saw the reading.', (cbs) => cbs.onDone('', [
      { id: '1', name: 'set_access_claim', arguments: { capability: 'surface-reading', status: 'known', basis: 'cue-only' } },
    ]));
    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Nothing to change');
    dispose();
  });

  it('undo applies the recorded inverse closures and clears the summary', async () => {
    const undoSpy = vi.fn();
    onApply.mockReturnValue([{ labelKey: 'k', statusKey: undefined, undo: undoSpy }]);
    const dispose = renderField();
    await sendStatement('actually I do not know this', (cbs) => {
      cbs.onDone('', [{ id: '1', name: 'clear_access_claim', arguments: { capability: 'surface-reading' } }]);
    });
    await Promise.resolve();
    const undoButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Undo')!;
    undoButton.click();
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Updated:');
    dispose();
  });

  it('shows the error state when the stream fails', async () => {
    const dispose = renderField();
    await sendStatement('hello', (cbs) => cbs.onError(new Error('offline')));
    await Promise.resolve();
    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Could not process that');
    dispose();
  });
});
