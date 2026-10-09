// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type LanguageData, type Settings } from '../../../../shared/types';
import type { LearningGoalRequirementEvaluation } from '../../../../shared/learningRequirementEvaluation';
import { evaluateLearningRequirements } from '../../../../shared/learningRequirementEvaluation';
import { learningGoalSemanticBasis, revalidateLearningGoal } from '../../../../shared/learningGoalCompatibility';
import { learningScopeForSettings } from '../../../../shared/learningScope';
import { policyContextFromSettings } from '../../../learning/policyContext';
import { fitLearningModel } from '../../../../shared/learningModel';
const fixture = vi.hoisted(() => ({ context: {} as Record<string, unknown>, data: null as LanguageData | null,
  translate: (key: string, params?: Record<string, string>) => params ? `${key} ${Object.values(params).join(' ')}` : key }));
vi.mock('../../../context', () => ({ useSettings: () => fixture.context, useLocalization: () => ({ t: fixture.translate }), useLanguage: () => ({ currentLangData: () => fixture.data }) }));
import { LearningGoals } from './LearningGoals';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); fixture.translate = (key, params) => params ? `${key} ${Object.values(params).join(' ')}` : key; document.body.replaceChildren(); });
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
    expect(settings.learningGoals?.[0]).toMatchObject({ outcomeRef: { id: 'future:curriculum', packageVersion: 'future-v1' }, scope: { provenance: 'package', words: ['chosen'] } });
    expect(settings.learningGoals?.[0].scope).not.toHaveProperty('requirements');
    expect(loaded.learning!.outcomes!['future:curriculum'].requirements).toEqual({ 'unknown:dimension': { a: [1, 2] } });
    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    date.value = '2027-01-01'; date.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.learningGoals?.[0].deadline).toBe('2027-01-01');
  });
  it('shows only the supplied workload risk without changing the requirement or implying readiness', () => {
    const [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [{
      id: 'scope', language: 'future', outcome: 'Defined curriculum', outcomeRef: { id: 'future:curriculum', semanticBasis: learningGoalSemanticBasis(loaded, { id: 'future:curriculum' }) },
      status: 'active' as const, priority: 1, createdAt: 1, deadline: '2027-01-01',
    }] });
    fixture.data = loaded;
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    const [warnings, setWarnings] = createStore<Record<string, boolean>>({ scope: true });
    dispose = render(() => <LearningGoals deadlineWarnings={warnings} />, document.body);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('mlearn.Goals.ScopeWorkloadRisk 2027-01-01');
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2027-01-01');
    setWarnings('scope', false);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(settings.learningGoals[0].deadline).toBe('2027-01-01');
    expect(document.body.textContent).not.toContain('%');
  });
  it('shares a selected package subset across remount and preserves unrelated legacy data when clearing it', async () => {
    const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [{
      id: 'old', language: 'future', outcome: 'Personal project', status: 'active' as const, priority: 1, createdAt: 1,
    }] });
    fixture.data = { ...loaded, grammar: [{ pattern: 'construction', meaning: 'Meaning', level: 1 }], learning: { outcomes: {
      'future:curriculum': { ...loaded.learning!.outcomes!['future:curriculum'], groups: [
        { id: 'words', label: 'Vocabulary material', selectors: [{ source: 'frequency', levels: [1] }] },
        { id: 'grammar', label: 'Construction material', selectors: [{ source: 'grammar' }] },
      ] },
    } } };
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    dispose = render(() => <LearningGoals />, document.body);
    const select = document.querySelector<HTMLSelectElement>('select[name="learning-outcome"]')!;
    select.value = 'future:curriculum'; select.dispatchEvent(new Event('change', { bubbles: true }));
    const subset = document.querySelector<HTMLSelectElement>('select[name="learning-subset"]')!;
    expect(subset).not.toBeNull();
    subset.value = 'grammar'; subset.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.learningGoals![1].outcomeRef?.groupIds).toEqual(['grammar']);
    dispose(); document.body.replaceChildren();
    dispose = render(() => <LearningGoals />, document.body);
    await Promise.resolve();
    expect(document.querySelector<HTMLSelectElement>('select[name="learning-subset"]')?.value).toBe('grammar');
    expect(document.body.textContent).not.toContain('Personal project');
    document.querySelector<HTMLButtonElement>('button')!.click();
    expect(settings.learningGoals).toEqual([{ id: 'old', language: 'future', outcome: 'Personal project', status: 'active', priority: 1, createdAt: 1 }]);
  });
  it('preserves legacy data outside the active requirement UI', () => {
    const [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS, language: 'future', examGoal: { kind: 'exam' as const, target: 'Read for class', deadline: '2026-12-01' } });
    fixture.data = loaded;
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    dispose = render(() => <LearningGoals />, document.body);
    expect(document.body.textContent).not.toContain('Read for class');
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(settings.examGoal.target).toBe('Read for class');
    expect(settings.learningGoals).toBeUndefined();
  });

  it('preserves user-owned scope through edits and reports a pinned package version mismatch', () => {
    const userScope = { provenance: 'user' as const, reference: 'personal plan', words: ['personal'],
      requirements: { conditions: [{ id: 'opaque-user-rule', kind: 'future::rule', payload: { nested: [1, 'x'] } }] } };
    const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [{
      id: 'pinned', language: 'future', outcome: 'Defined curriculum', outcomeRef: { id: 'future:curriculum', packageVersion: 'future-v0' },
      status: 'active', priority: 1, createdAt: 1, scope: userScope,
    }] });
    fixture.data = loaded;
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    dispose = render(() => <LearningGoals />, document.body);

    expect(document.querySelector('[role="status"]')?.textContent).toBe('mlearn.Goals.Unavailable');
    document.querySelector<HTMLInputElement>('input[type="date"]')!.value = '2027-02-01';
    document.querySelector<HTMLInputElement>('input[type="date"]')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.learningGoals![0].deadline).toBe('2027-02-01');
    expect(JSON.parse(JSON.stringify(settings.learningGoals![0].scope))).toEqual(userScope);
  });

  it('shows the saved target, selected group, date and canonical evaluator results for an unavailable package', () => {
    const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [{
      id: 'pinned', language: 'future', outcome: 'Personal curriculum',
      outcomeRef: { id: 'future:curriculum', packageVersion: 'future-v0', groupIds: ['required'] },
      status: 'active', priority: 1, createdAt: 1, deadline: '2027-04-05',
      scope: { provenance: 'community', reference: 'Community workbook', words: ['chosen'] },
    }] });
    fixture.data = loaded;
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    const evaluations: LearningGoalRequirementEvaluation[] = [{
      goalId: 'pinned', language: 'future', outcomeId: 'future:curriculum', status: 'unmet',
      modelVersion: 'model-v1', evidenceVersion: 'events-v1',
      requirements: [
        { requirementId: 'package::opaque-rule', source: 'package', kind: 'future-rule', status: 'met',
          conditions: { label: 'Structured future condition', dimensions: { arbitrary: ['one', 2] } } },
        { requirementId: 'package::other-rule', source: 'package', kind: 'future-rule', status: 'unknown',
          conditions: { dimensions: { unrecognized: { nested: true } } } },
      ],
    }];

    dispose = render(() => <LearningGoals compact summaryOnly onEdit={() => {}} requirementEvaluations={evaluations} />, document.body);

    expect(document.body.textContent).toContain('Personal curriculum');
    expect(document.body.textContent).toContain('required');
    expect(document.body.textContent).toContain('mlearn.Goals.Source.community · Community workbook');
    expect(document.body.textContent).toContain('2027-04-05');
    expect(document.body.textContent).toContain('mlearn.Goals.Unavailable');
    expect(document.body.textContent).toContain('Structured future condition');
    expect(document.body.textContent).toContain('mlearn.Goals.RequirementStatus.met');
    expect(document.body.textContent).toContain('package::other-rule');
    expect(document.body.textContent).toContain('mlearn.Goals.RequirementStatus.unknown');
    expect(document.querySelector('select[name="learning-outcome"]')).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.body.textContent).not.toContain('unrecognized');
  });

  it('renders multiple saved outcomes and overdue dates as separate targets', () => {
    const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [
      { id: 'first', language: 'future', outcome: 'Defined curriculum', outcomeRef: { id: 'future:curriculum' }, status: 'active', priority: 2, createdAt: 1 },
      { id: 'second', language: 'future', outcome: 'Independent path', outcomeRef: { id: 'future:independent' }, status: 'active', priority: 1, createdAt: 2, deadline: '2025-01-01' },
    ] });
    fixture.data = { ...loaded, learning: { outcomes: { ...loaded.learning!.outcomes,
      'future:independent': { label: 'Independent package path', provenance: 'package', groups: [{ id: 'open', selectors: [{ source: 'frequency', words: ['chosen'] }] }] },
    } } };
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    setSettings('learningGoals', settings.learningGoals!.map(goal => revalidateLearningGoal(goal, fixture.data)!));
    dispose = render(() => <LearningGoals compact summaryOnly onEdit={() => {}} />, document.body);

    expect(document.querySelectorAll('.learning-goals__constraints')).toHaveLength(2);
    expect(document.body.textContent).toContain('Defined curriculum');
    expect(document.body.textContent).toContain('Independent package path');
    expect(document.body.textContent).toContain('2025-01-01');
    expect(document.body.textContent).toContain('mlearn.Goals.Passed');
  });

  it('keeps Explore as the target summary and renders its label through the selected UI locale', () => {
    const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, language: 'future', learningLanguageLevels: { future: 9 } });
    fixture.data = loaded;
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    fixture.translate = (key, params) => key === 'mlearn.Goals.Explore' ? '言語を学ぶ'
      : params ? `${key} ${Object.values(params).join(' ')}` : key;
    dispose = render(() => <LearningGoals compact summaryOnly onEdit={() => {}} />, document.body);

    expect(document.body.textContent).toContain('言語を学ぶ');
    expect(document.body.textContent).not.toContain('Band 9');
    expect(document.querySelector('select[name="learning-outcome"]')).toBeNull();
    fixture.translate = (key, params) => params ? `${key} ${Object.values(params).join(' ')}` : key;
  });

  it('recomputes Task05 evaluation after saving a package target', () => {
    const targetData: LanguageData = { ...loaded, learning: { outcomes: {
      'future:curriculum': { ...loaded.learning!.outcomes!['future:curriculum'], requirements: { conditions: [{
        id: 'future::recall-condition', kind: 'canonical-capability-threshold', groupIds: ['required'],
        capability: 'future::arbitrary-recall', minimum: 0.6,
      }] } },
    } } };
    const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, language: 'future' });
    fixture.data = targetData;
    const model = fitLearningModel([], 1000);
    const evaluations = () => evaluateLearningRequirements(settings.learningGoals ?? [], 'future', model, [], targetData, 1000);
    fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
    dispose = render(() => <LearningGoals requirementEvaluations={evaluations()} />, document.body);
    expect(evaluations()).toHaveLength(0);

    const selector = document.querySelector<HTMLSelectElement>('select[name="learning-outcome"]')!;
    selector.value = 'future:curriculum'; selector.dispatchEvent(new Event('change', { bubbles: true }));

    expect(settings.learningGoals).toHaveLength(1);
    expect(evaluations()[0]?.requirements[0]).toMatchObject({ requirementId: 'future::recall-condition', status: 'unknown' });
    dispose(); document.body.replaceChildren();
    dispose = render(() => <LearningGoals compact summaryOnly requirementEvaluations={evaluations()} />, document.body);
    expect(document.body.textContent).toContain('future::recall-condition');
    expect(document.body.textContent).toContain('mlearn.Goals.RequirementStatus.unknown');
  });
});

it('retains edited intent through a dictionary-only package update in the actual resolver and policy consumer', () => {
  const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, language: 'future' });
  fixture.data = loaded;
  fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
  dispose = render(() => <LearningGoals />, document.body);
  const selector = document.querySelector<HTMLSelectElement>('select[name="learning-outcome"]')!;
  selector.value = 'future:curriculum'; selector.dispatchEvent(new Event('change', { bubbles: true }));
  const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
  date.value = '2027-04-05'; date.dispatchEvent(new Event('change', { bubbles: true }));
  const before = JSON.parse(JSON.stringify(settings.learningGoals![0]));
  const updated = { ...loaded, languageData: { ...loaded.languageData!, version: 'future-v2', bundleSha256: 'changed-dictionary-bytes' } };
  const model = fitLearningModel([], 1000);
  const scope = learningScopeForSettings(settings, updated, 'future');
  expect(scope.unavailable).toEqual([]); expect(scope.goals).toHaveLength(1);
  const policy = policyContextFromSettings(settings, 'future', { model, events: [], data: updated, nowMs: 1000 });
  expect(policy.goals?.[0]).toMatchObject({ id: before.id, deadline: before.deadline, priority: before.priority });
  expect(policy.requirementEvaluations?.[0].requirements).not.toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'package-version-unavailable' })]));
  expect(JSON.parse(JSON.stringify(settings.learningGoals![0]))).toEqual(before);
  expect(model).toEqual(fitLearningModel([], 1000));
});

it('requires explicit revalidation of a legacy same-version goal and preserves intent and its history', () => {
  const original = { id: 'legacy-same-version', language: 'future', outcome: 'Original scope', status: 'active' as const, priority: 7,
    createdAt: 1, deadline: '2027-01-02', outcomeRef: { id: 'future:curriculum', packageVersion: 'future-v1' },
    scope: { provenance: 'user' as const, requirements: { arbitrary: { future: [1, 2] } } } };
  const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [original] });
  fixture.data = loaded; fixture.context = { settings, updateSetting: (key: string, value: unknown) => setSettings(key as never, value as never) };
  dispose = render(() => <LearningGoals />, document.body);
  expect(learningScopeForSettings(settings, loaded).unavailable).toEqual([original.id]);
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'mlearn.Goals.Revalidate')!;
  expect(button).toBeDefined(); button.click();
  expect(settings.learningGoals![0]).toMatchObject({ id: original.id, deadline: original.deadline, priority: 7, scope: original.scope });
  expect(settings.learningGoals![0].outcomeRef!.bindingHistory).toHaveLength(1);
  expect(learningScopeForSettings(settings, loaded).unavailable).toEqual([]);
});
