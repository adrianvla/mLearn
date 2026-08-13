import { Component, createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import {
  Modal,
  Btn,
  FilterBuilder,
  Input,
  ProgressBar,
  validateTokens,
  parseTokens,
  evaluateAst,
  buildLevelStudyBulkAddFields,
  buildBulkAddDefaultPreset,
  WORD_SYNC_STATUS_UNTRACKED,
  type FilterToken,
  type FieldResolver,
} from '../../components/common';
import { showToast } from '../../components/common/Feedback/Toast';
import { useFlashcards, useLocalization } from '../../context';
import type { LevelStudyTargetStatus } from '../../context/FlashcardContext';
import { getBackend } from '../../../shared/backends';
import type { DictionaryWordPair } from '../../../shared/backends/types';
import { WORD_STATUS, type WordStatus } from '../../../shared/constants';
import type { LanguageData, WordFrequencyMap } from '../../../shared/types';

// Module-level cache: the dict universe is ~296k (word, reading) pairs per language; re-fetching on every modal open would cost seconds.
const dictionaryUniverseCache = new Map<string, DictionaryWordPair[]>();

// Dict status resolution costs ~30µs/word (normalizer + SHA-256 + store lookups).
// ~400 words per slice keeps each chunk under ~16ms so the main thread stays alive.
const DICT_BUILD_CHUNK = 400;

interface BulkAddModalProps {
  language: string;
  languageData: LanguageData | null;
  frequency: WordFrequencyMap;
  levelNames: Record<string, string>;
  targetLevel?: number | null;
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
  level: number | string | null | undefined;
}

export const BulkAddModal: Component<BulkAddModalProps> = (props) => {
  const { t } = useLocalization();
  const flashcards = useFlashcards();
  const [tokens, setTokens] = createSignal<FilterToken[]>(
    buildBulkAddDefaultPreset(props.levelNames, props.targetLevel, props.languageData),
  );
  const [targetStatus, setTargetStatus] = createSignal<LevelStudyTargetStatus>('learning');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [isAdding, setIsAdding] = createSignal(false);
  const [addProgress, setAddProgress] = createSignal<{ current: number; total: number } | null>(null);

  const [dictionaryWords] = createResource(
    () => props.language,
    async (language) => {
      const cached = dictionaryUniverseCache.get(language);
      if (cached) return cached;
      const pairs = await getBackend().enumerateDictionaryWords(language);
      dictionaryUniverseCache.set(language, pairs);
      return pairs;
    },
  );

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

  const freqWords = createMemo(() => {
    const ast = filterAst();
    if (tokens().length > 0 && !ast) return [];

    const query = searchQuery().trim().toLowerCase();
    const matchesSearch = (word: string, reading?: string): boolean => (
      query.length === 0 || word.toLowerCase().includes(query) || (reading?.toLowerCase().includes(query) ?? false)
    );

    const words: string[] = [];
    for (const [word, entry] of Object.entries(props.frequency)) {
      if (!matchesSearch(word)) continue;
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

  const [dictWords, setDictWords] = createSignal<string[]>([]);
  const [dictCount, setDictCount] = createSignal(0);
  const [dictBuilding, setDictBuilding] = createSignal(false);
  let dictBuildToken = 0;
  let dictBuildTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    void freqWords();
    const pairs = dictionaryWords();
    const ast = filterAst();
    if (!pairs || pairs.length === 0 || (tokens().length > 0 && !ast)) {
      setDictWords([]);
      setDictCount(0);
      setDictBuilding(false);
      return;
    }

    const query = searchQuery().trim().toLowerCase();
    const inFrequency = new Set(Object.keys(props.frequency));
    const token = ++dictBuildToken;
    setDictBuilding(true);
    setDictCount(0);
    const out: string[] = [];
    let i = 0;

    const step = () => {
      if (token !== dictBuildToken) return;
      const end = Math.min(i + DICT_BUILD_CHUNK, pairs.length);
      for (; i < end; i++) {
        const [word, reading] = pairs[i];
        if (inFrequency.has(word)) continue;
        if (
          query.length !== 0
          && !word.toLowerCase().includes(query)
          && !(reading?.toLowerCase().includes(query) ?? false)
        ) {
          continue;
        }
        if (ast) {
          // -1: not on the exam frequency list — normalizeLevelValue maps it to the beyond-exam bucket.
          const record: BulkAddWordRecord = { status: toFilterStatus(word), level: -1 };
          if (!evaluateAst(ast, record, resolvers())) continue;
        }
        out.push(word);
      }
      setDictCount(out.length);
      if (i < pairs.length) {
        dictBuildTimer = setTimeout(step, 0);
      } else {
        setDictWords(out);
        setDictBuilding(false);
      }
    };
    step();
    onCleanup(() => clearTimeout(dictBuildTimer));
  });

  const totalCount = (): number => freqWords().length + dictCount();

  const handleConfirm = async () => {
    const words = [...freqWords(), ...dictWords()];
    if (words.length === 0 || isAdding()) return;
    setIsAdding(true);
    try {
      const result = await flashcards.addLevelStudyFlashcards(words, targetStatus(), props.language, {
        onProgress: (current, total) => setAddProgress({ current, total }),
      });
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
            <Show when={addProgress()}>
              {(p) => (
                <div class="bulk-add-progress">
                  <span class="bulk-add-progress-label">
                    {t('mlearn.LevelStudy.BulkAdd.AddingProgress', {
                      current: String(p().current),
                      total: String(p().total),
                    })}
                  </span>
                  <ProgressBar
                    value={p().total > 0 ? (p().current / p().total) * 100 : 0}
                    variant="primary"
                    size="sm"
                  />
                </div>
              )}
            </Show>
            <span class="bulk-add-count">
              {t('mlearn.LevelStudy.BulkAdd.MatchingCount', { count: String(totalCount()) })}
            </span>
            <Btn size="sm" variant="secondary" onClick={props.onClose}>
              {t('mlearn.LevelStudy.BulkAdd.Cancel')}
            </Btn>
            <Btn
              size="sm"
              variant="primary"
              onClick={handleConfirm}
              disabled={isAdding() || dictBuilding() || totalCount() === 0 || !filterValidation().ok}
            >
              {isAdding()
                ? t('mlearn.LevelStudy.BulkAdd.Adding')
                : t('mlearn.LevelStudy.DetailModal.AddFlashcards', { count: String(totalCount()) })}
            </Btn>
          </div>
        </div>
      }
    >
      <p class="bulk-add-modal-hint">{t('mlearn.LevelStudy.BulkAdd.Hint')}</p>
      <Input
        class="bulk-add-search"
        type="search"
        fullWidth
        placeholder={t('mlearn.LevelStudy.BulkAdd.SearchPlaceholder')}
        value={searchQuery()}
        onInput={(e) => setSearchQuery(e.currentTarget.value)}
      />
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
