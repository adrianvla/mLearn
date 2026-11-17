/** Reader failures reach the learner as a few plain states with one action.
 * Native/library error text stays out of rendered copy.
 */
export type ReaderNotice = {
    readonly message: string;
    readonly action: 'retry' | 'install' | null;
};

export const notices = {
    openFailed: { message: 'This source couldn’t be opened.', action: 'retry' },
    pagesFailed: { message: 'This page couldn’t be shown.', action: 'retry' },
    settingsFailed: { message: 'The page layout couldn’t be saved.', action: 'retry' },
    recognitionFailed: { message: 'Text recognition didn’t finish.', action: 'retry' },
    recognitionStopped: { message: 'Text recognition stopped.', action: 'retry' },
    recognitionNotInstalled: { message: 'Text recognition isn’t installed for this language.', action: 'install' },
    recognitionUnavailable: { message: 'Text recognition isn’t available on this device.', action: null },
    lookupFailed: { message: 'Words on this page couldn’t be looked up.', action: 'retry' },
    saveFailed: { message: 'Your reading position wasn’t saved.', action: 'retry' },
    contentsFailed: { message: 'Contents couldn’t be loaded.', action: 'retry' },
    correctionFailed: { message: 'The correction wasn’t saved.', action: 'retry' },
} as const satisfies Record<string, ReaderNotice>;
