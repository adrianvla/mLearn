import { describe, expect, it } from 'vitest';
import { buildWordStatusSourceLabel, getWordStatusChangeAction } from './wordStatusPillLogic';

describe('getWordStatusChangeAction', () => {
  it('shows the status-source warning when a non-manual source already tracks the word', () => {
    expect(getWordStatusChangeAction({
      isInAnki: false,
      hasNonManualSource: true,
      skipAnkiModifyWarning: false,
      skipStatusSourceWarning: false,
    })).toBe('show-status-source-warning');
  });

  it('shows the Anki warning before the status-source warning when the word is in Anki', () => {
    expect(getWordStatusChangeAction({
      isInAnki: true,
      hasNonManualSource: true,
      skipAnkiModifyWarning: false,
      skipStatusSourceWarning: false,
    })).toBe('show-anki-warning');
  });

  it('applies the status change immediately once both warnings are skipped', () => {
    expect(getWordStatusChangeAction({
      isInAnki: true,
      hasNonManualSource: true,
      skipAnkiModifyWarning: true,
      skipStatusSourceWarning: true,
    })).toBe('apply');
  });
});

describe('buildWordStatusSourceLabel', () => {
  it('appends the canonical word when the displayed form resolves to a different original word', () => {
    expect(buildWordStatusSourceLabel({
      prefix: 'Source: ',
      noneLabel: 'None',
      sourceLabels: ['Flashcards'],
      displayedWord: 'なかま',
      canonicalWord: '仲間',
    })).toBe('Source: Flashcards (仲間)');
  });

  it('does not append the canonical word when the displayed word already matches it', () => {
    expect(buildWordStatusSourceLabel({
      prefix: 'Source: ',
      noneLabel: 'None',
      sourceLabels: ['Manual'],
      displayedWord: '仲間',
      canonicalWord: '仲間',
    })).toBe('Source: Manual');
  });
});
