// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { Flashcard } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { OtherLanguageDueHint } from './OtherLanguageDueHint';

const mocks = vi.hoisted(() => ({
  eligible: {} as Record<string, Flashcard>,
  authored: {} as Record<string, Flashcard>,
  updateSetting: vi.fn(), refreshQueue: vi.fn(),
}));
vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string, params?: Record<string, unknown>) => `${key} ${params?.count ?? ''}` }),
  useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, language: 'package-a' }, updateSetting: mocks.updateSetting }),
  useLanguage: () => ({ langData: {} }),
  useFlashcards: () => ({ store: { flashcards: mocks.authored }, getStudyableCards: () => mocks.eligible, refreshQueue: mocks.refreshQueue }),
}));
vi.mock('../common', () => ({ Button: (props: { children?: string; onClick?: () => void }) => <button onClick={props.onClick}>{props.children}</button> }));
const card = (id: string): Flashcard => ({ id, language: 'package-b', content: { type: 'word', front: id, back: 'authored' },
  state: 'review', dueDate: 0, interval: 1, ease: 2.5, reviews: 2, lapses: 0, learningStep: 0, createdAt: 1, lastReviewed: 1, lastUpdated: 1 });
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });
describe('other package due work', () => {
  it('offers switching only for eligible due work while preserving excluded authored cards', () => {
    mocks.authored = { excluded: card('excluded'), eligible: card('eligible') };
    mocks.eligible = { eligible: mocks.authored.eligible };
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <OtherLanguageDueHint />, host);
    expect(host.textContent).toContain('OtherLanguageDue 1');
    host.querySelector('button')!.click();
    expect(mocks.updateSetting).toHaveBeenCalledWith('language', 'package-b');
    expect(mocks.refreshQueue).toHaveBeenCalledOnce();
    expect(Object.keys(mocks.authored)).toHaveLength(2);
    dispose();
  });
  it('does not offer switching when all authored due cards are excluded', () => {
    mocks.authored = { excluded: card('excluded') }; mocks.eligible = {};
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <OtherLanguageDueHint />, host);
    expect(host.querySelector('button')).toBeNull(); dispose();
  });
});
