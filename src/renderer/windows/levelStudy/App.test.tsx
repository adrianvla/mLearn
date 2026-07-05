// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

let currentLangDataMock: Record<string, unknown> = {};
const localizationMock = vi.fn((key: string) => key);

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useLanguage: () => ({
    currentLangData: () => currentLangDataMock,
  }),
  useLocalization: () => ({
    t: localizationMock,
  }),
}));

vi.mock('../../components/common', () => ({
  TabContainer: (props: {
    tabs: Array<{ id: string; label: string; icon?: JSX.Element }>;
    activeTab: string;
    onTabChange: (tabId: string) => void;
    children?: JSX.Element;
  }) => (
    <div>
      <div role="tablist">
        {props.tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.activeTab === tab.id}
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {props.children}
    </div>
  ),
  TabPanel: (props: { tabId: string; activeTab: string; children?: JSX.Element }) => (
    <>{props.tabId === props.activeTab ? props.children : null}</>
  ),
  TargetIcon: () => <span />,
  BookIcon: () => <span />,
  GridIcon: () => <span />,
  SparklesIcon: () => <span />,
}));

vi.mock('../wordSync/App', () => ({
  WordSyncContent: () => <div>Word Sync Content</div>,
}));

vi.mock('../characterGrid/App', () => ({
  CharacterGridContent: () => <div>Character Grid Content</div>,
}));

vi.mock('./LevelStudyTab', () => ({
  LevelStudyTab: () => <div>Level Study Content</div>,
}));

describe('LevelStudyContent', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    currentLangDataMock = {};
    localizationMock.mockImplementation((key: string) => {
      switch (key) {
        case 'mlearn.LevelStudy.Title':
          return 'Level Study';
        case 'mlearn.LevelStudy.Tabs.WordSync':
          return 'Word Sync';
        case 'mlearn.LevelStudy.Tabs.CharacterGrid':
          return 'Character Grid';
        case 'mlearn.LevelStudy.Tabs.LevelStudy':
          return 'Level Study';
        default:
          return key;
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    container.remove();
  });

  it('shows the character grid tab when language metadata enables character study scripts', async () => {
    currentLangDataMock = {
            characterStudy: { scripts: ['Arab'] },
    };

    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent />, container);

    expect(container.textContent).toContain('Word Sync');
    expect(container.textContent).toContain('Character Grid');
    expect(container.textContent).toContain('Level Study');

    dispose();
  });

  it('hides the character grid tab when language metadata disables character study', async () => {
    currentLangDataMock = {
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
      characterStudy: { enabled: false, scripts: ['Latn'] },
    };

    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent />, container);

    expect(container.textContent).toContain('Word Sync');
    expect(container.textContent).not.toContain('Character Grid');
    expect(container.textContent).toContain('Level Study');

    dispose();
  });
});
