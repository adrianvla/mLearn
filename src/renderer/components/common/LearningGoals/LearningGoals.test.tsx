// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
const fixture = vi.hoisted(() => ({ context: {} as Record<string, unknown> }));
vi.mock('../../../context', () => ({ useSettings: () => fixture.context, useLocalization: () => ({ t: (key: string) => key }) }));
import { LearningGoals } from './LearningGoals';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
describe('Home goal controls', () => {
  it('preserves an unscoped legacy commitment when editing its deadline', () => {
    const [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS, language: 'future', examGoal: { kind: 'exam' as const, target: 'Read for class', deadline: '2026-12-01' } });
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    dispose = render(() => <LearningGoals />, document.body);
    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    date.value = '2027-01-01'; date.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.learningGoals?.[0]).toMatchObject({ language: 'future', outcome: 'Read for class', deadline: '2027-01-01' });
    expect(settings.examGoal.target).toBe('Read for class');
  });
  it('creates a no-deadline outcome without AI and edits constraints without replacing history', () => {
    const [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS, language: 'future' });
    const updateSetting = vi.fn((key: string, value: unknown) => setSettings(key as never, value as never));
    fixture.context = { settings, updateSetting };
    dispose = render(() => <LearningGoals />, document.body);
    const input = document.querySelector<HTMLInputElement>('input[name="outcome"]')!;
    input.value = 'Read my book'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(settings.learningGoals?.[0]).toMatchObject({ outcome: 'Read my book', language: 'future', status: 'active' });
    expect(settings.learningGoals?.[0].deadline).toBeUndefined();
    const id = settings.learningGoals![0].id;
    const state = document.querySelector<HTMLSelectElement>('select[name="status"]')!;
    state.value = 'paused'; state.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.learningGoals![0]).toMatchObject({ id, status: 'paused', outcome: 'Read my book' });
    const time = document.querySelector<HTMLSelectElement>('select[name="minutes"]')!;
    time.value = '5'; time.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.learningMinutes).toBe(5);
  });
});
