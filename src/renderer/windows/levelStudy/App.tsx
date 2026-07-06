import { Component, Show, createEffect, createSignal, createMemo } from 'solid-js';
import { WindowWrapper, useLanguage, useLocalization } from '../../context';
import { TabContainer, TabPanel, type TabItem } from '../../components/common';
import { TargetIcon, BookIcon, GridIcon, SparklesIcon } from '../../components/common';
import { WordSyncContent } from '../wordSync/App';
import { CharacterGridContent } from '../characterGrid/App';
import { LevelStudyTab } from './LevelStudyTab';
import { getCharacterStudyScripts } from '../../../shared/languageFeatures';
import './LevelStudy.css';

export const LevelStudyContent: Component = () => {
  const { t } = useLocalization();
  const { currentLangData } = useLanguage();
  const [activeTab, setActiveTab] = createSignal('word-sync');
  const showCharacterGrid = createMemo(() => getCharacterStudyScripts(currentLangData()).length > 0);

  const tabs = createMemo<TabItem[]>(() => {
    const items: TabItem[] = [{
      id: 'word-sync',
      label: t('mlearn.LevelStudy.Tabs.WordSync'),
      icon: <BookIcon size={16} />,
    }];
    if (showCharacterGrid()) {
      items.push({
        id: 'character-grid',
        label: t('mlearn.LevelStudy.Tabs.CharacterGrid'),
        icon: <GridIcon size={16} />,
      });
    }
    items.push({
      id: 'level-study',
      label: t('mlearn.LevelStudy.Tabs.LevelStudy'),
      icon: <SparklesIcon size={16} />,
    });
    return items;
  });

  createEffect(() => {
    if (activeTab() === 'character-grid' && !showCharacterGrid()) {
      setActiveTab('word-sync');
    }
  });

  return (
    <div class="level-study">
      <div class="level-study-header">
        <div class="level-study-header-title">
          <TargetIcon size={20} />
          <span>{t('mlearn.LevelStudy.Title')}</span>
        </div>
        <TabContainer
          tabs={tabs()}
          activeTab={activeTab()}
          onTabChange={setActiveTab}
          orientation="horizontal"
          variant="underline"
          size="md"
        />
      </div>
      <div class="level-study-content">
        <TabPanel tabId="word-sync" activeTab={activeTab()}>
          <WordSyncContent />
        </TabPanel>
        <Show when={showCharacterGrid()}>
          <TabPanel tabId="character-grid" activeTab={activeTab()}>
            <CharacterGridContent />
          </TabPanel>
        </Show>
        <TabPanel tabId="level-study" activeTab={activeTab()}>
          <LevelStudyTab />
        </TabPanel>
      </div>
    </div>
  );
};

export const LevelStudyApp: Component = () => {
  return (
    <WindowWrapper>
      <LevelStudyContent />
    </WindowWrapper>
  );
};

export default LevelStudyApp;
