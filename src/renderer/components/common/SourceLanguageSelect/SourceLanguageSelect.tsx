import { For, Show, type Component } from 'solid-js';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import type { MediaSourceLanguageScope } from '../../../hooks/useMediaSourceLanguage';
import './SourceLanguageSelect.css';

export const SourceLanguageSelect: Component<{ scope: MediaSourceLanguageScope }> = props => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const languages = useLanguage();
  const options = () => languages.supportedLanguages();
  const change = (language: string) => {
    const variantId = (settings.languageVariants ?? DEFAULT_SETTINGS.languageVariants)[language];
    void props.scope.select({ language, ...(variantId ? { variantId } : {}) }).catch(() => { /* Owner exposes write failure and retry below. */ });
  };
  return <Show when={props.scope.active()}>
    <div class="source-language-control">
      <label class="source-language-label">
        <span>{t('mlearn.Media.SourceLanguage')}</span>
        <select value={props.scope.language()} disabled={props.scope.saving()} onChange={event => change(event.currentTarget.value)}>
          <Show when={!options().includes(props.scope.language())}><option value={props.scope.language()}>{props.scope.language()}</option></Show>
          <For each={options()}>{language => <option value={language}>{languages.langData[language]?.name ?? language}</option>}</For>
        </select>
      </label>
      <Show when={props.scope.active()?.selection.basis === 'fallback'}><small>{t('mlearn.Media.SourceLanguageFallback')}</small></Show>
      <Show when={props.scope.active()?.selection.authoredLanguages.length !== 1 && (props.scope.active()?.selection.authoredLanguages.length ?? 0) > 0}>
        <small>{t('mlearn.Media.MixedSourceLanguage')}</small>
      </Show>
      <Show when={props.scope.error()}>
        <span role="alert">{t('mlearn.Media.SourceLanguageSaveFailed')}</span>
        <button type="button" onClick={() => { const preference = props.scope.lastSelection(); if (preference) void props.scope.select(preference).catch(() => {}); }}>{t('mlearn.Media.RetrySourceLanguage')}</button>
      </Show>
    </div>
  </Show>;
};
