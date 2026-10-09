// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { StoryAdvanceRecord, StoryTrack } from '../../../shared/story';

const prepareStoryAdvance = vi.fn();
const applyStoryAdvance = vi.fn();
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ world: { prepareStoryAdvance, applyStoryAdvance,
  cancelStoryAdvance: vi.fn() } }) }));
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('../../components/common', async (original) => ({
  ...await original<typeof import('../../components/common')>(),
  Modal: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
}));
import { StoryProgressModal } from './StoryProgressModal';

const track: StoryTrack = { id: 'story-1', title: 'Voyage', edition: 'First', unitLabel: 'chapter',
  completed: [{ from: 1, to: 2 }], sources: [{ id: 'source-1', url: 'https://example.org/1', from: 1, to: 2, confirmed: true }],
  relations: [], autoAdvance: false, revision: 3, updatedAt: 1 };
const ready: StoryAdvanceRecord = { id: 'advance-1', trackId: track.id, trackRevision: track.revision,
  status: 'ready', createdAt: 2, proposals: [] };
const cleanups: Array<() => void> = [];
function mount(generationAvailable = true, onRequestGenerationAccess?: () => boolean): HTMLDivElement {
  const el = document.createElement('div'); document.body.append(el);
  const dispose = render(() => <StoryProgressModal generationAvailable={generationAvailable} onRequestGenerationAccess={onRequestGenerationAccess} world={{ storyTracks: [track], rooms: [], threads: [], participants: [] }}
    onClose={vi.fn()} onRefresh={vi.fn(async () => {})} />, el);
  cleanups.push(() => { dispose(); el.remove(); });
  return el;
}
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.clearAllMocks(); });
const button = (el: HTMLElement, key: string): HTMLButtonElement => {
  const match = Array.from(el.querySelectorAll('button')).find(item => item.textContent === key);
  expect(match, key).toBeDefined(); return match!;
};

describe('Story progress review', () => {
  it('requires consent for story research while leaving track inspection editable', () => {
    const requestAccess = vi.fn(() => false);
    const el = mount(true, requestAccess);
    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = track.id; select.dispatchEvent(new Event('change', { bubbles: true }));
    button(el, 'mlearn.ConversationAgent.Story.ReviewUpdate').click();
    expect(requestAccess).toHaveBeenCalled();
    expect(prepareStoryAdvance).not.toHaveBeenCalled();
    expect(select.disabled).toBe(false);
  });

  it('locks track edits during preparation and prevents applying an out-of-date local draft', async () => {
    let resolve!: (record: StoryAdvanceRecord) => void;
    prepareStoryAdvance.mockReturnValue(new Promise<StoryAdvanceRecord>(value => { resolve = value; }));
    const el = mount();
    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = track.id; select.dispatchEvent(new Event('change', { bubbles: true }));
    button(el, 'mlearn.ConversationAgent.Story.ReviewUpdate').click();
    expect(select.disabled).toBe(true);
    expect((el.querySelector('.story-progress-source-form input') as HTMLInputElement).disabled).toBe(true);
    resolve(ready);
    await vi.waitFor(() => expect(button(el, 'mlearn.ConversationAgent.Story.ApplyUpdate').disabled).toBe(false));
    const title = el.querySelector('.story-progress-grid input') as HTMLInputElement;
    title.value = 'Revised Voyage'; title.dispatchEvent(new Event('input', { bubbles: true }));
    expect(button(el, 'mlearn.ConversationAgent.Story.ApplyUpdate').disabled).toBe(true);
    button(el, 'mlearn.ConversationAgent.Story.ApplyUpdate').click();
    expect(applyStoryAdvance).not.toHaveBeenCalled();
  });
  it('shows a stale result and allows another review', async () => {
    prepareStoryAdvance.mockResolvedValueOnce(ready);
    applyStoryAdvance.mockResolvedValueOnce({ ...ready, status: 'stale', error: 'A contact changed after research.' });
    const el = mount();
    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = track.id; select.dispatchEvent(new Event('change', { bubbles: true }));
    button(el, 'mlearn.ConversationAgent.Story.ReviewUpdate').click();
    await vi.waitFor(() => expect(button(el, 'mlearn.ConversationAgent.Story.ApplyUpdate').disabled).toBe(false));
    button(el, 'mlearn.ConversationAgent.Story.ApplyUpdate').click();
    await vi.waitFor(() => expect(el.textContent).toContain('A contact changed after research.'));
    expect(button(el, 'mlearn.ConversationAgent.Story.ReviewUpdate').disabled).toBe(false);
  });
});

 it('opens the explicitly referenced edition without selecting a similarly named track', () => {
  const el = document.createElement('div'); document.body.append(el);
  const other = { ...track, id: 'other-edition', edition: 'Second' };
  const dispose = render(() => <StoryProgressModal initialTrackId={track.id} world={{ storyTracks: [other, track] } as never} onClose={() => {}} onRefresh={async () => {}} />, el);
  cleanups.push(() => { dispose(); el.remove(); });
  expect(el.querySelector<HTMLSelectElement>('select[aria-label="mlearn.ConversationAgent.Story.Track"]')?.value).toBe(track.id);
  expect(el.querySelector<HTMLInputElement>('input')?.value).toBe(track.title);
});
