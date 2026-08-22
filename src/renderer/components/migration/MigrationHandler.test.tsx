// @vitest-environment happy-dom

import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanguageDataMap } from '@shared/types';

const mocks = vi.hoisted(() => ({
  runZhVariantCleanup: vi.fn<(languageData: LanguageDataMap) => Promise<boolean>>(),
  useLanguage: vi.fn<() => { langData: LanguageDataMap }>(),
}));

vi.mock('@renderer/context/LanguageContext', () => ({ useLanguage: mocks.useLanguage }));
vi.mock('@renderer/context/LocalizationContext', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/context/migrationSignals', () => ({
  consumePendingFlashcardMigration: () => null,
  setMigrationListenerReady: vi.fn(),
}));
vi.mock('@renderer/services/zhVariantCleanup', () => ({ runZhVariantCleanup: mocks.runZhVariantCleanup }));
vi.mock('@renderer/components/common/Feedback/Toast', () => ({ showToast: vi.fn() }));

describe('MigrationHandler', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it('runs legacy cleanup when canonical language data becomes available', async () => {
    const [langData, setLangData] = createStore<LanguageDataMap>({});
    mocks.useLanguage.mockReturnValue({ langData });
    mocks.runZhVariantCleanup.mockResolvedValue(true);
    const { MigrationHandler } = await import('./MigrationHandler');
    const dispose = render(() => <MigrationHandler>content</MigrationHandler>, document.body);

    expect(mocks.runZhVariantCleanup).not.toHaveBeenCalled();
    setLangData('zh', { name: 'Mandarin Chinese', legacyCodes: ['zh-Hans', 'zh-Hant'] });
    await Promise.resolve();

    expect(mocks.runZhVariantCleanup).toHaveBeenCalledWith(langData);
    dispose();
  });
});
