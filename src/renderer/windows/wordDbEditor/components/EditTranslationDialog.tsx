/**
 * Edit Translation Dialog Component
 * Modal dialog for editing word translation data (reading, pitch accent, definitions)
 * Ported from openEditTranslationDialog in stats.js
 */

import { Component, createSignal, onMount, Show, createEffect } from 'solid-js';
import { useTranslation } from '../../../hooks/useTranslation';
import { GlassButton, GlassInput, GlassModal } from '../../../components/common';
import { buildPitchAccentHtml, getPitchAccentInfo } from '../../../utils/pitchAccent';
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
  
  const [reading, setReading] = createSignal('');
  const [pitch, setPitch] = createSignal<string>('');
  const [definitions, setDefinitions] = createSignal('');
  const [structuredContent, setStructuredContent] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  
  // Pitch accent preview
  const [pitchPreviewHtml, setPitchPreviewHtml] = createSignal('');
  
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
  
  // Update pitch preview when reading or pitch changes
  createEffect(() => {
    const r = reading().trim();
    const pStr = pitch().trim();
    const p = pStr === '' ? null : Number(pStr);
    
    if (r && p !== null && Number.isFinite(p) && p >= 0) {
      const info = getPitchAccentInfo(p, r);
      if (info) {
        const html = buildPitchAccentHtml(info, r.length, {
          includeParticleBox: true,
          homogenous: true,
        });
        setPitchPreviewHtml(html);
      } else {
        setPitchPreviewHtml('');
      }
    } else {
      setPitchPreviewHtml('');
    }
  });
  
  // Get pitch type name
  const pitchTypeName = (p: number | null): string => {
    if (p === null || p === undefined || Number.isNaN(p)) return '—';
    if (p === 0) return 'Heiban (平板)';
    if (p === 1) return 'Atamadaka (頭高)';
    if (p === 2) return 'Nakadaka (中高)';
    if (p === 3) return 'Odaka (尾高)';
    if (typeof p === 'number' && Number.isFinite(p) && p >= 4) return `Drop after mora ${p}`;
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
    <GlassModal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={`Edit translation – ${props.word}`}
    >
      <Show when={isLoading()}>
        <div class="loading-state">Loading...</div>
      </Show>
      
      <Show when={!isLoading()}>
        <div class="dialog-content">
          <div class="form-field">
            <label>Word</label>
            <GlassInput value={props.word} disabled />
          </div>
          
          <div class="form-field">
            <label>Reading (furigana)</label>
            <GlassInput
              value={reading()}
              onInput={(e) => setReading((e.target as HTMLInputElement).value)}
              placeholder="かな / reading"
            />
          </div>
          
          <div class="form-field">
            <label>Pitch accent</label>
            <div class="pitch-row">
              <GlassInput
                type="number"
                inputMode="numeric"
                min={0}
                value={pitch()}
                onInput={handlePitchChange}
                placeholder="0 (Heiban), 1, 2, 3…"
                class="pitch-input"
              />
              <span class="pitch-name">{pitchTypeName(pitch() === '' ? null : Number(pitch()))}</span>
              <div class="pitch-preview">
                <Show when={pitchPreviewHtml() && reading()}>
                  <span class="pitch-word">{reading()}</span>
                  <div class="mLearn-pitch-accent" innerHTML={pitchPreviewHtml()} />
                </Show>
              </div>
            </div>
          </div>
          
          <div class="form-field">
            <label>Definitions (one per line)</label>
            <textarea
              value={definitions()}
              onInput={(e) => setDefinitions((e.target as HTMLTextAreaElement).value)}
              placeholder="Definition per line"
              rows={6}
            />
          </div>
          
          <div class="form-field">
            <label>Structured content (optional HTML)</label>
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
          <GlassButton variant="danger" onClick={handleRevert}>
            Remove Override
          </GlassButton>
          <GlassButton variant="ghost" onClick={props.onClose}>
            Cancel
          </GlassButton>
          <GlassButton variant="primary" onClick={handleSave}>
            Save
          </GlassButton>
        </div>
      </Show>
    </GlassModal>
  );
};

export default EditTranslationDialog;
