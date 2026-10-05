// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { HashRouter } from '@solidjs/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ listener: undefined as ((context: Record<string, unknown>) => void) | undefined, unsubscribe: vi.fn(), mounted: vi.fn(), savedReturn: {} as Record<string, unknown>, mobile: true }));
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }), useSettings: () => ({ settings: { language: 'package-x' }, isLoading: () => false }) }));
vi.mock('../../context/WindowWrapper', () => ({ LibraryLoadGuard: (props: { recoveryAccess?: boolean }) => <span data-testid="guard" data-recovery={String(props.recoveryAccess)} /> }));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ window: {
  onWindowContext: (listener: typeof fixture.listener) => { fixture.listener = listener; return fixture.unsubscribe; }, getWindowContext: vi.fn(),
} }) }));
vi.mock('../../../shared/platform', () => ({ isElectron: () => !fixture.mobile, isMobile: () => fixture.mobile }));
vi.mock('./components/LoadingOverlay', () => ({ LoadingOverlay: () => <span data-testid="backend-overlay" /> }));
vi.mock('../../components/common', () => ({ LearningWorkspace: (props: { children?: import('solid-js').JSX.Element }) => props.children, Button: (props: { children?: import('solid-js').JSX.Element; onClick?: () => void }) => <button onClick={props.onClick}>{props.children}</button> }));
vi.mock('../flashcards/App', () => ({ FlashcardsContent: (props: { initialTab?: string; onClose?: () => void }) => {
  fixture.mounted(props.initialTab ?? 'review'); return <div data-content={props.initialTab ?? 'review'}><button onClick={props.onClose}>Return</button></div>;
} }));
vi.mock('../conversationAgent/App', () => ({ ConversationContent: (props: { onReturn?: (source?: Record<string, unknown>) => void }) => <div data-content="messenger"><button onClick={() => props.onReturn?.(fixture.savedReturn)}>Return</button></div> }));
vi.mock('../levelStudy/App', () => ({ LevelStudyContent: (props: { workspace?: string }) => <div data-content={props.workspace ?? "plan"} /> }));
vi.mock('../wordSync/App', () => ({ WordSyncContent: (props: { mode?: string; intent?: string; words?: readonly string[]; encounterLimit?: number; onClose?: (context: Record<string, unknown>) => void }) => <div data-content={props.mode === 'assessment' ? 'assessment' : 'words'} data-intent={props.intent} data-words={JSON.stringify(props.words)} data-limit={props.encounterLimit}><button onClick={() => props.onClose?.(fixture.savedReturn)}>Return</button></div> }));
vi.mock('../characterGrid/App', () => ({ CharacterGridContent: () => <div data-content="characters" /> }));
vi.mock('../wordDbEditor/App', () => ({ WordDbEditorContent: () => <div data-content="knowledge" /> }));
vi.mock('../statistics/App', () => ({ StatisticsContent: () => <div data-content="progress" /> }));
vi.mock('../settings/SettingsWindow', () => ({ SettingsContent: () => <div data-content="settings" /> }));
vi.mock('../settings/MobileSettingsView', () => ({ MobileSettingsView: () => <div data-content="mobile-settings" /> }));
vi.mock('./routes/WelcomeRoute', () => ({ WelcomeRoute: () => <div data-content="home" /> }));
vi.mock('./routes/ReaderRoute', () => ({ ReaderRoute: () => <div data-content="reader" /> }));
vi.mock('./routes/VideoRoute', () => ({ VideoRoute: () => <div data-content="video" /> }));
import { ApplicationShell } from './ApplicationShell';
import { ApplicationRoutes } from './ApplicationRoutes';

describe('application shell route ownership', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  beforeEach(() => { vi.clearAllMocks(); fixture.savedReturn = {}; fixture.mobile = true; sessionStorage.clear(); window.history.replaceState(null, '', '#/'); container = document.createElement('div'); document.body.append(container); });
  afterEach(() => { dispose?.(); container.remove(); window.history.replaceState(null, '', '#/'); });
  const mount = () => { dispose = render(() => <HashRouter root={ApplicationShell}><ApplicationRoutes /></HashRouter>, container); };
  let routeRequest = 0;
  const navigate = async (path: string) => {
    fixture.listener!({ applicationNavigation: { path, requestId: `test-${++routeRequest}` } });
    await vi.waitFor(() => expect(window.location.hash).toBe(`#${path}`));
  };
  it('uses local purpose/utility navigation and mounts one active content owner', async () => {
    mount();
    expect(container.querySelector('nav')).toBeNull();
    for (const [path, content] of [['/reader', 'reader'], ['/video', 'video'], ['/messenger', 'messenger'], ['/practise', 'review'], ['/plan', 'plan']]) {
      await navigate(path);
      expect(container.querySelector(`[data-content="${content}"]`)).not.toBeNull();
      expect(container.querySelectorAll('[data-content]')).toHaveLength(1);
      const count = container.querySelectorAll('nav button').length;
      expect(count).toBe(path === '/practise' ? 3 : path === '/plan' ? 4 : 1);
    }
  });
  it('Main desktop has no sitemap above an immersion activity', async () => {
    fixture.mobile = false; mount(); await navigate('/reader');
    expect(container.querySelector('nav')).toBeNull();
    expect(container.querySelectorAll('[data-content]')).toHaveLength(1);
  });
  it.each([['plan', '/plan'], ['material', '/knowledge/material'], ['home', '/']])('returns Review to its %s source', async (returnTo, path) => {
    mount();
    fixture.listener!({ applicationNavigation: { path: '/practise', requestId: 'return-source', context: { returnTo } } });
    await vi.waitFor(() => expect(container.querySelector('[data-content="review"]')).not.toBeNull());
    container.querySelector<HTMLButtonElement>('[data-content="review"] button')!.click();
    await vi.waitFor(() => expect(window.location.hash).toBe(`#${path}`));
  });
  it('returns a targeted mock discussion to the saved mock results owner', async () => {
    mount();
    fixture.savedReturn = { workspace: 'video', path: '/videos/older-conversation.mp4', time: 99 };
    fixture.listener!({ applicationNavigation: { path: '/messenger', requestId: 'mock-discussion', context: { returnTo: 'mock' } } });
    await vi.waitFor(() => expect(container.querySelector('[data-content="messenger"]')).not.toBeNull());
    container.querySelector<HTMLButtonElement>('[data-content="messenger"] button')!.click();
    await vi.waitFor(() => expect(window.location.hash).toBe('#/evaluate/grammar/mock'));
    expect(container.querySelector('[data-content="mock"]')).not.toBeNull();
  });
  it.each([{}, { workspace: 'reader', path: '/books/older.epub', page: 99 }])('retains the explicit media Return after preparation cancellation or an older chat source', async savedSource => {
    mount();
    fixture.savedReturn = savedSource;
    fixture.listener!({ applicationNavigation: { path: '/messenger', requestId: 'media-preparation', context: {
      returnTo: 'video', sourceContext: { workspace: 'video', path: '/videos/current.mp4', time: 10, subtitlePath: '/videos/current.srt' },
    } } });
    await vi.waitFor(() => expect(container.querySelector('[data-content="messenger"]')).not.toBeNull());
    container.querySelector<HTMLButtonElement>('[data-content="messenger"] button')!.click();
    await vi.waitFor(() => expect(window.location.hash).toBe('#/video'));
    expect(sessionStorage.getItem('mlearn_open_video_subtitles')).toBe('/videos/current.srt');
  });
  it('mounts a deliberate new request on the same route and releases the navigation listener', async () => {
    window.history.replaceState(null, '', '#/practise'); mount();
    expect(fixture.mounted).toHaveBeenCalledTimes(1);
    fixture.listener!({ applicationNavigation: { path: '/practise', requestId: 'first' } });
    await vi.waitFor(() => expect(fixture.mounted).toHaveBeenCalledTimes(2));
    fixture.listener!({ applicationNavigation: { path: '/practise', requestId: 'second' } });
    await vi.waitFor(() => expect(fixture.mounted).toHaveBeenCalledTimes(3));
    expect(container.querySelectorAll('[data-content="review"]')).toHaveLength(1);
    dispose(); expect(fixture.unsubscribe).toHaveBeenCalledOnce();
  });
  it('opens an explicit scoped word task directly, including a repeated request on that route', async () => {
    mount();
    fixture.listener!({ applicationNavigation: { path: '/practise/words', requestId: 'material-first', context: {
      activity: 'reinforce', material: { language: 'package-x', label: 'Chapter', words: ['one', 'two'] },
      session: { encounterLimit: 7, requestId: 'selection-first' }, returnTo: 'material',
    } } });
    await vi.waitFor(() => expect(container.querySelector('[data-content="words"]')).not.toBeNull());
    expect(container.querySelector('[data-content="plan"]')).toBeNull();
    expect(container.querySelector('[data-content="words"]')?.getAttribute('data-words')).toBe('["one","two"]');
    expect(container.querySelector('[data-content="words"]')?.getAttribute('data-intent')).toBe('reinforce');
    expect(container.querySelector('[data-content="words"]')?.getAttribute('data-limit')).toBe('7');
    fixture.listener!({ applicationNavigation: { path: '/practise/words', requestId: 'open-second', context: {} } });
    await vi.waitFor(() => expect(container.querySelector('[data-content="words"]')?.getAttribute('data-words')).toBeNull());
    expect(container.querySelector('[data-content="words"]')?.getAttribute('data-intent')).toBeNull();
  });
  it('refuses a stale source-language selection rather than practising unrelated words', async () => {
    mount(); fixture.listener!({ applicationNavigation: { path: '/practise/words', requestId: 'wrong-language', context: {
      activity: 'practice', material: { language: 'other', label: 'Chapter', words: ['one'] },
    } } });
    await vi.waitFor(() => expect(container.textContent).toContain('mlearn.Goals.Unavailable'));
    expect(container.querySelector('[data-content="words"]')).toBeNull();
  });
  it.each([['/practise/grammar', 'grammar'], ['/evaluate/grammar', 'grammar-check'], ['/evaluate/grammar/mock', 'mock']])('hosts %s separately from passive Plan', async (path, content) => {
    window.history.replaceState(null, '', `#${path}`); mount();
    await vi.waitFor(() => expect(container.querySelector(`[data-content="${content}"]`)).not.toBeNull());
    expect(container.querySelector('[data-content="plan"]')).toBeNull();
  });
  it('keeps Settings free of backend and library blocking overlays', async () => {
    fixture.mobile = false; mount(); await navigate('/settings');
    expect(container.querySelector('[data-content="settings"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="backend-overlay"]')).toBeNull();
    expect(container.querySelector('[data-testid="guard"]')?.getAttribute('data-recovery')).toBe('true');
  });
  it('uses the mobile Settings owner while retaining shared recovery access and navigation cleanup', async () => {
    fixture.mobile = true;
    mount(); await navigate('/settings');
    expect(container.querySelector('[data-content="mobile-settings"]')).not.toBeNull();
    expect(container.querySelector('[data-content="settings"]')).toBeNull();
    expect(container.querySelectorAll('[data-content]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="backend-overlay"]')).toBeNull();
    expect(container.querySelector('[data-testid="guard"]')?.getAttribute('data-recovery')).toBe('true');
    await navigate('/practise');
    expect(container.querySelector('[data-content="review"]')).not.toBeNull();
    expect(container.querySelector('[data-content="mobile-settings"]')).toBeNull();
    dispose(); expect(fixture.unsubscribe).toHaveBeenCalledOnce();
  });
  it('Return from an embedded review navigates Home rather than closing the application', async () => {
    window.history.replaceState(null, '', '#/practise'); mount(); container.querySelector<HTMLButtonElement>('[data-content="review"] button')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-content="home"]')).not.toBeNull());
  });
  it('returns a resumed word task to its saved source rather than conflicting launch metadata', async () => {
    mount();
    fixture.savedReturn = { returnTo: 'reader', sourceContext: { workspace: 'reader', path: '/books/original.epub', page: 17, 'package:position': { value: 4 } } };
    fixture.listener!({ applicationNavigation: { path: '/practise/words', requestId: 'resume-source', context: {
      intent: 'resume', sessionId: 'saved-task', returnTo: 'video', sourceContext: { workspace: 'video', path: '/videos/conflicting.mp4', time: 99 },
    } } });
    await vi.waitFor(() => expect(container.querySelector('[data-content="words"]')).not.toBeNull());
    container.querySelector<HTMLButtonElement>('[data-content="words"] button')!.click();
    await vi.waitFor(() => expect(window.location.hash).toBe('#/reader'));
    expect(sessionStorage.getItem('mlearn_open_book')).toBe('/books/original.epub');
    expect(JSON.parse(sessionStorage.getItem('mlearn_media_return')!)).toEqual(fixture.savedReturn.sourceContext);
    expect(sessionStorage.getItem('mlearn_open_video')).toBeNull();
  });
});
