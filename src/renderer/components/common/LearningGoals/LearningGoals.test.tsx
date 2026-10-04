// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type LanguageData } from '../../../../shared/types';
const fixture = vi.hoisted(() => ({ context: {} as Record<string, unknown>, data: null as LanguageData | null }));
vi.mock('../../../context', () => ({ useSettings: () => fixture.context, useLocalization: () => ({ t: (key: string) => key }), useLanguage: () => ({ currentLangData: () => fixture.data }) }));
import { LearningGoals } from './LearningGoals';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
const loaded: LanguageData = { name: 'Future', languageData: { version: 'future-v1', assets: [] }, freq: [['chosen', '', 1]], frequencyLevels: { rowLevelIndex: 2 }, learning: { outcomes: {
  'future:curriculum': { label: 'Defined curriculum', provenance: 'package', groups: [{ id: 'required', selectors: [{ source: 'frequency', levels: [1] }] }], requirements: { 'unknown:dimension': { a: [1, 2] } } },
} } };
describe('semantic learning outcome controls', () => {
  it('selects normally loaded membership with no naming, time, status or priority forms', () => {
    const [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS, language: 'future' });
    fixture.data = loaded;
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    dispose = render(() => <LearningGoals />, document.body);
    expect(document.querySelector('input[name="outcome"], select[name="minutes"], select[name="status"], select[name="priority"], textarea')).toBeNull();
    const select = document.querySelector<HTMLSelectElement>('select[name="learning-outcome"]')!;
    select.value = 'future:curriculum'; select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.learningGoals?.[0]).toMatchObject({ outcomeRef: { id: 'future:curriculum', packageVersion: 'future-v1' }, scope: { provenance: 'package', words: ['chosen'], requirements: loaded.learning!.outcomes!['future:curriculum'].requirements } });
    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    date.value = '2027-01-01'; date.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.learningGoals?.[0].deadline).toBe('2027-01-01');
  });
  it('shows only the supplied workload risk without changing the requirement or implying readiness', () => {
    const [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [{
      id: 'scope', language: 'future', outcome: 'Defined curriculum', outcomeRef: { id: 'future:curriculum' },
      status: 'active' as const, priority: 1, createdAt: 1, deadline: '2027-01-01',
    }] });
    fixture.data = loaded;
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    const [warnings, setWarnings] = createStore<Record<string, boolean>>({ scope: true });
    dispose = render(() => <LearningGoals deadlineWarnings={warnings} />, document.body);
    expect(document.querySelector('[role="status"]')?.textContent).toBe('mlearn.Goals.ScopeWorkloadRisk');
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2027-01-01');
    setWarnings('scope', false);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(settings.learningGoals[0].deadline).toBe('2027-01-01');
    expect(document.body.textContent).not.toContain('%');
  });
  it('preserves a legacy commitment without guessing its semantic curriculum', () => {
    const [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS, language: 'future', examGoal: { kind: 'exam' as const, target: 'Read for class', deadline: '2026-12-01' } });
    fixture.data = loaded;
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    dispose = render(() => <LearningGoals />, document.body);
    expect(document.body.textContent).toContain('Read for class');
    expect(settings.examGoal.target).toBe('Read for class');
    expect(settings.learningGoals).toBeUndefined();
  });
});
