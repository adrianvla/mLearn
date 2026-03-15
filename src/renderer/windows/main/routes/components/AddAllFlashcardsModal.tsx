import { Component, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Btn, CheckboxCard, Modal, Select, type SelectOption } from '../../../../components/common';
import { useLanguage, useLocalization } from '../../../../context';
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
  const { getFreqLevelNames, getFrequency, getLanguageFeatures } = useLanguage();

  const [levelFilterEnabled, setLevelFilterEnabled] = createSignal(false);
  const [dictionaryFilterEnabled, setDictionaryFilterEnabled] = createSignal(false);
  const [selectedLevel, setSelectedLevel] = createSignal('');

  createEffect(() => {
    if (props.isOpen) {
      setLevelFilterEnabled(false);
      setDictionaryFilterEnabled(false);
      setSelectedLevel('');
    }
  });

  const hasFrequencyLevels = createMemo(() => getLanguageFeatures().supportsFrequencyLevels);

  const levelOptions = createMemo<SelectOption[]>(() => {
    const names = getFreqLevelNames();
    return Object.entries(names)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => Number(b.value) - Number(a.value));
  });

  const defaultLevel = createMemo(() => {
    const opts = levelOptions();
    return opts.length > 0 ? opts[opts.length - 1].value : '';
  });

  const effectiveLevel = createMemo(() => selectedLevel() || defaultLevel());

  const levelFilteredEntries = createMemo(() => {
    const threshold = Number(effectiveLevel());
    if (!threshold) return [];
    return props.allEntries.filter((entry) => {
      const freq = getFrequency(entry.word);
      return freq && freq.raw_level >= threshold;
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

  const handleAddSelected = () => {
    const entries = selectedEntries();
    if (entries.length > 0) {
      props.onAdd(entries);
      props.onClose();
    }
  };

  const handleAddAll = () => {
    if (props.allEntries.length > 0) {
      props.onAdd(props.allEntries);
      props.onClose();
    }
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.Reader.Sidebar.AddModal.Title')}
      size="lg"
      footer={
        <>
          <Btn
            variant="ghost"
            label={t('mlearn.Global.Cancel')}
            onClick={props.onClose}
          />
          <Btn
            variant="secondary"
            label={t('mlearn.Reader.Sidebar.AddModal.AddAll', { count: props.allEntries.length })}
            onClick={handleAddAll}
            disabled={props.allEntries.length === 0}
          />
          <Btn
            variant="primary"
            label={t('mlearn.Reader.Sidebar.AddModal.AddSelected', { count: selectedEntries().length })}
            onClick={handleAddSelected}
            disabled={!anyFilterEnabled() || selectedEntries().length === 0}
          />
        </>
      }
    >
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
    </Modal>
  );
};
