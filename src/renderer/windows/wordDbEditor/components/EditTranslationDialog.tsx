/**
 * Edit Translation Dialog Component
 * Modal dialog for editing word translation data (reading, pitch accent, definitions)
 */

import { Component, createSignal, onMount, Show } from 'solid-js';
import { useTranslation } from '../../../hooks/useTranslation';
import { useLocalization } from '../../../context';
import {
  Input,
  Modal,
  ModalFooter,
  Spinner,
  PitchAccentOverlay,
  FormField,
  Textarea,
  ContentEditable,
  AlertBanner,
  Btn,
} from '../../../components/common';
import type { TranslationResponse } from '@shared/types';
import './EditTranslationDialog.css';

export interface EditTranslationDialogProps {
  word: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: TranslationOverride) => void;
  initialData?: TranslationOverride | null;
}

export interface TranslationOverride {
  reading: string;
  pitch: number | null;
  definitions: string[];
  structuredContent?: string;
}

export const EditTranslationDialog: Component<EditTranslationDialogProps> = (props) => {
  const { translateWord, setOverride } = useTranslation();
  const { t } = useLocalization();
  
  const [reading, setReading] = createSignal('');
  const [pitch, setPitch] = createSignal<string>('');
  const [definitions, setDefinitions] = createSignal('');
  const [structuredContent, setStructuredContent] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  /** Parse translation response data into form fields */
  const applyTranslationData = (data: unknown[]) => {
    const firstEntry = data[0] as Record<string, unknown> | undefined;
    const secondEntry = data[1] as Record<string, unknown> | undefined;
    const pitchEntry = data[2] as unknown;

    if (firstEntry) {
      setReading((firstEntry.reading as string) || '');
      const defs = firstEntry.definitions;
      setDefinitions(Array.isArray(defs) ? defs.join('\n') : (defs as string || ''));
    }
    if (secondEntry?.definitions) {
      setStructuredContent(String(secondEntry.definitions));
    } else {
      setStructuredContent('');
    }
    if (pitchEntry) {
      let pitchVal: number | null = null;
      if (Array.isArray(pitchEntry) && (pitchEntry[2] as Record<string, unknown>)?.pitches) {
        const pitches = (pitchEntry[2] as Record<string, unknown>).pitches as Array<{ position?: number }>;
        if (pitches?.[0]?.position !== undefined) pitchVal = pitches[0].position;
      } else if ((pitchEntry as Record<string, unknown>)?.pitches) {
        const pitches = (pitchEntry as Record<string, unknown>).pitches as Array<{ position?: number }>;
        if (pitches?.[0]?.position !== undefined) pitchVal = pitches[0].position;
      }
      setPitch(pitchVal !== null ? String(pitchVal) : '');
    } else {
      setPitch('');
    }
  };
  
  // Load initial data when dialog opens
  onMount(async () => {
    if (props.initialData) {
      setReading(props.initialData.reading || '');
      setPitch(props.initialData.pitch !== null ? String(props.initialData.pitch) : '');
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
        console.error('Failed to load translation data:', e);
      } finally {
        setIsLoading(false);
      }
    }
  });
  
  const pitchTypeName = (p: number | null): string => {
    if (p === null || p === undefined || Number.isNaN(p)) return '—';
    if (p === 0) return t('mlearn.PitchAccent.Heiban');
    if (p === 1) return t('mlearn.PitchAccent.Atamadaka');
    if (p === 2) return t('mlearn.PitchAccent.Nakadaka');
    if (p === 3) return t('mlearn.PitchAccent.Odaka');
    if (typeof p === 'number' && Number.isFinite(p) && p >= 4) return t('mlearn.PitchAccent.DropAfterMora', { mora: p });
    return '—';
  };
  
  const handleSave = async () => {
    try {
      setError(null);
      const defsArr = definitions()
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      
      const pitchVal = pitch().trim();
      const pitchNum = pitchVal === '' ? null : Number(pitchVal);
      
      if (pitchNum !== null && (!Number.isFinite(pitchNum) || pitchNum < 0)) {
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
      
      if (pitchNum !== null) {
        overrideData.data[2] = {
          pitches: [{ position: pitchNum }],
        };
      }
      
      setOverride(props.word, overrideData);
      
      props.onSave({
        reading: reading().trim(),
        pitch: pitchNum,
        definitions: defsArr,
        structuredContent: struct || undefined,
      });
      
      props.onClose();
    } catch (e) {
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
      setError(t('mlearn.WordDbEditor.EditTranslation.RevertError') + ': ' + String(e));
    } finally {
      setIsLoading(false);
    }
  };
  
  const handlePitchChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    let val = target.value.trim();
    if (val !== '') {
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0) {
        val = '0';
        target.value = '0';
      }
    }
    setPitch(val);
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
          
          <FormField label={t('mlearn.CardEditor.Fields.PitchAccent')}>
            <div class="edit-translation-dialog__pitch-row">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={pitch()}
                onInput={handlePitchChange}
                placeholder={t('mlearn.CardEditor.Fields.PitchAccentPlaceholder')}
                class="edit-translation-dialog__pitch-input"
              />
              <span class="edit-translation-dialog__pitch-name">{pitchTypeName(pitch() === '' ? null : Number(pitch()))}</span>
              <div class="edit-translation-dialog__pitch-preview">
                <PitchAccentOverlay
                  word={props.word}
                  reading={reading()}
                  pitchPosition={pitch() === '' ? null : Number(pitch())}
                  mode="preview"
                  showParticleBox={true}
                  homogenous={true}
                />
              </div>
            </div>
          </FormField>
          
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
