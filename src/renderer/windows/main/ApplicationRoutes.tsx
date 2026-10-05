import { MemoryBrowserContent } from '../memoryBrowser/App';
import { useApplicationNavigate, useApplicationReturn } from './applicationHost';
import { Route, useLocation } from '@solidjs/router';
import { Show, createMemo, type Component, type ParentComponent } from 'solid-js';
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
import { ActionCard, Button, TargetIcon, LearningWorkspace } from '../../components/common';
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
    props.launchContext?.returnTo === 'reader' ? '/reader' : props.launchContext?.returnTo === 'video' ? '/video'
      : props.launchContext?.returnTo === 'plan' ? '/plan' : props.launchContext?.returnTo === 'material' ? '/knowledge/material' : '/', props.launchContext
  )} /></LearningWorkspace>;
};
const Material: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationNavigate();
  return <KnowledgeViews><FlashcardsContent workspace="material" launchContext={props.launchContext} initialTab="browse" onClose={() => navigate('/knowledge')} /></KnowledgeViews>;
};
const Plan: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationNavigate();
  return <LevelStudyContent workspace="plan" launchContext={props.launchContext} onClose={() => navigate('/plan')} />;
};
const Grammar: Component<RequestedWorkspaceProps> = props => {
  const navigate = useApplicationReturn();
  return <LearningWorkspace><LevelStudyContent workspace="grammar" launchContext={props.launchContext}
    onClose={() => navigate(props.launchContext?.returnTo === 'home' ? '/' : props.launchContext?.returnTo === 'mock' ? '/evaluate/grammar/mock' : props.launchContext?.returnTo === 'evaluate' ? '/evaluate/grammar' : props.launchContext?.returnTo === 'reader' ? '/reader' : props.launchContext?.returnTo === 'video' ? '/video' : '/plan', props.launchContext)} /></LearningWorkspace>;
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
    <div class="study-chooser-alternatives"><ActionCard icon={<TargetIcon size={24} />} primary title={t('mlearn.Product.KnowledgeCheck')}
      description={t('mlearn.Product.KnowledgeCheckDescription')} onClick={() => navigate('/evaluate/words', { state: {
        applicationRequestId: crypto.randomUUID(), applicationContext: { intent: 'start', returnTo: 'evaluate' },
      } })} />
      <ActionCard icon={<TargetIcon size={24} />} title={t('mlearn.Product.GrammarCheck')}
        description={t('mlearn.Product.GrammarSelfCheckDescription')} onClick={() => navigate('/evaluate/grammar')} /></div>
      <div class="product-workspace-actions"><Button variant="ghost" onClick={() => navigate('/evaluate/grammar/mock')}>{t('mlearn.LevelStudy.Mock.Title')}</Button></div>
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
const KnowledgeViews: ParentComponent = props => {
  const { t } = useLocalization();
  const location = useLocation();
  const navigate = useApplicationNavigate();
  const view = (path: string, label: string) => <button type="button" classList={{ 'is-active': location.pathname === path }} onClick={() => navigate(path)}>{t(label)}</button>;
  return <section class="knowledge-views">
    <nav class="knowledge-view-navigation" aria-label={t('mlearn.Product.Knowledge')}>
      {view('/knowledge', 'mlearn.MediaStats.Tab.Words')}
      {view('/knowledge/material', 'mlearn.Product.SavedMaterial')}
      {view('/knowledge/characters', 'mlearn.LevelStudy.Tabs.CharacterGrid')}
    </nav><div class="knowledge-view-content">{props.children}</div>
  </section>;
};
const Knowledge: Component = () => <KnowledgeViews><WordDbEditorContent /></KnowledgeViews>;
const Characters: Component = () => <KnowledgeViews><CharacterGridContent /></KnowledgeViews>;
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
  <Route path="/knowledge/characters" component={Characters} />
  <Route path="/progress" component={StatisticsContent} /><Route path="/settings" component={requested(Settings)} />
  <Route path="/flashcards" component={requested(Review)} /><Route path="/level-study" component={requested(Plan)} />
  <Route path="/conversation-agent" component={requested(Messenger)} /><Route path="/word-db-editor" component={Knowledge} />
  <Route path="/statistics" component={StatisticsContent} />
  <Route path="/licenses" component={LicensesRoute} />
</>;
