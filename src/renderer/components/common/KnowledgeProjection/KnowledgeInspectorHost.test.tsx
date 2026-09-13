// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import type { KnowledgeProjectionDrawerProps } from './KnowledgeProjection';
import { KnowledgeInspectorHost } from './KnowledgeInspectorHost';
import { closeKnowledgeInspector, knowledgeInspection, openKnowledgeInspector } from '../../../services/openKnowledgeInspector';
import { hashWordSync } from '../../../services/srsAlgorithm';

const mocks = vi.hoisted(() => ({
  projection: vi.fn(), history: vi.fn(), wordClaim: vi.fn(), accessClaim: vi.fn(), clearClaim: vi.fn(),
  summary: vi.fn(), graph: vi.fn(),
}));
let version = () => 0;
let drawer: KnowledgeProjectionDrawerProps | undefined;
vi.mock('../../../../shared/bridges', () => ({ getBridge: () => ({ graph: { getKnowledgeProjection: mocks.projection } }) }));
vi.mock('../../../services/knowledgeEvents', () => ({ eventsVersion: () => version(), getEvents: mocks.history }));
vi.mock('../../../services/openGraphInspector', () => ({ openGraphInspector: mocks.graph }));
vi.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ settings: { easeThresholdLearning: 1.55, easeThresholdKnown: 1.8 } }) }));
vi.mock('../../../context/FlashcardContext', () => ({ useFlashcards: () => ({
  getComprehensiveWordStatusWithSourceSync: mocks.summary,
  setWordClaim: mocks.wordClaim, setAccessClaim: mocks.accessClaim, clearAccessClaim: mocks.clearClaim,
}) }));
vi.mock('./KnowledgeProjection', () => ({ KnowledgeProjectionDrawer: (props: KnowledgeProjectionDrawerProps) => {
  drawer = props;
  return <div data-testid="canonical-drawer">{props.target?.id}</div>;
} }));

let dispose: (() => void) | undefined;
let container: HTMLDivElement;
const payload: KnowledgeProjection = { status: 'ready', targets: [] };
beforeEach(() => {
  closeKnowledgeInspector();
  vi.clearAllMocks();
  drawer = undefined;
  version = () => 0;
  mocks.projection.mockResolvedValue(payload);
  mocks.history.mockResolvedValue([]);
  mocks.summary.mockReturnValue({ status: 'known', basis: 'evidence', timesSeen: 4 });
  container = document.createElement('div'); document.body.append(container);
});
afterEach(() => { dispose?.(); closeKnowledgeInspector(); container.remove(); });

describe('shared canonical inspector host', () => {
  it('queries only while open, preserves target identity, and scopes all claim callbacks', async () => {
    const [revision, setRevision] = createSignal(0);
    version = revision;
    dispose = render(() => <KnowledgeInspectorHost />, container);
    expect(mocks.projection).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="canonical-drawer"]')).toBeNull();

    const target = { kind: 'entry' as const, id: 'pkg:entry:stable-identity' };
    openKnowledgeInspector({ language: 'pkg', surface: 'alias', target });
    await vi.waitFor(() => expect(drawer?.model?.projection).toEqual(payload));
    expect(drawer?.target).toBe(target);
    expect(drawer?.language).toBe('pkg');
    expect(drawer?.surface).toBe('alias');
    expect(mocks.projection).toHaveBeenCalledExactlyOnceWith('pkg', 'alias', { learning: 1.55, known: 1.8 });
    expect(mocks.history).toHaveBeenCalledExactlyOnceWith([`pkg:${hashWordSync('alias')}`]);

    drawer?.onWordClaim?.('known');
    drawer?.onAccessClaim?.('x-package::novel', 'learning');
    drawer?.onAccessClaim?.('x-package::novel', null);
    expect(mocks.wordClaim).toHaveBeenCalledWith('alias', 'known', 'pkg');
    expect(mocks.accessClaim).toHaveBeenCalledWith('alias', 'x-package::novel', 'learning', 'pkg');
    expect(mocks.clearClaim).toHaveBeenCalledWith('alias', 'x-package::novel', 'pkg');

    setRevision(1);
    await vi.waitFor(() => expect(mocks.projection).toHaveBeenCalledTimes(2));
    expect(mocks.history).toHaveBeenCalledTimes(2);
    drawer?.onClose();
    expect(knowledgeInspection()).toBeUndefined();
    expect(container.querySelector('[data-testid="canonical-drawer"]')).toBeNull();
    setRevision(2);
    await Promise.resolve();
    expect(mocks.projection).toHaveBeenCalledTimes(2);
  });

  it('ignores late history for a previous target when the inspected identity changes', async () => {
    const currentHistory: [] = [];
    mocks.history.mockResolvedValue(currentHistory);
    let resolveOldHistory: (events: []) => void = () => undefined;
    mocks.history.mockImplementationOnce(() => new Promise<[]>((resolve) => { resolveOldHistory = resolve; }));
    dispose = render(() => <KnowledgeInspectorHost />, container);
    openKnowledgeInspector({ language: 'first', surface: 'same', target: { kind: 'entry', id: 'first-entry' } });
    await vi.waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(1));
    openKnowledgeInspector({ language: 'second', surface: 'same', target: { kind: 'entry', id: 'second-entry' } });
    await vi.waitFor(() => expect(drawer?.model?.events).toEqual([]));
    resolveOldHistory([]);
    await Promise.resolve();
    expect(drawer?.model.events).toBe(currentHistory);
    expect(drawer?.target?.id).toBe('second-entry');
    drawer?.onWordClaim?.('unknown');
    expect(mocks.wordClaim).toHaveBeenCalledWith('same', 'unknown', 'second');
    expect(mocks.summary).toHaveBeenLastCalledWith('same', 'second');
  });
});
