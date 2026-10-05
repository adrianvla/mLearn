import { MemoryBrowserContent } from '../memoryBrowser/App';
import { useApplicationNavigate, useApplicationReturn } from './applicationHost';
import { Route, useLocation } from '@solidjs/router';
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

const Memory: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationNavigate();
  return <MemoryBrowserContent launchContext={props.launchContext} onReturn={() => navigate('/messenger')} />;
};
const Messenger: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationReturn();
  return <ConversationContent launchContext={props.launchContext} onReturn={source => {
    // A targeted discussion belongs to the completed check, even while an
    // older media conversation remains selected during preparation.
    if (props.launchContext?.returnTo === 'mock') {
      navigate('/evaluate/grammar/mock');
      return;
    }
    // Cancelling preparation clears its transient media hints. The routed
    // launch still owns Return and must not fall back to an older chat.
    const requestedSource = props.launchContext?.sourceContext;
    const returnSource = requestedSource && typeof requestedSource === 'object' && !Array.isArray(requestedSource)
      ? requestedSource as Record<string, unknown> : source;
    const path = returnSource?.workspace === 'reader' ? '/reader' : returnSource?.workspace === 'video' ? '/video' : props.launchContext?.returnTo === 'plan' ? '/plan' : '/';
    navigate(path, { sourceContext: returnSource });
  }} />;
};
const Review: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationReturn();
  return <LearningWorkspace><FlashcardsContent workspace="review" launchContext={props.launchContext} onClose={() => navigate(
    props.launchContext?.returnTo === 'plan' ? '/plan' : props.launchContext?.returnTo === 'material' ? '/knowledge/material' : '/'
  )} /></LearningWorkspace>;
};
const Material: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationNavigate();
  return <FlashcardsContent workspace="material" launchContext={props.launchContext} initialTab="browse" onClose={() => navigate('/knowledge')} />;
};
const Plan: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationNavigate();
  return <LevelStudyContent workspace="plan" launchContext={props.launchContext} onClose={() => navigate('/plan')} />;
};
const Grammar: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationReturn();
  return <LearningWorkspace><LevelStudyContent workspace="grammar" launchContext={props.launchContext}
    onClose={() => navigate(props.launchContext?.returnTo === 'home' ? '/' : props.launchContext?.returnTo === 'mock' ? '/evaluate/grammar/mock' : props.launchContext?.returnTo === 'evaluate' ? '/evaluate/grammar' : '/plan')} /></LearningWorkspace>;
};
const GrammarAssessment: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationReturn();
  return <LearningWorkspace><LevelStudyContent workspace="grammar-check" launchContext={props.launchContext}
    onClose={() => navigate(props.launchContext?.returnTo === 'plan' ? '/plan' : '/evaluate')} /></LearningWorkspace>;
};
const GrammarMock: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationReturn();
  return <LearningWorkspace><LevelStudyContent workspace="mock" launchContext={props.launchContext}
    onClose={() => navigate(props.launchContext?.returnTo === 'plan' ? '/plan' : '/evaluate')} /></LearningWorkspace>;
};
const Evaluate: Component = () => {
  const { t } = useLocalization();
  const navigate = useApplicationNavigate();
  return <section class="product-workspace"><h1>{t('mlearn.Product.Evaluate')}</h1>
    <p>{t('mlearn.Product.KnowledgeCheckDescription')}</p>
    <div class="product-workspace-actions"><Button variant="primary" onClick={() => navigate('/evaluate/words')}>{t('mlearn.Product.KnowledgeCheck')}</Button>
      <Button onClick={() => navigate('/evaluate/grammar')}>{t('mlearn.Product.GrammarCheck')}</Button>
      <Button onClick={() => navigate('/evaluate/grammar/mock')}>{t('mlearn.LevelStudy.Mock.Title')}</Button></div>
  </section>;
};
const returnToWorkspace = (navigate: ReturnType<typeof useApplicationReturn>, context: Record<string, unknown> | undefined) => (path: string, savedContext?: Record<string, unknown>) => navigate(path, savedContext ?? context);
const Assessment: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationReturn();
  return <LearningWorkspace><WordStudyWorkspace mode="assessment" launchContext={props.launchContext} onReturn={returnToWorkspace(navigate, props.launchContext)} /></LearningWorkspace>;
};
const Words: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationReturn();
  return <LearningWorkspace><WordStudyWorkspace mode="study" launchContext={props.launchContext} onReturn={returnToWorkspace(navigate, props.launchContext)} /></LearningWorkspace>;
};
const Knowledge: Component = () => {
  const { t } = useLocalization();
  const navigate = useApplicationNavigate();
  return <><div class="product-workspace-actions"><Button onClick={() => navigate('/knowledge/material')}>{t('mlearn.Product.SavedMaterial')}</Button>
    <Button onClick={() => navigate('/knowledge/characters')}>{t('mlearn.LevelStudy.Tabs.CharacterGrid')}</Button></div><WordDbEditorContent /></>;
};
const Settings: Component<RequestedWorkspaceProps> = props => <Show when={isMobile()} fallback={<SettingsContent launchContext={props.launchContext} />}><MobileSettingsView launchContext={props.launchContext} /></Show>;

const requested = (content: Component<RequestedWorkspaceProps>) => () => <RequestedContent content={content} />;

export const ApplicationRoutes = () => <>
  <Route path="/" component={WelcomeRoute} />
  <Route path="/reader" component={requested(ReaderRoute)} /><Route path="/video" component={requested(VideoRoute)} />
  <Route path="/messenger" component={requested(Messenger)} />
  <Route path="/messenger/memory" component={requested(Memory)} />
  <Route path="/practise" component={requested(Review)} />
  <Route path="/practise/words" component={requested(Words)} />
  <Route path="/practise/grammar" component={requested(Grammar)} />
  <Route path="/evaluate" component={Evaluate} /><Route path="/evaluate/words" component={requested(Assessment)} />
  <Route path="/evaluate/grammar" component={requested(GrammarAssessment)} />
  <Route path="/evaluate/grammar/mock" component={requested(GrammarMock)} />
  <Route path="/plan" component={requested(Plan)} />
  <Route path="/knowledge" component={Knowledge} /><Route path="/knowledge/material" component={requested(Material)} />
  <Route path="/knowledge/characters" component={CharacterGridContent} />
  <Route path="/progress" component={StatisticsContent} /><Route path="/settings" component={requested(Settings)} />
  <Route path="/flashcards" component={requested(Review)} /><Route path="/level-study" component={requested(Plan)} />
  <Route path="/conversation-agent" component={requested(Messenger)} /><Route path="/word-db-editor" component={Knowledge} />
  <Route path="/statistics" component={StatisticsContent} />
  <Route path="/licenses" component={LicensesRoute} />
</>;
