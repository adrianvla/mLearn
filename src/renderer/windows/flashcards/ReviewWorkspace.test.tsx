// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
const fixture = vi.hoisted(() => ({ store: { meta: {} as Record<string, unknown> }, switchPosition: vi.fn() }));
vi.mock('../../context', () => ({
  useFlashcards: () => ({ store: fixture.store, isKnowledgeReady: () => true, switchReviewPosition: fixture.switchPosition }),
  useSettings: () => ({ settings: { language: 'future' } }),
  useLocalization: () => ({ t: (key: string) => key }),
}));
vi.mock('../../components/common', () => ({ Button: (props: { children: unknown; onClick?: () => void; disabled?: boolean }) =>
  <button disabled={props.disabled} onClick={props.onClick}>{props.children as string}</button> }));
import { ReviewWorkspace } from './ReviewWorkspace';
let container: HTMLDivElement;
let dispose: (() => void) | undefined;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const mount = (context?: Record<string, unknown>) => {
  dispose = render(() => <ReviewWorkspace launchContext={context} onReturn={() => {}}><div data-reviewer>encounter</div></ReviewWorkspace>, container);
};
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container);
  fixture.store.meta = { reviewPresentations: { future: { id: 'saved-choice', cardId: 'card', revealed: true } } };
  fixture.switchPosition.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { dispose?.(); dispose = undefined; container.remove(); });
describe('Review workspace admission', () => {
  it('Open offers Start and exact Resume without mounting a reviewer or changing the cursor', () => {
    mount();
    expect(container.querySelector('[data-reviewer]')).toBeNull();
    expect(fixture.switchPosition).not.toHaveBeenCalled();
    expect(container.textContent).toContain('mlearn.StudyEncounter.Resume');
  });
  it('Start waits for the guarded canonical suspension before mounting the reviewer', async () => {
    let release!: () => void;
    fixture.switchPosition.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    mount({ intent: 'start' });
    expect(container.querySelector('[data-reviewer]')).toBeNull();
    expect(fixture.switchPosition).toHaveBeenCalledWith({ kind: 'switch', language: 'future', expectedSession: null,
      expectedPresentation: { id: 'saved-choice', cardId: 'card', revealed: true } });
    release(); await settle();
    expect(container.querySelector('[data-reviewer]')).not.toBeNull();
  });
  it('Resume names the saved identity and a refused activation never admits another encounter', async () => {
    fixture.switchPosition.mockRejectedValue(new Error('unavailable'));
    mount({ intent: 'resume', sessionId: 'named-position' }); await settle();
    expect(fixture.switchPosition).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 'named-position' }));
    expect(container.querySelector('[data-reviewer]')).toBeNull();
    expect(container.textContent).toContain('mlearn.Product.ResumeUnavailable');
    fixture.switchPosition.mockResolvedValue(undefined);
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain')!.click();
    await settle();
    expect(container.querySelector('[data-reviewer]')).not.toBeNull();
    expect(fixture.switchPosition.mock.calls.at(-1)?.[0].resumeId).toBe('named-position');
  });
  it('does not substitute Start when a Resume lacks its identity', () => {
    mount({ intent: 'resume' });
    expect(fixture.switchPosition).not.toHaveBeenCalled();
    expect(container.querySelector('[data-reviewer]')).toBeNull();
    expect(container.textContent).toContain('mlearn.Product.ResumeUnavailable');
  });
});
