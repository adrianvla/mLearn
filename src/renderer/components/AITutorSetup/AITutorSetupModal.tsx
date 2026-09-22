/**
 * AITutorSetupModal
 * Modal for configuring an AI tutor session — grammar, words, media, and custom instructions.
 */

import { Component, createSignal, Show, For } from 'solid-js';
import { useLocalization } from '../../context';
import { useLanguage } from '../../context/LanguageContext';
import { Modal, Btn, Textarea, HintText, TabContainer } from '../common';
import type { TabItem } from '../common/Tabs/TabContainer';
import type { TutorSessionConfig, TutorGrammarSelection, TutorWordSelection, TutorMediaSelection } from '../../../shared/types';
import { GrammarSelector } from './GrammarSelector';
import { WordSelector } from './WordSelector';
import { MediaSelector } from './MediaSelector';
import './AITutorSetupModal.css';

interface AITutorSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (config: TutorSessionConfig) => void;
}

export const AITutorSetupModal: Component<AITutorSetupModalProps> = (props) => {
  const { t } = useLocalization();
  const { supportsGrammar } = useLanguage();

  const [intent, setIntent] = createSignal('IntentPlan');
  const [advanced, setAdvanced] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal('grammar');
  const [selectedGrammar, setSelectedGrammar] = createSignal<TutorGrammarSelection[]>([]);
  const [selectedWords, setSelectedWords] = createSignal<TutorWordSelection[]>([]);
  const [customWords, setCustomWords] = createSignal<TutorWordSelection[]>([]);
  const [selectedMedia, setSelectedMedia] = createSignal<TutorMediaSelection[]>([]);
  const [customInstructions, setCustomInstructions] = createSignal('');

  const tabs = (): TabItem[] => {
    const items: TabItem[] = [];
    if (supportsGrammar()) {
      items.push({
        id: 'grammar',
        label: t('mlearn.AITutorSetup.GrammarTab'),
        badge: selectedGrammar().length || undefined,
      });
    }
    items.push(
      {
        id: 'words',
        label: t('mlearn.AITutorSetup.WordsTab'),
        badge: selectedWords().length || undefined,
      },
      {
        id: 'media',
        label: t('mlearn.AITutorSetup.MediaTab'),
        badge: selectedMedia().length || undefined,
      }
    );
    return items;
  };

  // If grammar isn't supported and active tab is grammar, switch to words
  const effectiveTab = () => {
    if (activeTab() === 'grammar' && !supportsGrammar()) return 'words';
    return activeTab();
  };

  const handleStart = () => {
    const config: TutorSessionConfig = {
      selectedGrammar: selectedGrammar(),
      selectedWords: selectedWords(),
      selectedMedia: selectedMedia(),
      customInstructions: [t(`mlearn.AITutorSetup.${intent()}`), customInstructions().trim()].filter(Boolean).join('\n\n'),
    };
    props.onStart(config);
    // Reset state after starting
    setSelectedGrammar([]);
    setSelectedWords([]);
    setCustomWords([]);
    setSelectedMedia([]);
    setCustomInstructions('');
    setActiveTab('grammar');
    setIntent('IntentPlan');
    setAdvanced(false);
  };

  const footer = (
    <div class="ai-tutor-setup-modal__footer">
      <Btn variant="ghost" onClick={props.onClose}>
        {t('mlearn.Global.Cancel')}
      </Btn>
      <Btn variant="primary" onClick={handleStart}>
        {t('mlearn.AITutorSetup.StartSession')}
      </Btn>
    </div>
  );

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.AITutorSetup.Title')}
      size="lg"
      panelClass="ai-tutor-setup-modal"
      footer={footer}
    >
      <div class="ai-tutor-setup-modal__body">
        <p>{t('mlearn.AITutorSetup.IntentDescription')}</p>
        <fieldset class="ai-tutor-setup-modal__intents">
          <legend>{t('mlearn.AITutorSetup.IntentTitle')}</legend>
          <For each={['IntentPlan', 'IntentConversation', 'IntentTopic']}>{key =>
            <label classList={{ 'is-selected': intent() === key }}>
              <input type="radio" name="tutor-purpose" checked={intent() === key} onChange={() => setIntent(key)} />
              <span>{t(`mlearn.AITutorSetup.${key}`)}</span>
            </label>
          }</For>
        </fieldset>
        <div class="ai-tutor-setup-modal__instructions">
          <label for="tutor-session-request">{t('mlearn.AITutorSetup.InstructionsLabel')}</label>
          <Textarea id="tutor-session-request" value={customInstructions()} onInput={e => setCustomInstructions(e.currentTarget.value)} placeholder={t('mlearn.AITutorSetup.InstructionsPlaceholder')} rows={3} />
        </div>
        <Btn variant="ghost" aria-expanded={advanced()} onClick={() => setAdvanced(!advanced())}>{t('mlearn.AITutorSetup.Advanced')}</Btn>
        <Show when={advanced()}>
        <HintText>{t('mlearn.AITutorSetup.AdvancedDescription')}</HintText>
        <TabContainer
          tabs={tabs()}
          activeTab={effectiveTab()}
          onTabChange={setActiveTab}
          variant="pills"
          size="sm"
        />

        <div class="ai-tutor-setup-modal__tab-content">
          <Show when={effectiveTab() === 'grammar'}>
            <GrammarSelector
              selected={selectedGrammar()}
              onSelectionChange={setSelectedGrammar}
            />
          </Show>

          <Show when={effectiveTab() === 'words'}>
            <WordSelector
              selected={selectedWords()}
              onSelectionChange={setSelectedWords}
              customWords={customWords()}
              onCustomWordsChange={setCustomWords}
            />
          </Show>

          <Show when={effectiveTab() === 'media'}>
            <MediaSelector
              selected={selectedMedia()}
              onSelectionChange={setSelectedMedia}
            />
          </Show>


        </div>
        </Show>
      </div>
    </Modal>
  );
};
