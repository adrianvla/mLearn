import { Route, useLocation, useNavigate } from '@solidjs/router';
import { Show, createMemo, type Component } from 'solid-js';
import { FlashcardsContent } from '../flashcards/App';
import { ConversationContent } from '../conversationAgent/App';
import { LevelStudyContent } from '../levelStudy/App';
import { WordStudyWorkspace } from '../wordSync/WordStudyWorkspace';
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
type RequestedWorkspaceProps = { launchContext?: Record<string, unknown> };
const RequestedContent: Component<{ content: Component<RequestedWorkspaceProps> }> = props => {
  const location = useLocation();
  const requestId = createMemo<string>(previous =>
    (location.state as { applicationRequestId?: string } | null)?.applicationRequestId ?? previous, 'open');
  const context = createMemo<Record<string, unknown>>(previous =>
    (location.state as { applicationContext?: Record<string, unknown> } | null)?.applicationContext ?? previous, {});
  return <Show keyed when={requestId()}>{_requestId => <props.content launchContext={context()} />}</Show>;
};

const Review: Component<RequestedWorkspaceProps> = props => {
  const navigate = useNavigate();
  return <LearningWorkspace><FlashcardsContent workspace="review" launchContext={props.launchContext} onClose={() => navigate('/')} /></LearningWorkspace>;
};
const Material: Component<RequestedWorkspaceProps> = props => {
  const navigate = useNavigate();
  return <FlashcardsContent workspace="material" launchContext={props.launchContext} initialTab="browse" onClose={() => navigate('/knowledge')} />;
};
const Plan: Component<RequestedWorkspaceProps> = props => {
  const navigate = useNavigate();
  return <LevelStudyContent workspace="plan" launchContext={props.launchContext} onClose={() => navigate('/plan')} />;
};
const Grammar: Component<RequestedWorkspaceProps> = props => {
  const navigate = useNavigate();
  return <LearningWorkspace><LevelStudyContent workspace="grammar" launchContext={props.launchContext}
    onClose={() => navigate(props.launchContext?.returnTo === 'home' ? '/' : props.launchContext?.returnTo === 'evaluate' ? '/evaluate/grammar' : '/plan')} /></LearningWorkspace>;
};
const GrammarAssessment: Component<RequestedWorkspaceProps> = props => {
  const navigate = useNavigate();
  return <LearningWorkspace><LevelStudyContent workspace="mock" launchContext={props.launchContext}
    onClose={() => navigate(props.launchContext?.returnTo === 'plan' ? '/plan' : '/evaluate')} /></LearningWorkspace>;
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
const Assessment: Component<RequestedWorkspaceProps> = props => {
  const navigate = useNavigate();
  return <LearningWorkspace><WordStudyWorkspace mode="assessment" launchContext={props.launchContext} onReturn={navigate} /></LearningWorkspace>;
};
const Words: Component<RequestedWorkspaceProps> = props => {
  const navigate = useNavigate();
  return <LearningWorkspace><WordStudyWorkspace mode="study" launchContext={props.launchContext} onReturn={navigate} /></LearningWorkspace>;
};
const Knowledge: Component = () => {
  const { t } = useLocalization();
  const navigate = useNavigate();
  return <><div class="product-workspace-actions"><Button onClick={() => navigate('/knowledge/material')}>{t('mlearn.Product.SavedMaterial')}</Button>
    <Button onClick={() => navigate('/knowledge/characters')}>{t('mlearn.LevelStudy.Tabs.CharacterGrid')}</Button></div><WordDbEditorContent /></>;
};
const Settings: Component = () => <Show when={isMobile()} fallback={<SettingsContent />}><MobileSettingsView /></Show>;

const requested = (content: Component<RequestedWorkspaceProps>) => () => <RequestedContent content={content} />;

export const ApplicationRoutes = () => <>
  <Route path="/" component={WelcomeRoute} />
  <Route path="/reader" component={ReaderRoute} /><Route path="/video" component={VideoRoute} />
  <Route path="/messenger" component={requested(ConversationContent)} />
  <Route path="/practise" component={requested(Review)} />
  <Route path="/practise/words" component={requested(Words)} />
  <Route path="/practise/grammar" component={requested(Grammar)} />
  <Route path="/evaluate" component={Evaluate} /><Route path="/evaluate/words" component={requested(Assessment)} />
  <Route path="/evaluate/grammar" component={requested(GrammarAssessment)} />
  <Route path="/plan" component={requested(Plan)} />
  <Route path="/knowledge" component={Knowledge} /><Route path="/knowledge/material" component={requested(Material)} />
  <Route path="/knowledge/characters" component={CharacterGridContent} />
  <Route path="/progress" component={StatisticsContent} /><Route path="/settings" component={requested(Settings)} />
  <Route path="/flashcards" component={requested(Review)} /><Route path="/level-study" component={requested(Plan)} />
  <Route path="/conversation-agent" component={requested(ConversationContent)} /><Route path="/word-db-editor" component={Knowledge} />
  <Route path="/statistics" component={StatisticsContent} />
  <Route path="/licenses" component={LicensesRoute} />
</>;
