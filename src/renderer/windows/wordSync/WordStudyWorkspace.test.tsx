// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
const fixture = vi.hoisted(() => ({ loading: () => false as boolean, language: 'future', task: {} as Record<string, unknown> }));
vi.mock('../../context', () => ({ useSettings: () => ({ settings: { get language() { return fixture.language; } }, isLoading: () => fixture.loading() }), useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('../../components/common', () => ({ Button: (props: { onClick: () => void; children: unknown }) => <button onClick={props.onClick}>{props.children as string}</button> }));
vi.mock('./App', () => ({ WordSyncContent: (props: Record<string, unknown>) => { fixture.task = props; return <div>Actual task owner</div>; } }));
let host: HTMLDivElement;
let dispose: (() => void) | undefined;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); fixture.task = {}; fixture.language = 'future'; fixture.loading = () => false; });
afterEach(() => { dispose?.(); host.remove(); });
describe('routed Word task ownership', () => {
  it('opens a workspace without auto-resuming another task', async () => {
    const { WordStudyWorkspace } = await import('./WordStudyWorkspace');
    dispose = render(() => <WordStudyWorkspace mode="study" onReturn={vi.fn()} />, host);
    expect(fixture.task.launchIntent).toBe('open');
    expect(fixture.task.resumeSessionId).toBeUndefined();
  });
  it('waits for settings then starts the exact material and returns to its source', async () => {
    const [loading, setLoading] = createSignal(true); fixture.loading = loading;
    const onReturn = vi.fn();
    const { WordStudyWorkspace } = await import('./WordStudyWorkspace');
    dispose = render(() => <WordStudyWorkspace mode="study" launchContext={{ activity: 'practice', returnTo: 'reader', material: { language: 'future', words: ['actual-source-word'], label: 'Selected section' } }} onReturn={onReturn} />, host);
    expect(host.textContent).not.toContain('Actual task owner');
    setLoading(false);
    expect(fixture.task.words).toEqual(['actual-source-word']);
    expect(fixture.task.launchIntent).toBe('start');
    (fixture.task.onClose as () => void)();
    expect(onReturn).toHaveBeenCalledWith('/reader', undefined);
  });
  it('returns with the resumed task source instead of a conflicting launch origin', async () => {
    const onReturn = vi.fn();
    const saved = { returnTo: 'reader', sourceContext: { workspace: 'reader', path: '/saved.epub', selection: { 'future:field': [3, 8] } } };
    const { WordStudyWorkspace } = await import('./WordStudyWorkspace');
    dispose = render(() => <WordStudyWorkspace mode="study" launchContext={{ intent: 'resume', sessionId: 'saved', returnTo: 'video', sourceContext: { path: '/new.mp4' } }} onReturn={onReturn} />, host);
    (fixture.task.onClose as (context: Record<string, unknown>) => void)(saved);
    expect(onReturn).toHaveBeenCalledWith('/reader', saved);
    (fixture.task.onClose as (context: Record<string, unknown>) => void)({});
    expect(onReturn).toHaveBeenLastCalledWith('/practise', {});
  });
  it.each(['home', 'plan', 'flashcards'])('preserves the %s destination when returning from Evaluate', async destination => {
    const onReturn = vi.fn();
    const { WordStudyWorkspace } = await import('./WordStudyWorkspace');
    dispose = render(() => <WordStudyWorkspace mode="assessment"
      launchContext={{ returnTo: 'evaluate', evaluationReturnTo: destination }} onReturn={onReturn} />, host);
    const returnContext = fixture.task.returnContext as Record<string, unknown>;
    expect(returnContext).toMatchObject({ returnTo: 'evaluate', evaluationReturnTo: destination });
    (fixture.task.onClose as (context: Record<string, unknown>) => void)(returnContext);
    expect(onReturn).toHaveBeenCalledWith('/evaluate', returnContext);
  });
  it('refuses a stale language selection instead of starting unscoped study', async () => {
    const { WordStudyWorkspace } = await import('./WordStudyWorkspace');
    dispose = render(() => <WordStudyWorkspace mode="study" launchContext={{ activity: 'practice', material: { language: 'other', words: ['wrong'] } }} onReturn={vi.fn()} />, host);
    expect(host.textContent).toContain('mlearn.Goals.Unavailable');
    expect(host.textContent).not.toContain('Actual task owner');
  });
});
