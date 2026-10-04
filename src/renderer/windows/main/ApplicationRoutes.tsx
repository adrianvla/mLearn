import { Route, useLocation, useNavigate } from '@solidjs/router';
import { Show, createMemo, type Component } from 'solid-js';
import { FlashcardsContent } from '../flashcards/App';
import { ConversationContent } from '../conversationAgent/App';
import { LevelStudyContent } from '../levelStudy/App';
import { WordSyncContent } from '../wordSync/App';
import { CharacterGridContent } from '../characterGrid/App';
import { WordDbEditorContent } from '../wordDbEditor/App';
import { StatisticsContent } from '../statistics/App';
import { SettingsContent } from '../settings/SettingsWindow';
import { MobileSettingsView } from '../settings/MobileSettingsView';
import { useLocalization } from '../../context';
import { Button, LearningWorkspace } from '../../components/common';
import { WelcomeRoute } from './routes/WelcomeRoute';
import { ReaderRoute } from './routes/ReaderRoute';
import { VideoRoute } from './routes/VideoRoute';
import { isMobile } from '../../../shared/platform';
import { LicensesRoute } from '../mobile/routes/LicensesRoute';

/** Hash history events may omit transport state. Do not remount a just-admitted request twice. */
const RequestedContent: Component<{ content: Component }> = props => {
  const location = useLocation();
  const requestId = createMemo<string>(previous =>
    (location.state as { applicationRequestId?: string } | null)?.applicationRequestId ?? previous, 'open');
  return <Show keyed when={requestId()}>{_requestId => <props.content />}</Show>;
};

const Review: Component = () => {
  const navigate = useNavigate();
  return <LearningWorkspace><FlashcardsContent onClose={() => navigate('/')} /></LearningWorkspace>;
};
const Material: Component = () => {
  const navigate = useNavigate();
  return <FlashcardsContent initialTab="browse" onClose={() => navigate('/knowledge')} />;
};
const Plan: Component = () => {
  const navigate = useNavigate();
  return <LevelStudyContent onClose={() => navigate('/plan')} />;
};
const Evaluate: Component = () => {
  const { t } = useLocalization();
  const navigate = useNavigate();
  return <section class="product-workspace"><h1>{t('mlearn.Product.Evaluate')}</h1>
    <p>{t('mlearn.Product.KnowledgeCheckDescription')}</p>
    <div class="product-workspace-actions"><Button variant="primary" onClick={() => navigate('/evaluate/words')}>{t('mlearn.Product.KnowledgeCheck')}</Button>
      <Button onClick={() => navigate('/evaluate/grammar')}>{t('mlearn.Product.GrammarCheck')}</Button></div>
  </section>;
};
const Assessment: Component = () => {
  const navigate = useNavigate();
  return <LearningWorkspace><WordSyncContent mode="assessment" onClose={() => navigate('/evaluate')} onAssessmentApplied={() => navigate('/plan')} /></LearningWorkspace>;
};
const Words: Component = () => {
  const navigate = useNavigate();
  return <LevelStudyContent onClose={() => navigate('/practise')} />;
};
const Knowledge: Component = () => {
  const { t } = useLocalization();
  const navigate = useNavigate();
  return <><div class="product-workspace-actions"><Button onClick={() => navigate('/knowledge/material')}>{t('mlearn.Product.SavedMaterial')}</Button>
    <Button onClick={() => navigate('/knowledge/characters')}>{t('mlearn.LevelStudy.Tabs.CharacterGrid')}</Button></div><WordDbEditorContent /></>;
};
const Settings: Component = () => <Show when={isMobile()} fallback={<SettingsContent />}><MobileSettingsView /></Show>;

const requested = (content: Component) => () => <RequestedContent content={content} />;

export const ApplicationRoutes = () => <>
  <Route path="/" component={WelcomeRoute} />
  <Route path="/reader" component={ReaderRoute} /><Route path="/video" component={VideoRoute} />
  <Route path="/messenger" component={requested(ConversationContent)} />
  <Route path="/practise" component={requested(Review)} />
  <Route path="/practise/words" component={requested(Words)} />
  <Route path="/practise/grammar" component={requested(Plan)} />
  <Route path="/evaluate" component={Evaluate} /><Route path="/evaluate/words" component={Assessment} />
  <Route path="/evaluate/grammar" component={requested(Plan)} />
  <Route path="/plan" component={requested(Plan)} />
  <Route path="/knowledge" component={Knowledge} /><Route path="/knowledge/material" component={requested(Material)} />
  <Route path="/knowledge/characters" component={CharacterGridContent} />
  <Route path="/progress" component={StatisticsContent} /><Route path="/settings" component={requested(Settings)} />
  <Route path="/flashcards" component={requested(Review)} /><Route path="/level-study" component={requested(Plan)} />
  <Route path="/conversation-agent" component={requested(ConversationContent)} /><Route path="/word-db-editor" component={Knowledge} />
  <Route path="/statistics" component={StatisticsContent} />
  <Route path="/licenses" component={LicensesRoute} />
</>;
