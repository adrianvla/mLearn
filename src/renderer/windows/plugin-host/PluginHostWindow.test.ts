// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { WINDOW_TYPES } from '../../../shared/constants';

const mockGetWindowContext = vi.fn<(windowType: string) => void>();
const mockOnWindowContext = vi.fn<(callback: (context: Record<string, unknown> | null) => void) => (() => void)>();
const mockPluginKVGet = vi.fn<(pluginId: string, key: string) => Promise<{ value: string | null }>>();

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children: unknown }) => props.children,
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    plugins: {
      pluginKVGet: mockPluginKVGet,
      pluginKVSet: vi.fn(),
      pluginKVRemove: vi.fn(),
    },
    window: {
      getWindowContext: mockGetWindowContext,
      onWindowContext: mockOnWindowContext,
      closeWindow: vi.fn(),
    },
  }),
}));

describe('PluginHostWindow', () => {
  let container: HTMLDivElement;
  let emitContext: ((context: Record<string, unknown> | null) => void) | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    emitContext = undefined;
    mockGetWindowContext.mockReset();
    mockOnWindowContext.mockReset();
    mockPluginKVGet.mockReset();
    mockPluginKVGet.mockResolvedValue({ value: null });
    mockOnWindowContext.mockImplementation((callback) => {
      emitContext = callback;
      return () => undefined;
    });
  });

  afterEach(() => {
    container.remove();
  });

  it('requests plugin-host context on mount and renders the plugin UI when context arrives', async () => {
    const { PluginHostWindow } = await import('./PluginHostWindow');

    render(() => PluginHostWindow({}), container);

    expect(mockGetWindowContext).toHaveBeenCalledWith(WINDOW_TYPES.PLUGIN_HOST);
    expect(container.textContent).toContain('Loading plugin UI');

    emitContext?.({
      pluginId: 'demo.plugin',
      pluginName: 'Demo Plugin',
      initialContext: { word: 'neko' },
      ui: {
        type: 'schema',
        schema: {
          title: 'Schema UI',
          type: 'object',
          properties: {
            word: { type: 'string', title: 'Word' },
          },
        },
      },
    });

    await Promise.resolve();

    expect(container.textContent).toContain('Demo Plugin');
    expect(container.textContent).toContain('Schema UI');
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('neko');
  });
});
