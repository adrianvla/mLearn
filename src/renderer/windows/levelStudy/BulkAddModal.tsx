import { Component, createMemo, createSignal, For } from 'solid-js';
import {
  Modal,
  Btn,
  FilterBuilder,
  validateTokens,
  parseTokens,
  evaluateAst,
  buildLevelStudyBulkAddFields,
  buildUntrackedStatusPreset,
  WORD_SYNC_STATUS_UNTRACKED,
  type FilterToken,
  type FieldResolver,
} from '../../components/common';
import { showToast } from '../../components/common/Feedback/Toast';
import { useFlashcards, useLocalization } from '../../context';
import type { LevelStudyTargetStatus } from '../../context/FlashcardContext';
import { isDisplayableFrequencyLevel } from '../../../shared/languageFeatures';
import { WORD_STATUS, type WordStatus } from '../../../shared/constants';
import type { LanguageData, WordFrequencyMap } from '../../../shared/types';

interface BulkAddModalProps {
  language: string;
  languageData: LanguageData | null;
  frequency: WordFrequencyMap;
  levelNames: Record<string, string>;
  onClose: () => void;
}

const TARGET_STATUS_OPTIONS: { value: LevelStudyTargetStatus; labelKey: string }[] = [
  { value: 'new', labelKey: 'mlearn.LevelStudy.DetailModal.StatusNew' },
  { value: 'learning', labelKey: 'mlearn.LevelStudy.DetailModal.StatusLearning' },
  { value: 'known', labelKey: 'mlearn.LevelStudy.DetailModal.StatusKnown' },
  { value: 'mastered', labelKey: 'mlearn.LevelStudy.DetailModal.StatusMastered' },
];

interface BulkAddWordRecord {
  status: string;
  level: number | null | undefined;
}

export const BulkAddModal: Component<BulkAddModalProps> = (props) => {
  const { t } = useLocalization();
  const flashcards = useFlashcards();
  const [tokens, setTokens] = createSignal<FilterToken[]>(buildUntrackedStatusPreset());
  const [targetStatus, setTargetStatus] = createSignal<LevelStudyTargetStatus>('learning');
  const [isAdding, setIsAdding] = createSignal(false);

  const filterSetup = createMemo(() => (
    buildLevelStudyBulkAddFields(props.levelNames, t, props.languageData)
  ));

  const resolvers = createMemo(() => (
    Object.fromEntries(
      filterSetup().fields.map((field) => [field.field, field.resolver as FieldResolver<BulkAddWordRecord>]),
    )
  ));

  const filterValidation = createMemo(() => validateTokens(tokens()));

  const filterAst = createMemo(() => {
    if (tokens().length === 0) return null;
    return filterValidation().ok ? parseTokens(tokens()) : null;
  });

  // Mirrors getWordLevelStatus: untracked = unknown comprehensive status + no card tracking.
  const toFilterStatus = (word: string): string => {
    const comprehensive: WordStatus = flashcards.getComprehensiveWordStatusSync(word, props.language);
    if (comprehensive === 'unknown' && !flashcards.hasWordSync(word, props.language)) {
      return WORD_SYNC_STATUS_UNTRACKED;
    }
    return String(WORD_STATUS[comprehensive.toUpperCase() as keyof typeof WORD_STATUS]);
  };

  const matchingWords = createMemo(() => {
    const ast = filterAst();
    if (tokens().length > 0 && !ast) return [];

    const words: string[] = [];
    for (const [word, entry] of Object.entries(props.frequency)) {
      if (!isDisplayableFrequencyLevel(entry.raw_level, props.levelNames, props.languageData)) continue;
      if (!ast) {
        words.push(word);
        continue;
      }
      const record: BulkAddWordRecord = { status: toFilterStatus(word), level: entry.raw_level };
      if (evaluateAst(ast, record, resolvers())) {
        words.push(word);
      }
    }
    return words;
  });

  const handleConfirm = async () => {
    const words = matchingWords();
    if (words.length === 0 || isAdding()) return;
    setIsAdding(true);
    try {
      const result = await flashcards.addLevelStudyFlashcards(words, targetStatus(), props.language);
      showToast({
        message: t('mlearn.LevelStudy.DetailModal.WordsAdded', {
          count: String(result.created + result.promoted),
        }),
        variant: 'success',
        duration: 4000,
      });
      props.onClose();
    } catch {
      showToast({
        message: t('mlearn.LevelStudy.DetailModal.Error'),
        variant: 'error',
        duration: 4000,
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      title={t('mlearn.LevelStudy.BulkAdd.Title')}
      size="lg"
      footer={
        <div class="bulk-add-modal-footer">
          <div class="bulk-add-target-status">
            <span class="bulk-add-target-label">{t('mlearn.LevelStudy.DetailModal.AddAs')}</span>
            <For each={TARGET_STATUS_OPTIONS}>
              {(option) => (
                <Btn
                  size="sm"
                  variant={targetStatus() === option.value ? 'primary' : 'secondary'}
                  onClick={() => setTargetStatus(option.value)}
                >
                  {t(option.labelKey)}
                </Btn>
              )}
            </For>
          </div>
          <div class="bulk-add-actions">
            <span class="bulk-add-count">
              {t('mlearn.LevelStudy.BulkAdd.MatchingCount', { count: String(matchingWords().length) })}
            </span>
            <Btn size="sm" variant="secondary" onClick={props.onClose}>
              {t('mlearn.LevelStudy.BulkAdd.Cancel')}
            </Btn>
            <Btn
              size="sm"
              variant="primary"
              onClick={handleConfirm}
              disabled={isAdding() || matchingWords().length === 0 || !filterValidation().ok}
            >
              {isAdding()
                ? t('mlearn.LevelStudy.BulkAdd.Adding')
                : t('mlearn.LevelStudy.DetailModal.AddFlashcards', { count: String(matchingWords().length) })}
            </Btn>
          </div>
        </div>
      }
    >
      <p class="bulk-add-modal-hint">{t('mlearn.LevelStudy.BulkAdd.Hint')}</p>
      <FilterBuilder
        fields={filterSetup().fields}
        paletteItems={filterSetup().paletteItems}
        tokens={tokens()}
        onChange={setTokens}
        evaluation={filterValidation()}
      />
    </Modal>
  );
};

export default BulkAddModal;
