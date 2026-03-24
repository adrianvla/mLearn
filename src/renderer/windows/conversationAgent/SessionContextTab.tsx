/**
 * SessionContextTab
 * Context panel for the conversation agent window.
 * When a tutor session config exists, shows the same selectors as the AITutorSetupModal
 * (grammar, words, media, instructions) so users can edit context mid-conversation.
 * When no tutor config exists, falls back to MediaStatsTab.
 */

import { Component, Show, createSignal } from 'solid-js';
import type {
  ConversationAgentContext,
  TutorSessionConfig,
  TutorWordSelection,
  TutorGrammarSelection,
  TutorMediaSelection,
} from '../../../shared/types';
import { useLocalization, useLanguage } from '../../context';
import {
  TabContainer,
  HintText,
  Textarea,
} from '../../components/common';
import type { TabItem } from '../../components/common';
import { WordSelector } from '../../components/AITutorSetup/WordSelector';
import { GrammarSelector } from '../../components/AITutorSetup/GrammarSelector';
import { MediaSelector } from '../../components/AITutorSetup/MediaSelector';
import { MediaStatsTab } from './MediaStatsTab';
import './SessionContextTab.css';

interface SessionContextTabProps {
  context: ConversationAgentContext | null;
  tutorConfig: TutorSessionConfig | null;
  onTutorConfigChange: (config: TutorSessionConfig) => void;
}

export const SessionContextTab: Component<SessionContextTabProps> = (props) => {
  const { t } = useLocalization();
  const { supportsGrammar } = useLanguage();

  const [subTab, setSubTab] = createSignal<string>(supportsGrammar() ? 'grammar' : 'words');
  const [customWords, setCustomWords] = createSignal<TutorWordSelection[]>([]);

  const config = () => props.tutorConfig;

  const tabs = (): TabItem[] => {
    const cfg = config();
    if (!cfg) return [];

    const items: TabItem[] = [];

    if (supportsGrammar()) {
      items.push({
        id: 'grammar',
        label: t('mlearn.AITutorSetup.GrammarTab'),
        badge: cfg.selectedGrammar.length || undefined,
      });
    }

    items.push({
      id: 'words',
      label: t('mlearn.AITutorSetup.WordsTab'),
      badge: cfg.selectedWords.length || undefined,
    });

    items.push({
      id: 'media',
      label: t('mlearn.AITutorSetup.MediaTab'),
      badge: cfg.selectedMedia.length || undefined,
    });

    items.push({
      id: 'instructions',
      label: t('mlearn.AITutorSetup.InstructionsTab'),
    });

    items.push({
      id: 'stats',
      label: t('mlearn.ConversationAgent.Tab.Stats'),
    });

    return items;
  };

  // If grammar isn't supported and active tab is grammar, switch to words
  const effectiveTab = () => {
    if (subTab() === 'grammar' && !supportsGrammar()) return 'words';
    return subTab();
  };

  const handleWordsChange = (words: TutorWordSelection[]) => {
    const cfg = config();
    if (!cfg) return;
    props.onTutorConfigChange({ ...cfg, selectedWords: words });
  };

  const handleGrammarChange = (grammar: TutorGrammarSelection[]) => {
    const cfg = config();
    if (!cfg) return;
    props.onTutorConfigChange({ ...cfg, selectedGrammar: grammar });
  };

  const handleMediaChange = (media: TutorMediaSelection[]) => {
    const cfg = config();
    if (!cfg) return;
    props.onTutorConfigChange({ ...cfg, selectedMedia: media });
  };

  const handleInstructionsChange = (instructions: string) => {
    const cfg = config();
    if (!cfg) return;
    props.onTutorConfigChange({ ...cfg, customInstructions: instructions });
  };

  return (
    <Show
      when={config()}
      fallback={<MediaStatsTab context={props.context} />}
    >
      {(cfg) => (
        <div class="ca-session-context">
          <TabContainer
            tabs={tabs()}
            activeTab={effectiveTab()}
            onTabChange={setSubTab}
            variant="pills"
            size="sm"
          />

          <div class="ca-session-content">
            <Show when={effectiveTab() === 'grammar'}>
              <div class="ca-session-pane">
                <GrammarSelector
                  selected={cfg().selectedGrammar}
                  onSelectionChange={handleGrammarChange}
                />
              </div>
            </Show>

            <Show when={effectiveTab() === 'words'}>
              <div class="ca-session-pane">
                <WordSelector
                  selected={cfg().selectedWords}
                  onSelectionChange={handleWordsChange}
                  customWords={customWords()}
                  onCustomWordsChange={setCustomWords}
                />
              </div>
            </Show>

            <Show when={effectiveTab() === 'media'}>
              <div class="ca-session-pane">
                <MediaSelector
                  selected={cfg().selectedMedia}
                  onSelectionChange={handleMediaChange}
                />
              </div>
            </Show>

            <Show when={effectiveTab() === 'instructions'}>
              <div class="ca-session-pane ca-session-pane--scroll">
                <div class="ca-session-instructions">
                  <HintText>{t('mlearn.AITutorSetup.InstructionsLabel')}</HintText>
                  <Textarea
                    value={cfg().customInstructions}
                    onInput={(e) => handleInstructionsChange(e.currentTarget.value)}
                    placeholder={t('mlearn.AITutorSetup.InstructionsPlaceholder')}
                    rows={6}
                  />
                </div>
              </div>
            </Show>

            <Show when={effectiveTab() === 'stats'}>
              <div class="ca-session-pane">
                <MediaStatsTab context={props.context} />
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
};
