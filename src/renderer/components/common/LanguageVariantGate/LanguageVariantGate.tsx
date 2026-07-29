import { Component, For, Show, createMemo } from 'solid-js';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import { canonicalLanguage, resolveActiveVariantId } from '../../../../shared/languageVariants';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { Btn } from '../Button';
import { Modal } from '../Modal';
import './LanguageVariantGate.css';

export const LanguageVariantGate: Component = () => {
  const { settings, updateSetting } = useSettings();
  const { langData } = useLanguage();
  const { t } = useLocalization();
  const language = createMemo(() => canonicalLanguage(settings.language, langData));
  const variants = createMemo(() => langData[language()]?.variants);
  const needsChoice = createMemo(() => Boolean(
    variants() && Object.keys(variants()!).length > 0
      && !resolveActiveVariantId(settings, language()),
  ));

  return (
    <Show when={needsChoice()}>
      <Modal
        isOpen
        onClose={() => undefined}
        closeOnEscape={false}
        closeOnOverlay={false}
        showCloseButton={false}
        headerDraggable={false}
        title={t('mlearn.Settings.Variant.RequiredTitle')}
        subtitle={t('mlearn.Settings.Variant.RequiredDescription')}
        panelClass="language-variant-gate"
      >
        <fieldset class="language-variant-gate-options">
          <legend>{t('mlearn.Settings.Variant.Choose')}</legend>
          <For each={Object.entries(variants() ?? {})}>
            {([variantId, variant]) => (
              <Btn
                variant="secondary"
                onClick={() => updateSetting('languageVariants', {
                  ...(settings.languageVariants ?? DEFAULT_SETTINGS.languageVariants),
                  [language()]: variantId,
                })}
              >
                <Show when={variant.flagEmoji}><span aria-hidden="true">{variant.flagEmoji} </span></Show>
                {variant.name_translated ?? variant.name}
              </Btn>
            )}
          </For>
        </fieldset>
      </Modal>
    </Show>
  );
};
