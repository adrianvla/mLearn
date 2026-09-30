/**
 * The ordering the Settings destructive controls used to get wrong.
 *
 * Before `destructiveDataAction` existed, prompt strength ran backwards against
 * blast radius inside one window: the control that replaces the whole profile
 * asked the least (a native `window.confirm`, then a second OS dialog raised
 * from the main process), while the two controls that only reset scheduling —
 * whose previous values stay on screen or in a recovery point — demanded a
 * typed phrase.
 *
 * These lock the ranking, so a new destructive control cannot quietly inherit
 * whatever mechanism its author reached for, and so the two SRS controls cannot
 * drift back into describing one shared action two different ways.
 */

import { describe, expect, it } from 'vitest';
import {
  DESTRUCTIVE_DATA_ACTIONS,
  buildDestructiveDataConfirm,
  confirmDestructiveDataAction,
  destructiveDataAction,
  type DestructiveDataAction,
  type DestructiveDataSeverity,
} from './destructiveDataAction';

const identity = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}{${JSON.stringify(params)}}` : key;

const rank: Record<DestructiveDataSeverity, number> = {
  reversible: 0,
  restorable: 1,
  irreversible: 2,
};

describe('destructive data actions', () => {
  it('ranks the actions so the largest loss is never the weakest prompt', () => {
    const actions = Object.values(DESTRUCTIVE_DATA_ACTIONS);

    // Deleting every card is the one action here that nothing puts back.
    const nuke = destructiveDataAction('deleteAllFlashcards');
    // Importing a profile is wholesale but the outgoing profile is preserved.
    const importAll = destructiveDataAction('importAllData');
    // A settings reset only changes values that are still visible on screen.
    const resetSettings = destructiveDataAction('resetSettings');

    expect(rank[nuke.severity]).toBeGreaterThan(rank[importAll.severity]);
    expect(rank[importAll.severity]).toBeGreaterThan(rank[resetSettings.severity]);
  });

  it('never asks twice for the same action, and never lets two names share one record', () => {
    const ids = Object.values(DESTRUCTIVE_DATA_ACTIONS).map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes every action with a prompt that survives on its own', () => {
    for (const action of Object.values(DESTRUCTIVE_DATA_ACTIONS)) {
      // A body that is just the title tells the user nothing they did not
      // already see on the button.
      expect(action.messageKey).not.toBe(action.titleKey);
      // The verb on the button must come from the action, not the dialog's
      // per-variant default: "Delete" on a reset misdescribes the operation.
      expect(action.confirmTextKey).toMatch(/^mlearn\./);
      expect(action.successKey).toMatch(/^mlearn\./);
    }
  });

  it('builds one prompt from the action, so the title, body and verb cannot disagree', () => {
    const options = buildDestructiveDataConfirm(destructiveDataAction('deleteAllFlashcards'), identity);
    expect(options).toEqual({
      variant: 'danger',
      title: 'mlearn.Settings.SRS.DataManagement.NukeFlashcards.Label',
      message: 'mlearn.Settings.SRS.DataManagement.NukeFlashcards.Confirm',
      confirmText: 'mlearn.Settings.SRS.DataManagement.NukeButton',
    });
  });

  it('softens the prompt only for an action the user can undo from this window', () => {
    expect(buildDestructiveDataConfirm(destructiveDataAction('resetSettings'), identity).variant).toBe('warning');
    expect(buildDestructiveDataConfirm(destructiveDataAction('resetSrs'), identity).variant).toBe('warning');
    expect(buildDestructiveDataConfirm(destructiveDataAction('deleteAllFlashcards'), identity).variant).toBe('danger');
    expect(buildDestructiveDataConfirm(destructiveDataAction('importAllData'), identity).variant).toBe('danger');
  });

  it('passes the parameters a named subject needs into every part of the prompt', () => {
    const action: DestructiveDataAction = {
      ...destructiveDataAction('restoreRecoveryPoint'),
      params: { date: '12 Mar 2024, 09:30' },
    };
    const options = buildDestructiveDataConfirm(action, identity);
    expect(options.title).toContain('12 Mar 2024, 09:30');
    expect(options.message).toContain('12 Mar 2024, 09:30');
  });

  it('asks only when there is something to destroy', () => {
    expect(confirmDestructiveDataAction(0)).toBe(false);
    expect(confirmDestructiveDataAction(1)).toBe(true);
    expect(confirmDestructiveDataAction(449)).toBe(true);
  });

  it('resolves by id to the one record that describes the subject', () => {
    expect(destructiveDataAction('importAllData')).toBe(DESTRUCTIVE_DATA_ACTIONS.importAllData);
  });
});
