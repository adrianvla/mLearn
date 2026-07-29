// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageDataMap, Settings } from '../../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../../shared/types';

let settings: Settings;
let languageData: LanguageDataMap;
const updateSetting = vi.fn();

vi.mock('../../../context', () => ({
  useSettings: () => ({ settings, updateSetting }),
  useLanguage: () => ({ langData: languageData }),
  useLocalization: () => ({ t: (key: string) => key }),
}));

vi.mock('../Modal', () => ({
  Modal: (props: { children?: JSX.Element }) => <section data-testid="variant-gate">{props.children}</section>,
}));

import { LanguageVariantGate } from './LanguageVariantGate';

describe('LanguageVariantGate', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    settings = { ...DEFAULT_SETTINGS, language: 'zh', languageVariants: {} };
    languageData = {
      zh: {
        name: 'Chinese',
        variants: {
          'zh-Hans': { name: 'Simplified', overrides: {} },
          'zh-Hant': { name: 'Traditional', flagEmoji: '🇨🇳', overrides: {} },
        },
      },
    };
  });

  afterEach(() => {
    container.remove();
  });

  it('blocks variant languages without a close or cancel affordance', () => {
    render(() => <LanguageVariantGate />, container);

    expect(container.textContent).toContain('Simplified');
    expect(container.textContent).toContain('Traditional');
    expect(container.querySelector('[aria-label*="Close"], [data-close], button[name="cancel"]')).toBeNull();
    (container.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(updateSetting).toHaveBeenCalledWith('languageVariants', { zh: 'zh-Hant' });
  });

  it('clears after a choice and never gates a language without variants', () => {
    settings = { ...settings, languageVariants: { zh: 'zh-Hans' } };
    render(() => <LanguageVariantGate />, container);
    expect(container.querySelector('[data-testid="variant-gate"]')).toBeNull();

    settings = { ...DEFAULT_SETTINGS, language: 'ja', languageVariants: {} };
    languageData = { ja: { name: 'Japanese' } };
    render(() => <LanguageVariantGate />, container);
    expect(container.querySelector('[data-testid="variant-gate"]')).toBeNull();
  });
});
