/**
 * FlashcardEditModal
 * Shared modal for editing flashcards — used in the Flashcards window browse tab,
 * the FlashcardReview header, and the Word Database editor.
 *
 * Two tabs:
 *  1. Editor – the existing FlashcardEditor component
 *  2. Advanced – raw field editor for all content & metadata fields
 */

import { Component, createSignal, createMemo, Show, For, batch } from 'solid-js';
import type { Flashcard, FlashcardContent, FlashcardState } from '../../../shared/types';
import { Modal, TabContainer, TabPanel, Btn, ToggleSwitch } from '../common';
import { FlashcardEditor } from './FlashcardEditor';
import { useLocalization } from '../../context';
import type { TabItem } from '../common/Tabs/TabContainer';
import './FlashcardEditModal.css';

export interface FlashcardEditModalProps {
  isOpen: boolean;
  flashcard: Flashcard | null;
  onClose: () => void;
  onSave: (content: FlashcardContent, metadataUpdates?: Partial<Flashcard>) => void;
}

// Content fields that the advanced editor shows, in display order
const CONTENT_FIELDS: (keyof FlashcardContent)[] = [
  'type', 'front', 'back', 'reading', 'pitchAccent', 'pos', 'level',
  'example', 'exampleMeaning', 'imageUrl', 'audioUrl', 'context', 'source',
  'videoUrl', 'skipExampleTts',
];

// Metadata fields on the Flashcard itself (not content)
const METADATA_FIELDS: (keyof Flashcard)[] = [
  'id', 'state', 'ease', 'interval', 'dueDate', 'reviews', 'lapses',
  'learningStep', 'createdAt', 'lastReviewed', 'lastUpdated',
  'tags', 'language', 'suspended', 'buried',
];

// Fields that should not be editable (read-only in advanced view)
const READONLY_FIELDS = new Set<string>(['id', 'createdAt']);

type TabId = 'editor' | 'advanced';
type DraftValue = string | boolean;
const CONTENT_BOOLEAN_FIELDS = new Set<keyof FlashcardContent>(['skipExampleTts']);
const METADATA_BOOLEAN_FIELDS = new Set<keyof Flashcard>(['suspended', 'buried']);
const CLEARABLE_METADATA_FIELDS = new Set<keyof Flashcard>(['tags', 'language', 'suspended', 'buried']);

/** Serialize a value to a displayable draft value for the advanced editor */
function valueToDraftValue(val: unknown): DraftValue {
  if (val === undefined || val === null) return '';
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return JSON.stringify(val, null, 2);
}

/** Parse a string back into a typed value for the given field */
function parseFieldValue(key: string, raw: DraftValue): unknown {
  if (typeof raw === 'boolean') return raw;

  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  // Booleans
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Number fields
  const numFields = new Set([
    'pitchAccent', 'level', 'ease', 'interval', 'dueDate', 'reviews',
    'lapses', 'learningStep', 'createdAt', 'lastReviewed', 'lastUpdated',
  ]);
  if (numFields.has(key)) {
    const n = Number(trimmed);
    if (!isNaN(n)) return n;
  }

  // State enum
  if (key === 'state') {
    const valid: FlashcardState[] = ['new', 'learning', 'review', 'relearning'];
    if (valid.includes(trimmed as FlashcardState)) return trimmed;
    return trimmed;
  }

  // Try JSON parse for objects/arrays
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      console.error(e);
      return trimmed;
    }
  }

  return trimmed;
}

function getDraftString(value: DraftValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

export const FlashcardEditModal: Component<FlashcardEditModalProps> = (props) => {
  const { t } = useLocalization();
  const [activeTab, setActiveTab] = createSignal<TabId>('editor');

  // ---- Advanced editor local state ----
  // We clone values on open so edits are non-destructive until save
  const [contentDraft, setContentDraft] = createSignal<Record<string, DraftValue>>({});
  const [metaDraft, setMetaDraft] = createSignal<Record<string, DraftValue>>({});
  // Extra fields from content.extra
  const [extraDraft, setExtraDraft] = createSignal<Array<{ key: string; value: string }>>([]);
  // New field being added
  const [newKey, setNewKey] = createSignal('');
  const [newValue, setNewValue] = createSignal('');

  // Reset advanced draft when the modal opens or the flashcard changes
  const resetAdvancedDraft = () => {
    const card = props.flashcard;
    if (!card) return;

    const cd: Record<string, DraftValue> = {};
    for (const key of CONTENT_FIELDS) {
      const val = card.content[key];
      cd[key] = valueToDraftValue(val);
    }
    setContentDraft(cd);

    const md: Record<string, DraftValue> = {};
    for (const key of METADATA_FIELDS) {
      md[key] = valueToDraftValue(card[key]);
    }
    setMetaDraft(md);

    const extra = card.content.extra;
    if (extra && typeof extra === 'object') {
      setExtraDraft(
        Object.entries(extra).map(([k, v]) => ({ key: k, value: String(valueToDraftValue(v)) })),
      );
    } else {
      setExtraDraft([]);
    }

    setNewKey('');
    setNewValue('');
  };

  // Watch for modal open / flashcard change
  const prevCardRef = { id: '' };
  const checkReset = createMemo(() => {
    const open = props.isOpen;
    const id = props.flashcard?.id ?? '';
    if (open && id && id !== prevCardRef.id) {
      prevCardRef.id = id;
      resetAdvancedDraft();
    }
    if (!open) {
      prevCardRef.id = '';
    }
    return id;
  });

  // Tabs definition
  const tabs = createMemo((): TabItem[] => {
    // force-subscribe to the memo so the draft is initialized
    checkReset();
    return [
      { id: 'editor', label: t('mlearn.Flashcards.Modals.EditCard.TabEditor') },
      { id: 'advanced', label: t('mlearn.Flashcards.Modals.EditCard.TabAdvanced') },
    ];
  });

  // ---- Content field handlers ----
  const setContentField = (key: string, value: DraftValue) => {
    setContentDraft(prev => ({ ...prev, [key]: value }));
  };

  const setMetaField = (key: string, value: DraftValue) => {
    setMetaDraft(prev => ({ ...prev, [key]: value }));
  };

  const setExtraField = (index: number, field: 'key' | 'value', val: string) => {
    setExtraDraft(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const removeExtraField = (index: number) => {
    setExtraDraft(prev => prev.filter((_, i) => i !== index));
  };

  const addExtraField = () => {
    const key = newKey().trim();
    if (!key) return;
    setExtraDraft(prev => [...prev, { key, value: newValue() }]);
    batch(() => {
      setNewKey('');
      setNewValue('');
    });
  };

  // ---- Save from advanced tab ----
  const handleAdvancedSave = () => {
    const card = props.flashcard;
    if (!card) return;

    // Build content
    const content: Record<string, unknown> = {};
    const cd = contentDraft();
    for (const key of CONTENT_FIELDS) {
      const rawValue = cd[key] ?? '';
      if (typeof rawValue === 'string' && rawValue.trim() === '') {
        if (key === 'front' || key === 'back') {
          content[key] = '';
        } else if (key !== 'type') {
          content[key] = undefined;
        }
        continue;
      }

      const parsed = parseFieldValue(key, rawValue);
      if (parsed !== undefined) {
        content[key] = parsed;
      }
    }

    // Build extra
    const extras: Record<string, unknown> = {};
    for (const { key, value } of extraDraft()) {
      const k = key.trim();
      if (!k) continue;
      extras[k] = parseFieldValue(k, value);
    }
    if (Object.keys(extras).length > 0) {
      content.extra = extras;
    }

    // Build metadata updates (only changed non-readonly fields)
    const metaUpdates: Partial<Flashcard> = {};
    const md = metaDraft();
    for (const key of METADATA_FIELDS) {
      if (READONLY_FIELDS.has(key)) continue;
      const rawValue = md[key] ?? '';
      if (typeof rawValue === 'string' && rawValue.trim() === '') {
        if (CLEARABLE_METADATA_FIELDS.has(key)) {
          (metaUpdates as Record<string, unknown>)[key] = undefined;
        }
        continue;
      }

      const parsed = parseFieldValue(key, rawValue);
      if (parsed !== undefined) {
        (metaUpdates as Record<string, unknown>)[key] = parsed;
      }
    }

    // Ensure required content fields
    if (!content.type) content.type = 'word';

    props.onSave(content as unknown as FlashcardContent, metaUpdates);
  };

  // ---- Editor tab save ----
  const handleEditorSave = (content: FlashcardContent) => {
    props.onSave(content);
  };

  const title = createMemo(() => {
    const word = props.flashcard?.content.front || '';
    return `${t('mlearn.Flashcards.Modals.EditCard.Title')} – ${word}`;
  });

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={title()}
      size="lg"
    >
      <Show when={props.flashcard}>
        <div class="flashcard-edit-modal-tabs">
          <TabContainer
            tabs={tabs()}
            activeTab={activeTab()}
            onTabChange={(id) => setActiveTab(id as TabId)}
            variant="underline"
            size="sm"
          />
        </div>

        <TabPanel tabId="editor" activeTab={activeTab()}>
          <FlashcardEditor
            flashcard={props.flashcard!}
            onSave={handleEditorSave}
            onCancel={props.onClose}
            showStats={true}
          />
        </TabPanel>

        <TabPanel tabId="advanced" activeTab={activeTab()}>
          <div class="flashcard-advanced-editor">
            <p class="flashcard-advanced-hint">
              {t('mlearn.Flashcards.Modals.EditCard.AdvancedHint')}
            </p>

            {/* Content fields */}
            <div class="flashcard-advanced-section">
              <h4 class="flashcard-advanced-section-title">
                {t('mlearn.Flashcards.Modals.EditCard.ContentSection')}
              </h4>
              <For each={CONTENT_FIELDS}>
                {(key) => (
                  <div class="flashcard-advanced-field">
                    <span class="flashcard-advanced-field-key" title={key}>{key}</span>
                    <div class="flashcard-advanced-field-value">
                      <Show
                        when={CONTENT_BOOLEAN_FIELDS.has(key)}
                        fallback={
                          <textarea
                            rows={getDraftString(contentDraft()[key]).includes('\n') ? 3 : 1}
                            value={getDraftString(contentDraft()[key])}
                            onInput={(e) => setContentField(key, e.currentTarget.value)}
                          />
                        }
                      >
                        <ToggleSwitch
                          checked={contentDraft()[key] === true}
                          onChange={(checked) => setContentField(key, checked)}
                          title={key}
                        />
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>

            {/* Extra fields */}
            <div class="flashcard-advanced-section">
              <h4 class="flashcard-advanced-section-title">extra</h4>
              <Show
                when={extraDraft().length > 0}
                fallback={
                  <span class="flashcard-advanced-hint">
                    {t('mlearn.Flashcards.Modals.EditCard.EmptyObject')}
                  </span>
                }
              >
                <div class="flashcard-advanced-extra">
                  <For each={extraDraft()}>
                    {(entry, index) => (
                      <div class="flashcard-advanced-extra-row">
                        <div class="flashcard-advanced-extra-key">
                          <input
                            value={entry.key}
                            onInput={(e) => setExtraField(index(), 'key', e.currentTarget.value)}
                            placeholder={t('mlearn.Flashcards.Modals.EditCard.NewFieldKey')}
                          />
                        </div>
                        <div class="flashcard-advanced-extra-value">
                          <textarea
                            rows={entry.value.includes('\n') ? 3 : 1}
                            value={entry.value}
                            onInput={(e) => setExtraField(index(), 'value', e.currentTarget.value)}
                          />
                        </div>
                        <div class="flashcard-advanced-field-actions">
                          <Btn
                            size="xs"
                            variant="danger"
                            onClick={() => removeExtraField(index())}
                          >
                            {t('mlearn.Flashcards.Modals.EditCard.RemoveField')}
                          </Btn>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Add new extra field */}
              <div class="flashcard-advanced-add-row">
                <div class="flashcard-advanced-add-key">
                  <input
                    value={newKey()}
                    onInput={(e) => setNewKey(e.currentTarget.value)}
                    placeholder={t('mlearn.Flashcards.Modals.EditCard.NewFieldKey')}
                    onKeyDown={(e) => { if (e.key === 'Enter') addExtraField(); }}
                  />
                </div>
                <div class="flashcard-advanced-add-value">
                  <input
                    value={newValue()}
                    onInput={(e) => setNewValue(e.currentTarget.value)}
                    placeholder={t('mlearn.Flashcards.Modals.EditCard.NewFieldValue')}
                    onKeyDown={(e) => { if (e.key === 'Enter') addExtraField(); }}
                  />
                </div>
                <Btn size="xs" variant="secondary" onClick={addExtraField}>
                  {t('mlearn.Flashcards.Modals.EditCard.AddField')}
                </Btn>
              </div>
            </div>

            {/* Metadata fields */}
            <div class="flashcard-advanced-section">
              <h4 class="flashcard-advanced-section-title">
                {t('mlearn.Flashcards.Modals.EditCard.MetadataSection')}
              </h4>
              <For each={METADATA_FIELDS}>
                {(key) => {
                  const isReadonly = READONLY_FIELDS.has(key);
                  return (
                    <div
                      class="flashcard-advanced-field"
                      classList={{ 'flashcard-advanced-field--readonly': isReadonly }}
                    >
                      <span class="flashcard-advanced-field-key" title={key}>{key}</span>
                      <div class="flashcard-advanced-field-value">
                        <Show
                          when={METADATA_BOOLEAN_FIELDS.has(key)}
                          fallback={
                            <textarea
                              rows={1}
                              value={getDraftString(metaDraft()[key])}
                              onInput={(e) => setMetaField(key, e.currentTarget.value)}
                              readOnly={isReadonly}
                            />
                          }
                        >
                          <ToggleSwitch
                            checked={metaDraft()[key] === true}
                            onChange={(checked) => setMetaField(key, checked)}
                            disabled={isReadonly}
                            title={key}
                          />
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>

            {/* Footer */}
            <div class="flashcard-advanced-footer">
              <Btn onClick={props.onClose}>{t('mlearn.Global.Cancel')}</Btn>
              <Btn variant="primary" onClick={handleAdvancedSave}>
                {t('mlearn.Global.Actions.SaveChanges')}
              </Btn>
            </div>
          </div>
        </TabPanel>
      </Show>
    </Modal>
  );
};

export default FlashcardEditModal;
