/**
 * One prompt, one ranking, for every control in Settings that destroys data.
 *
 * Settings is a single window holding five controls that can put a learner's
 * work at risk. Before this existed they were four independently authored
 * mechanisms, and the strength of the prompt ran *backwards* against the size
 * of the blast radius:
 *
 *   Import All Data      destroys cards + knowledge db + media + settings
 *                        -> `window.confirm` in the renderer, then a *second*
 *                           OS dialog in the main process
 *   Reset Settings       puts every option back to a default that is visible
 *                        in this same window
 *                        -> `window.confirm` in the renderer
 *   Delete All Flashcards destroys every card
 *                        -> Modal + typed phrase "DELETE"
 *   Reset SRS Data       clears only scheduling, keeps the card content
 *                        -> Modal + typed phrase "RESET"
 *   Restore a recovery point replaces live data with a snapshot
 *                        -> OS dialog in the main process, invisible to the
 *                           window that asked for it
 *
 * So the action that could destroy the most asked the least, and the two
 * actions that were cheapest to undo asked the most. The typed phrase in
 * particular was not proportional: the information it carried was the *list of
 * what disappears*, which belongs in the body the user reads, not in a
 * keyboard drill that a user who wants the action will simply copy.
 *
 * The rank below replaces all of that with one ordering. It is derived from
 * what the operation does, not from which tab it lives in, so a new
 * destructive control has to be placed deliberately rather than inheriting
 * whatever its author reached for:
 *
 *   'reversible'  -> the operation's own effect can be undone from this
 *                     window (a reset whose previous values are all still on
 *                     screen). Confirm once; no extra gate.
 *   'restorable'  -> the data is replaced wholesale, but the pre-action
 *                     profile is preserved in a Guardian recovery point that
 *                     this same window lists. Confirm once, and say so.
 *   'irreversible'-> nothing puts the data back. Confirm once, and name
 *                     exactly what is lost.
 *
 * Every one of them goes through the app's own ConfirmDialog. The native
 * `window.confirm` is not just weaker styling: it is an OS-level window that
 * `Page.captureScreenshot` cannot see and that a user who is looking at the
 * Settings list has to hunt for.
 */

export type TranslateKey = (key: string, params?: Record<string, string | number>) => string;

export type DestructiveDataSeverity = 'reversible' | 'restorable' | 'irreversible';

export type DestructiveDataSubject = 'settings' | 'flashcards' | 'srs' | 'allData' | 'recoveryPoint';

/**
 * One destructive control, described once.
 *
 * The description is data rather than JSX so the ranking, the button verb and
 * the prompt can all be checked by a test without rendering a modal.
 */
export interface DestructiveDataAction {
  id: string;
  /** How much the learner stands to lose, and therefore how hard we ask. */
  severity: DestructiveDataSeverity;
  /** What the operation destroys, in the user's terms rather than the store's. */
  subject: DestructiveDataSubject;
  /** The locale key for the prompt title. */
  titleKey: string;
  /** The locale key for the prompt body, explaining the consequence. */
  messageKey: string;
  /** The locale key for the button that goes ahead. */
  confirmTextKey: string;
  /** The locale key reported after the operation has run. */
  successKey: string;
  /** Free-form params for the message, e.g. a formatted date. */
  params?: Record<string, string>;
}

export interface DestructiveDataConfirmOptions {
  variant: 'danger' | 'warning';
  title: string;
  message: string;
  confirmText: string;
}

const CONFIRM_VARIANT: Record<DestructiveDataSeverity, 'danger' | 'warning'> = {
  // A reset whose previous values remain visible on screen does not warrant a
  // red button; the user can see and put back what changed.
  reversible: 'warning',
  // The data leaves the live profile, but this same window lists where it went.
  restorable: 'danger',
  irreversible: 'danger',
};

/**
 * The prompt for a destructive control, built from the action's description.
 *
 * Kept beside the severity table so a control cannot be ranked one way and
 * described another: the title, the body, the verb and the colour all come
 * from the same single record.
 */
export function buildDestructiveDataConfirm(
  action: DestructiveDataAction,
  t: TranslateKey,
): DestructiveDataConfirmOptions {
  return {
    variant: CONFIRM_VARIANT[action.severity],
    title: t(action.titleKey, action.params),
    message: t(action.messageKey, action.params),
    confirmText: t(action.confirmTextKey, action.params),
  };
}

/**
 * Every destructive control in Settings, named by what it destroys.
 *
 * The subjects are the product's own vocabulary, not the tab layout: the same
 * operation reached from a different tab resolves to the same record, so two
 * surfaces cannot describe one action two different ways.
 */
export const DESTRUCTIVE_DATA_ACTIONS = {
  /**
   * `updateSettings(DEFAULT_SETTINGS)` — the previous values are not stored
   * anywhere, but they were all chosen by the user and are all still visible on
   * screen, so putting one back is a normal edit rather than a restore.
   */
  resetSettings: {
    id: 'resetSettings',
    severity: 'reversible',
    subject: 'settings',
    titleKey: 'mlearn.Settings.Data.ResetSettings.Label',
    messageKey: 'mlearn.Settings.Data.ResetSettings.Confirm',
    confirmTextKey: 'mlearn.Global.Reset',
    successKey: 'mlearn.Settings.UI.ResetSuccess',
  },
  /**
   * Guardian validates the archive, swaps the whole profile and keeps the
   * outgoing one as a recovery point this window can list — so the prompt says
   * that, instead of a bare "cannot be undone" that the copy used to claim
   * while a recovery point was in fact being written.
   */
  importAllData: {
    id: 'importAllData',
    severity: 'restorable',
    subject: 'allData',
    titleKey: 'mlearn.Settings.Data.ImportAllData.Label',
    messageKey: 'mlearn.Settings.Data.ImportAllData.Confirm',
    confirmTextKey: 'mlearn.Settings.Data.ImportAllData.ConfirmAction',
    successKey: 'mlearn.Settings.Data.ImportAllData.Success',
  },
  /** `resetSRS()` — scheduling only; the card content is untouched. */
  resetSrs: {
    id: 'resetSrs',
    severity: 'reversible',
    subject: 'srs',
    titleKey: 'mlearn.Settings.SRS.DataManagement.ResetSRS.Label',
    messageKey: 'mlearn.Settings.SRS.DataManagement.ResetSRS.Confirm',
    confirmTextKey: 'mlearn.Settings.SRS.DataManagement.ResetButton',
    successKey: 'mlearn.Settings.SRS.DataManagement.ResetSRS.Success',
  },
  /** `nukeAllFlashcards()` — every card, plus the progress built on them. */
  deleteAllFlashcards: {
    id: 'deleteAllFlashcards',
    severity: 'irreversible',
    subject: 'flashcards',
    titleKey: 'mlearn.Settings.SRS.DataManagement.NukeFlashcards.Label',
    messageKey: 'mlearn.Settings.SRS.DataManagement.NukeFlashcards.Confirm',
    confirmTextKey: 'mlearn.Settings.SRS.DataManagement.NukeButton',
    successKey: 'mlearn.Settings.SRS.DataManagement.NukeFlashcards.Success',
  },
  /**
   * Replaces the live profile with a snapshot and quarantines what was live.
   * Reversible in the same way an import is, in the opposite direction.
   */
  restoreRecoveryPoint: {
    id: 'restoreRecoveryPoint',
    severity: 'restorable',
    subject: 'recoveryPoint',
    titleKey: 'mlearn.Settings.Data.Guardian.ConfirmTitle',
    messageKey: 'mlearn.Settings.Data.Guardian.ConfirmMessage',
    confirmTextKey: 'mlearn.Settings.Data.Guardian.ConfirmRestore',
    successKey: 'mlearn.Settings.Data.Guardian.RestoreQueued',
  },
} as const satisfies Record<string, DestructiveDataAction>;

export type DestructiveDataActionId = keyof typeof DESTRUCTIVE_DATA_ACTIONS;

/**
 * Resolve an action by subject, so a surface that owns a subject reaches the
 * one record that describes it instead of restating the prompt.
 */
export function destructiveDataAction(id: DestructiveDataActionId): DestructiveDataAction {
  return DESTRUCTIVE_DATA_ACTIONS[id];
}

/**
 * Whether this action has to be confirmed before it runs.
 *
 * The one rule, so no surface can decide it locally: ask whenever the
 * operation would destroy anything, and run in one click only when it would
 * destroy nothing. A control that skips the dialog while there is data to lose
 * is the bug this owner was written to prevent, and so is a control that asks
 * on every click regardless of what is actually there — a dialog the user
 * learns to dismiss is not a guard.
 *
 * `destroyedCount` is everything the operation would take away, counted by the
 * caller from the live store. It has to be the *whole* subject, not the part
 * of it that is easiest to count: `nukeAllFlashcards` also clears word
 * knowledge, grammar knowledge, daily statistics, word candidates and the
 * known-word list, so a profile with no cards but a year of passive word
 * knowledge still has something to lose. Counting only the cards would skip
 * the prompt on exactly the profile where the loss is invisible.
 */
export function confirmDestructiveDataAction(destroyedCount: number): boolean {
  return destroyedCount > 0;
}
