/**
 * Edit Translation Dialog Component
 * Modal dialog for editing word translation data (reading, prosody, definitions)
 */

import { Component, createMemo, createSignal, onMount, Show } from 'solid-js';
import { useTranslation } from '../../../hooks/useTranslation';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { getDictionaryTargetLanguageForSettings } from '../../../utils/dictionaryTargetLanguage';
import {
  Input,
  Modal,
  ModalFooter,
  Spinner,
  FormField,
  Textarea,
  ContentEditable,
  AlertBanner,
  Btn,
} from '../../../components/common';
import { ProsodyOverlay } from '../../../components/language-specific';
import type { FlashcardProsody, TranslationResponse } from '@shared/types';
import { extractProsodyFromTranslationData } from '../../../utils/readingProsody';
import {
  getProsodyPositionCategoryLabel,
  getProsodyPositionFieldLabel,
  getProsodyPositionFieldPlaceholder,
  getProsodyOverlayRenderer,
} from '../../../utils/prosodyPresentation';
import {
  createProsodyForPosition,
  createProsodyRawPayloadForPosition,
  getLanguageProsodyType,
  getProsodyPositionFromOverride,
  languageSupportsProsody,
} from '@shared/languageFeatures';
import { prosodyVisible } from '@shared/prosodySettings';
import './EditTranslationDialog.css';
import { getLogger } from '@shared/utils/logger';

const log = getLogger("renderer.wordDbEditor.editTranslationDialog");

export interface EditTranslationDialogProps {
  word: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: TranslationOverride) => void;
  initialData?: TranslationOverride | null;
}

export interface TranslationOverride {
  reading: string;
  prosodyPosition: number | null;
  prosody?: FlashcardProsody;
  definitions: string[];
  structuredContent?: string;
}

export const EditTranslationDialog: Component<EditTranslationDialogProps> = (props) => {
  const { settings } = useSettings();
  const { getCanonicalForm, getWordVariants, getReadingVariants, currentLangData } = useLanguage();
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));
  const { translateWord, setOverride } = useTranslation({
    language: settings.language,
    getCanonicalForm,
    getWordVariants,
    getReadingVariants,
    dictionaryTargetLanguage,
    languageData: currentLangData,
  });
  const { t } = useLocalization();
  
  const [reading, setReading] = createSignal('');
  const [prosodyPositionInput, setProsodyPositionInput] = createSignal<string>('');
  const [definitions, setDefinitions] = createSignal('');
  const [structuredContent, setStructuredContent] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const prosodyOverlayRenderer = createMemo(() => getProsodyOverlayRenderer(currentLangData()));
  const usesProsodyOverlayRenderer = createMemo(() => prosodyOverlayRenderer() !== null && prosodyVisible(settings));
  const supportsProsodyPosition = createMemo(() => languageSupportsProsody(currentLangData()) && prosodyVisible(settings));
  const prosodyPositionLabel = createMemo(() => getProsodyPositionFieldLabel(currentLangData(), t));
  const prosodyPositionPlaceholder = createMemo(() => getProsodyPositionFieldPlaceholder(currentLangData(), t));

  /** Parse translation response data into form fields */
  const applyTranslationData = (data: unknown[]) => {
    const firstEntry = data[0] as Record<string, unknown> | undefined;
    const secondEntry = data[1] as Record<string, unknown> | undefined;
    let nextReading = '';

    if (firstEntry) {
      nextReading = (firstEntry.reading as string) || '';
      setReading(nextReading);
      const defs = firstEntry.definitions;
      setDefinitions(Array.isArray(defs) ? defs.join('\n') : (defs as string || ''));
    }
    if (secondEntry?.definitions) {
      setStructuredContent(String(secondEntry.definitions));
    } else {
      setStructuredContent('');
    }
    if (!supportsProsodyPosition()) {
      setProsodyPositionInput('');
    } else {
      const prosody = extractProsodyFromTranslationData({ data }, currentLangData(), nextReading);
      const prosodyPosition = getProsodyPositionFromOverride(null, prosody ?? undefined);
      setProsodyPositionInput(prosodyPosition !== null ? String(prosodyPosition) : '');
    }
  };
  
  // Load initial data when dialog opens
  onMount(async () => {
    if (props.initialData) {
      const initialProsodyPosition = getProsodyPositionFromOverride(props.initialData.prosodyPosition, props.initialData.prosody);
      setReading(props.initialData.reading || '');
      setProsodyPositionInput(supportsProsodyPosition() && initialProsodyPosition !== null ? String(initialProsodyPosition) : '');
      setDefinitions(props.initialData.definitions.join('\n'));
      setStructuredContent(props.initialData.structuredContent || '');
    } else {
      setIsLoading(true);
      try {
        const translation = await translateWord(props.word);
        if (translation?.data) {
          applyTranslationData(translation.data);
        }
      } catch (e) {
        log.error('Failed to load translation data:', e);
      } finally {
        setIsLoading(false);
      }
    }
  });
  
  const prosodyCategoryName = (p: number | null): string => {
    if (p === null || p === undefined || Number.isNaN(p)) return '—';
    return getProsodyPositionCategoryLabel(currentLangData(), p, reading() || props.word, t) || '—';
  };

  const genericProsodyPreview = createMemo(() => {
    if (usesProsodyOverlayRenderer()) return null;
    if (!supportsProsodyPosition()) return null;
    const prosodyPositionText = prosodyPositionInput().trim();
    if (!prosodyPositionText) return null;
    const position = Number(prosodyPositionText);
    if (!Number.isFinite(position) || position < 0) return null;
    return {
      label: prosodyPositionLabel(),
      position,
      type: getLanguageProsodyType(currentLangData()) ?? '',
    };
  });
  
  const handleSave = async () => {
    try {
      setError(null);
      const defsArr = definitions()
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      
      const prosodyPositionText = prosodyPositionInput().trim();
      const prosodyPosition = supportsProsodyPosition()
        ? (prosodyPositionText === '' ? null : Number(prosodyPositionText))
        : null;
      
      if (prosodyPosition !== null && (!Number.isFinite(prosodyPosition) || prosodyPosition < 0)) {
        setError(t('mlearn.WordDbEditor.EditTranslation.PitchError'));
        return;
      }
      
      const overrideData: TranslationResponse = { data: [] };
      
      overrideData.data[0] = {
        reading: reading().trim(),
        definitions: defsArr,
      };
      
      const struct = structuredContent().trim();
      if (struct) {
        overrideData.data[1] = {
          reading: reading().trim(),
          definitions: struct,
        };
      }
      
      let prosodyOverride: FlashcardProsody | undefined;
      if (supportsProsodyPosition() && prosodyPosition !== null) {
        const prosodyType = getLanguageProsodyType(currentLangData());
        if (prosodyType) {
          overrideData.data[2] = createProsodyRawPayloadForPosition(prosodyType, prosodyPosition, currentLangData());
          prosodyOverride = createProsodyForPosition(prosodyType, prosodyPosition, undefined, overrideData.data[2], currentLangData());
        }
      }
      
      setOverride(props.word, overrideData);
      
      props.onSave({
        reading: reading().trim(),
        prosodyPosition,
        ...(prosodyOverride ? { prosody: prosodyOverride } : {}),
        definitions: defsArr,
        structuredContent: struct || undefined,
      });
      
      props.onClose();
    } catch (e) {
      log.error("error", e);
      setError(String(e));
    }
  };
  
  const handleRevert = async () => {
    try {
      setOverride(props.word, null);
      setIsLoading(true);
      const translation = await translateWord(props.word);
      if (translation?.data) {
        applyTranslationData(translation.data);
      }
    } catch (e) {
      log.error("error", e);
      setError(t('mlearn.WordDbEditor.EditTranslation.RevertError') + ': ' + String(e));
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleProsodyPositionChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    let val = target.value.trim();
    if (val !== '') {
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0) {
        val = '0';
        target.value = '0';
      }
    }
    setProsodyPositionInput(val);
  };

  const footer = () => (
    <ModalFooter
      leftContent={
        <Btn variant="danger" size="sm" onClick={handleRevert}>
          {t('mlearn.WordDbEditor.EditTranslation.RemoveOverride')}
        </Btn>
      }
      cancelText={t('mlearn.Global.Cancel')}
      onCancel={props.onClose}
      confirmText={t('mlearn.Global.Save')}
      onConfirm={handleSave}
      confirmVariant="primary"
    />
  );
  
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.WordDbEditor.EditTranslation.Title', { word: props.word })}
      footer={footer()}
    >
      <Show when={isLoading()}>
        <Spinner size={32} shape="square" text={t('mlearn.Global.Loading')} />
      </Show>
      
      <Show when={!isLoading()}>
        <div class="edit-translation-dialog__body">
          <FormField label={t('mlearn.CardEditor.Fields.Word')}>
            <Input value={props.word} disabled />
          </FormField>
          
          <FormField label={t('mlearn.CardEditor.Fields.Reading')}>
            <Input
              value={reading()}
              onInput={(e) => setReading((e.target as HTMLInputElement).value)}
              placeholder={t('mlearn.CardEditor.Fields.ReadingPlaceholder')}
            />
          </FormField>
          
          <Show when={supportsProsodyPosition()}>
            <FormField label={prosodyPositionLabel()}>
              <div class="edit-translation-dialog__prosody-row">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={prosodyPositionInput()}
                  onInput={handleProsodyPositionChange}
                  placeholder={prosodyPositionPlaceholder()}
                  class="edit-translation-dialog__prosody-position-input"
                />
                <Show when={usesProsodyOverlayRenderer()}>
                  <span class="edit-translation-dialog__prosody-category-name">{prosodyCategoryName(prosodyPositionInput() === '' ? null : Number(prosodyPositionInput()))}</span>
                  <div class="edit-translation-dialog__prosody-overlay-preview">
                    <ProsodyOverlay
                      word={props.word}
                      reading={reading()}
                      prosodyPosition={prosodyPositionInput() === '' ? null : Number(prosodyPositionInput())}
                      prosodyType={getLanguageProsodyType(currentLangData())}
                      language={settings.language}
                      languageData={currentLangData()}
                      mode="preview"
                      showParticleBox={true}
                      homogenous={true}
                    />
                  </div>
                </Show>
                <Show when={genericProsodyPreview()}>
                  {(preview) => (
                    <div
                      class="edit-translation-dialog__prosody-preview"
                      data-prosody-type={preview().type}
                      data-prosody-position={preview().position}
                    >
                      <span class="edit-translation-dialog__prosody-preview-label">{preview().label}</span>
                      <span class="edit-translation-dialog__prosody-preview-value">{preview().position}</span>
                    </div>
                  )}
                </Show>
              </div>
            </FormField>
          </Show>
          
          <FormField label={t('mlearn.CardEditor.Fields.Definitions')}>
            <Textarea
              value={definitions()}
              onInput={(e) => setDefinitions((e.target as HTMLTextAreaElement).value)}
              placeholder={t('mlearn.CardEditor.Fields.DefinitionsPlaceholder')}
              rows={6}
            />
          </FormField>
          
          <FormField label={t('mlearn.CardEditor.Fields.StructuredContent')}>
            <ContentEditable
              value={structuredContent()}
              onChange={setStructuredContent}
              minHeight={80}
              maxHeight={200}
            />
          </FormField>
          
          <Show when={error()}>
            <AlertBanner variant="error" message={error()!} />
          </Show>
        </div>
      </Show>
    </Modal>
  );
};

export default EditTranslationDialog;
