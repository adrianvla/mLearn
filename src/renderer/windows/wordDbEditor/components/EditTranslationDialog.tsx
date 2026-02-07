/**
 * Edit Translation Dialog Component
 * Modal dialog for editing word translation data (reading, pitch accent, definitions)
 * Ported from openEditTranslationDialog in stats.js
 */

import { Component, createSignal, onMount, Show } from 'solid-js';
import { useTranslation } from '../../../hooks/useTranslation';
import { useLocalization } from '../../../context';
import { Btn, Input, Modal, Spinner, PitchAccentOverlay } from '../../../components/common';
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
  
  // Load initial data when dialog opens
  onMount(async () => {
    if (props.initialData) {
      setReading(props.initialData.reading || '');
      setPitch(props.initialData.pitch !== null ? String(props.initialData.pitch) : '');
      setDefinitions(props.initialData.definitions.join('\n'));
      setStructuredContent(props.initialData.structuredContent || '');
    } else {
      // Fetch from backend
      setIsLoading(true);
      try {
        const translation = await translateWord(props.word);
        if (translation?.data) {
          const firstEntry = translation.data[0] as any;
          const secondEntry = translation.data[1] as any;
          const pitchEntry = translation.data[2] as any;
          
          if (firstEntry) {
            setReading(firstEntry.reading || '');
            const defs = firstEntry.definitions;
            setDefinitions(Array.isArray(defs) ? defs.join('\n') : (defs || ''));
          }
          if (secondEntry?.definitions) {
            setStructuredContent(String(secondEntry.definitions));
          }
          if (pitchEntry) {
            // Handle various pitch data formats
            let pitchVal: number | null = null;
            if (Array.isArray(pitchEntry) && pitchEntry[2]?.pitches?.[0]?.position !== undefined) {
              pitchVal = pitchEntry[2].pitches[0].position;
            } else if (pitchEntry?.pitches?.[0]?.position !== undefined) {
              pitchVal = pitchEntry.pitches[0].position;
            }
            if (pitchVal !== null) {
              setPitch(String(pitchVal));
            }
          }
        }
      } catch (e) {
        console.error('Failed to load translation data:', e);
      } finally {
        setIsLoading(false);
      }
    }
  });
  
  // Get pitch type name
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
        setError('Pitch accent must be a non-negative integer or empty');
        return;
      }
      
      // Build override data structure matching backend format
      const overrideData: any = { data: [] };
      
      // Primary entry with reading and definitions
      overrideData.data.push({
        reading: reading().trim(),
        definitions: defsArr,
      });
      
      // Structured content (optional)
      const struct = structuredContent().trim();
      if (struct) {
        overrideData.data.push({
          reading: reading().trim(),
          definitions: struct,
        });
      }
      
      // Pitch entry (optional)
      if (pitchNum !== null) {
        overrideData.data.push([props.word, 'pitch', {
          reading: reading().trim(),
          pitches: [{ position: pitchNum }],
        }]);
      }
      
      // Save to local storage via translation hook
      setOverride(props.word, overrideData);
      
      // Notify parent
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
      // Clear the override
      setOverride(props.word, null);
      
      // Fetch fresh data from backend
      setIsLoading(true);
      const translation = await translateWord(props.word);
      if (translation?.data) {
        const firstEntry = translation.data[0] as any;
        const secondEntry = translation.data[1] as any;
        const pitchEntry = translation.data[2] as any;
        
        if (firstEntry) {
          setReading(firstEntry.reading || '');
          const defs = firstEntry.definitions;
          setDefinitions(Array.isArray(defs) ? defs.join('\n') : (defs || ''));
        }
        if (secondEntry?.definitions) {
          setStructuredContent(String(secondEntry.definitions));
        } else {
          setStructuredContent('');
        }
        if (pitchEntry) {
          let pitchVal: number | null = null;
          if (Array.isArray(pitchEntry) && pitchEntry[2]?.pitches?.[0]?.position !== undefined) {
            pitchVal = pitchEntry[2].pitches[0].position;
          } else if (pitchEntry?.pitches?.[0]?.position !== undefined) {
            pitchVal = pitchEntry.pitches[0].position;
          }
          setPitch(pitchVal !== null ? String(pitchVal) : '');
        } else {
          setPitch('');
        }
      }
    } catch (e) {
      setError('Failed to revert: ' + String(e));
    } finally {
      setIsLoading(false);
    }
  };
  
  const handlePitchChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    let val = target.value.trim();
    // Enforce minimum >= 0
    if (val !== '') {
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0) {
        val = '0';
        target.value = '0';
      }
    }
    setPitch(val);
  };
  
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.WordDbEditor.EditTranslation.Title', { word: props.word })}
    >
      <Show when={isLoading()}>
        <Spinner size={32} text={t('mlearn.Global.Loading')} />
      </Show>
      
      <Show when={!isLoading()}>
        <div class="dialog-content">
          <div class="form-field">
            <label>{t('mlearn.CardEditor.Fields.Word')}</label>
            <Input value={props.word} disabled />
          </div>
          
          <div class="form-field">
            <label>{t('mlearn.CardEditor.Fields.Reading')}</label>
            <Input
              value={reading()}
              onInput={(e) => setReading((e.target as HTMLInputElement).value)}
              placeholder={t('mlearn.CardEditor.Fields.ReadingPlaceholder')}
            />
          </div>
          
          <div class="form-field">
            <label>{t('mlearn.CardEditor.Fields.PitchAccent')}</label>
            <div class="pitch-row">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={pitch()}
                onInput={handlePitchChange}
                placeholder={t('mlearn.CardEditor.Fields.PitchPlaceholder')}
                class="pitch-input"
              />
              <span class="pitch-name">{pitchTypeName(pitch() === '' ? null : Number(pitch()))}</span>
              <div class="pitch-preview">
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
          </div>
          
          <div class="form-field">
            <label>{t('mlearn.CardEditor.Fields.Definitions')}</label>
            <textarea
              value={definitions()}
              onInput={(e) => setDefinitions((e.target as HTMLTextAreaElement).value)}
              placeholder={t('mlearn.CardEditor.Fields.DefinitionsPlaceholder')}
              rows={6}
            />
          </div>
          
          <div class="form-field">
            <label>{t('mlearn.CardEditor.Fields.StructuredContent')}</label>
            <div
              class="structured-content-editor"
              contentEditable
              innerHTML={structuredContent()}
              onInput={(e) => setStructuredContent((e.target as HTMLDivElement).innerHTML)}
            />
          </div>
          
          <Show when={error()}>
            <div class="error-message">{error()}</div>
          </Show>
        </div>
        
        <div class="dialog-footer">
          <Btn variant="danger" onClick={handleRevert}>
            {t('mlearn.WordDbEditor.EditTranslation.RemoveOverride')}
          </Btn>
          <Btn variant="ghost" onClick={props.onClose}>
            {t('mlearn.Global.Cancel')}
          </Btn>
          <Btn variant="primary" onClick={handleSave}>
            {t('mlearn.Global.Save')}
          </Btn>
        </div>
      </Show>
    </Modal>
  );
};

export default EditTranslationDialog;
