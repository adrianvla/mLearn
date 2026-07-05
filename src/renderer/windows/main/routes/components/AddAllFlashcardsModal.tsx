import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Btn, CheckboxCard, Modal, PillLabel, Select, type SelectOption } from '../../../../components/common';
import { useLanguage, useLocalization } from '../../../../context';
import { getFrequencyLevelLabel, getFrequencyLevelVisualRank, isDisplayableFrequencyLevel, isFrequencyLevelAtOrEasierThanTarget, sortFrequencyLevelsForDisplay } from '../../../../../shared/languageFeatures';
import type { ReaderUnknownWordEntry } from './ReaderUnknownWordsSidebar';
import './AddAllFlashcardsModal.css';

interface AddAllFlashcardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  allEntries: ReaderUnknownWordEntry[];
  dictionaryEntries: ReaderUnknownWordEntry[];
  onAdd: (entries: ReaderUnknownWordEntry[]) => void;
}

export const AddAllFlashcardsModal: Component<AddAllFlashcardsModalProps> = (props) => {
  const { t } = useLocalization();
  const { currentLangData, getFreqLevelNames, getFrequency, getLanguageFeatures, getLevelName } = useLanguage();

  const [levelFilterEnabled, setLevelFilterEnabled] = createSignal(false);
  const [dictionaryFilterEnabled, setDictionaryFilterEnabled] = createSignal(false);
  const [selectedLevel, setSelectedLevel] = createSignal('');
  const [checkedKeys, setCheckedKeys] = createSignal<Set<string>>(new Set());
  const [showWordList, setShowWordList] = createSignal(false);

  createEffect(() => {
    if (props.isOpen) {
      setLevelFilterEnabled(false);
      setDictionaryFilterEnabled(false);
      setSelectedLevel('');
      setShowWordList(false);
    }
  });

  const hasFrequencyLevels = createMemo(() => getLanguageFeatures().supportsFrequencyLevels);

  const levelOptions = createMemo<SelectOption[]>(() => {
    const names = getFreqLevelNames();
    const languageData = currentLangData();
    const discoveredLevels = props.allEntries
      .map((entry) => getFrequency(entry.word)?.raw_level)
      .filter((level): level is number => isDisplayableFrequencyLevel(level, names, languageData));
    const levels = Array.from(new Set([
      ...Object.keys(names).map(Number).filter((level) => isDisplayableFrequencyLevel(level, names, languageData)),
      ...discoveredLevels,
    ]));
    return sortFrequencyLevelsForDisplay(levels, languageData)
      .map((level) => ({ value: String(level), label: getFrequencyLevelLabel(level, names, languageData) }));
  });

  const defaultLevel = createMemo(() => {
    const opts = levelOptions();
    return opts.length > 0 ? opts[opts.length - 1].value : '';
  });

  const effectiveLevel = createMemo(() => selectedLevel() || defaultLevel());

  const levelFilteredEntries = createMemo(() => {
    const threshold = Number(effectiveLevel());
    if (!Number.isFinite(threshold)) return [];
    return props.allEntries.filter((entry) => {
      const freq = getFrequency(entry.word);
      return freq && isFrequencyLevelAtOrEasierThanTarget(freq.raw_level, threshold, currentLangData());
    });
  });

  const selectedEntries = createMemo(() => {
    const useLevel = levelFilterEnabled() && hasFrequencyLevels();
    const useDict = dictionaryFilterEnabled();

    if (!useLevel && !useDict) return [];

    const seen = new Set<string>();
    const result: ReaderUnknownWordEntry[] = [];

    const collect = (entries: ReaderUnknownWordEntry[]) => {
      for (const entry of entries) {
        if (!seen.has(entry.key)) {
          seen.add(entry.key);
          result.push(entry);
        }
      }
    };

    if (useLevel) collect(levelFilteredEntries());
    if (useDict) collect(props.dictionaryEntries);

    return result;
  });

  const anyFilterEnabled = createMemo(() => levelFilterEnabled() || dictionaryFilterEnabled());

  // The entries that the user will confirm: filtered if filters are active, otherwise all
  const entriesToConfirm = createMemo(() => {
    return anyFilterEnabled() ? selectedEntries() : props.allEntries;
  });

  // Reset checked keys when entries to confirm change
  createEffect(() => {
    const entries = entriesToConfirm();
    setCheckedKeys(new Set(entries.map(e => e.key)));
  });

  const checkedEntries = createMemo(() => {
    const keys = checkedKeys();
    return entriesToConfirm().filter(e => keys.has(e.key));
  });

  const allChecked = createMemo(() => checkedKeys().size === entriesToConfirm().length && entriesToConfirm().length > 0);

  const toggleAll = () => {
    if (allChecked()) {
      setCheckedKeys(new Set<string>());
    } else {
      setCheckedKeys(new Set(entriesToConfirm().map(e => e.key)));
    }
  };

  const toggleEntry = (key: string) => {
    setCheckedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleProceedToConfirm = () => {
    setShowWordList(true);
  };

  const handleAddChecked = () => {
    const entries = checkedEntries();
    if (entries.length > 0) {
      props.onAdd(entries);
      props.onClose();
    }
  };

  const handleBack = () => {
    setShowWordList(false);
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={showWordList() ? t('mlearn.Reader.Sidebar.AddModal.WordListTitle') : t('mlearn.Reader.Sidebar.AddModal.Title')}
      size="lg"
      footer={
        <Show when={showWordList()} fallback={
          <>
            <Btn
              variant="ghost"
              label={t('mlearn.Global.Cancel')}
              onClick={props.onClose}
            />
            <Btn
              variant="primary"
              label={anyFilterEnabled()
                ? t('mlearn.Reader.Sidebar.AddModal.AddSelected', { count: selectedEntries().length })
                : t('mlearn.Reader.Sidebar.AddModal.AddAll', { count: props.allEntries.length })
              }
              onClick={handleProceedToConfirm}
              disabled={anyFilterEnabled() ? selectedEntries().length === 0 : props.allEntries.length === 0}
            />
          </>
        }>
          <>
            <Btn
              variant="ghost"
              label={t('mlearn.Global.Back')}
              onClick={handleBack}
            />
            <Btn
              variant="primary"
              label={t('mlearn.Reader.Sidebar.AddModal.AddChecked', { count: checkedEntries().length })}
              onClick={handleAddChecked}
              disabled={checkedEntries().length === 0}
            />
          </>
        </Show>
      }
    >
      <Show when={showWordList()} fallback={
        <div class="add-all-modal-content">
          <Show when={hasFrequencyLevels()}>
            <CheckboxCard
              checked={levelFilterEnabled()}
              onChange={setLevelFilterEnabled}
              title={t('mlearn.Reader.Sidebar.AddModal.LevelFilter')}
              description={t('mlearn.Reader.Sidebar.AddModal.LevelFilterDescription')}
            >
              <Select
                options={levelOptions()}
                value={effectiveLevel()}
                onChange={(e) => setSelectedLevel(e.currentTarget.value)}
                disabled={!levelFilterEnabled()}
              />
            </CheckboxCard>
          </Show>
          <CheckboxCard
            checked={dictionaryFilterEnabled()}
            onChange={setDictionaryFilterEnabled}
            title={t('mlearn.Reader.Sidebar.AddModal.DictionaryFilter')}
            description={t('mlearn.Reader.Sidebar.AddModal.DictionaryFilterDescription')}
          />
        </div>
      }>
        <div class="add-all-modal-content">
          <div class="add-all-modal-select-actions">
            <Btn
              variant="ghost"
              size="sm"
              label={allChecked() ? t('mlearn.Reader.Sidebar.AddModal.DeselectAll') : t('mlearn.Reader.Sidebar.AddModal.SelectAll')}
              onClick={toggleAll}
            />
          </div>
          <div class="add-all-modal-word-list">
            <For each={entriesToConfirm()}>
              {(entry) => {
                const freq = getFrequency(entry.word);
                const levelData = freq
                  ? {
                      level: freq.raw_level,
                      visualLevel: getFrequencyLevelVisualRank(freq.raw_level, getFreqLevelNames(), currentLangData()),
                      name: freq.level,
                    }
                  : null;
                return (
                  <label class="add-all-modal-word-item">
                    <input
                      type="checkbox"
                      checked={checkedKeys().has(entry.key)}
                      onChange={() => toggleEntry(entry.key)}
                    />
                    <span class="add-all-modal-word-text">{entry.word}</span>
                    <Show when={levelData}>
                      <PillLabel level={levelData!.level} visualLevel={levelData!.visualLevel} size="xs">
                        {levelData!.name || getLevelName(levelData!.level)}
                      </PillLabel>
                    </Show>
                  </label>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </Modal>
  );
};
