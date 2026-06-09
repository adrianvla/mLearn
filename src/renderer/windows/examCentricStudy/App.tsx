import { Component, createSignal, createMemo } from 'solid-js';
import { WindowWrapper, useLocalization } from '../../context';
import { TabContainer, TabPanel, type TabItem } from '../../components/common';
import { TargetIcon, BookIcon, GridIcon, SparklesIcon } from '../../components/common';
import { WordSyncContent } from '../wordSync/App';
import { KanjiGridContent } from '../kanjiGrid/App';
import { ExamStudyTab } from './ExamStudyTab';
import './ExamCentricStudy.css';

export const ExamCentricStudyContent: Component = () => {
  const { t } = useLocalization();
  const [activeTab, setActiveTab] = createSignal('word-sync');

  const tabs = createMemo<TabItem[]>(() => [
    {
      id: 'word-sync',
      label: t('mlearn.ExamCentricStudy.Tabs.WordSync'),
      icon: <BookIcon size={16} />,
    },
    {
      id: 'kanji-grid',
      label: t('mlearn.ExamCentricStudy.Tabs.CharacterGrid'),
      icon: <GridIcon size={16} />,
    },
    {
      id: 'exam-study',
      label: t('mlearn.ExamCentricStudy.Tabs.ExamStudy'),
      icon: <SparklesIcon size={16} />,
    },
  ]);

  return (
    <div class="exam-centric-study">
      <div class="ecs-header">
        <div class="ecs-header-title">
          <TargetIcon size={20} />
          <span>{t('mlearn.ExamCentricStudy.Title')}</span>
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
      <div class="ecs-content">
        <TabPanel tabId="word-sync" activeTab={activeTab()}>
          <WordSyncContent />
        </TabPanel>
        <TabPanel tabId="kanji-grid" activeTab={activeTab()}>
          <KanjiGridContent />
        </TabPanel>
        <TabPanel tabId="exam-study" activeTab={activeTab()}>
          <ExamStudyTab />
        </TabPanel>
      </div>
    </div>
  );
};

export const ExamCentricStudyApp: Component = () => {
  return (
    <WindowWrapper showTitleBar={true}>
      <ExamCentricStudyContent />
    </WindowWrapper>
  );
};

export default ExamCentricStudyApp;
