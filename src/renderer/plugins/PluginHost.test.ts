// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

const mockPluginKVGet = vi.fn<(pluginId: string, key: string) => Promise<{ value: string | null }>>();
const mockPluginKVSet = vi.fn<(pluginId: string, key: string, value: string) => Promise<void>>();
const mockPluginKVRemove = vi.fn<(pluginId: string, key: string) => Promise<void>>();
const mockCloseWindow = vi.fn<() => void>();
const mockTranslate = vi.fn();

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    plugins: {
      pluginKVGet: mockPluginKVGet,
      pluginKVSet: mockPluginKVSet,
      pluginKVRemove: mockPluginKVRemove,
    },
    window: {
      closeWindow: mockCloseWindow,
    },
  }),
}));

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({
    translate: mockTranslate,
  }),
}));

async function waitFor(check: () => boolean, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition was not met in time');
}

describe('PluginHost', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockPluginKVGet.mockReset();
    mockPluginKVSet.mockReset();
    mockPluginKVRemove.mockReset();
    mockCloseWindow.mockReset();
    mockTranslate.mockReset();
  });

  afterEach(() => {
    container.remove();
  });

  it('renders schema UI with runtime context taking precedence over initial data', async () => {
    const { PluginHost } = await import('./PluginHost');
    mockPluginKVGet.mockResolvedValue({ value: null });

    render(() => PluginHost({
      hostContext: {
        pluginId: 'demo.plugin',
        pluginName: 'Demo Plugin',
        initialContext: { word: 'neko' },
        ui: {
          type: 'schema',
          schema: {
            title: 'Inspector',
            type: 'object',
            properties: {
              word: { type: 'string', title: 'Word' },
            },
          },
          initialData: { word: 'inu' },
        },
      },
    }), container);

    expect(container.textContent).toContain('Inspector');
    expect(container.textContent).toContain('Word');
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('neko');
    expect(container.textContent).not.toContain('inu');
  });

  it('hydrates schema UI from plugin kv and persists edits back to plugin kv', async () => {
    const { PluginHost } = await import('./PluginHost');

    mockPluginKVGet.mockResolvedValue({ value: JSON.stringify({ word: 'stored', retries: 9, enabled: true }) });

    render(() => PluginHost({
      hostContext: {
        pluginId: 'demo.plugin',
        pluginName: 'Demo Plugin',
        initialContext: { word: 'context' },
        ui: {
          type: 'schema',
          schema: {
            title: 'Editor',
            type: 'object',
            properties: {
              word: { type: 'string', title: 'Word' },
              retries: { type: 'number', title: 'Retries' },
              enabled: { type: 'boolean', title: 'Enabled' },
            },
          },
          initialData: { word: 'initial', retries: 2, enabled: false },
        },
      },
    }), container);

    expect(mockPluginKVGet).toHaveBeenCalledWith('demo.plugin', 'plugin-host:schema-state');

    await waitFor(() => {
      const textInput = container.querySelector('input[type="text"]') as HTMLInputElement | null;
      return textInput?.value === 'stored';
    });

    const textInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(textInput.value).toBe('stored');
    expect(numberInput.value).toBe('9');
    expect(checkbox.checked).toBe(true);

    textInput.value = 'edited';
    textInput.dispatchEvent(new Event('input', { bubbles: true }));

    await waitFor(() => mockPluginKVSet.mock.calls.length > 0);

    expect(mockPluginKVGet).toHaveBeenCalledWith('demo.plugin', 'plugin-host:schema-state');
    expect(mockPluginKVSet).toHaveBeenCalledWith(
      'demo.plugin',
      'plugin-host:schema-state',
      JSON.stringify({ word: 'edited', retries: 9, enabled: true }),
    );
  });

  it('loads component UI modules and passes plugin helpers', async () => {
    const { PluginHost } = await import('./PluginHost');

    mockPluginKVGet.mockResolvedValue({ value: 'stored-value' });

    const observed: Array<unknown> = [];

    render(() => PluginHost({
      hostContext: {
        pluginId: 'demo.plugin',
        pluginName: 'Demo Plugin',
        initialContext: { word: 'neko' },
        ui: {
          type: 'component',
          componentPath: 'dist/window.js',
          componentUrl: 'plugin-ui:///plugins/demo.plugin/dist/window.js',
        },
      },
      loadComponent: async () => (props: {
        context: Record<string, unknown>;
        host: {
          kvGet: (key: string) => Promise<string | null>;
          kvSet: (key: string, value: string) => Promise<void>;
          kvRemove: (key: string) => Promise<void>;
          closeWindow: () => void;
        };
      }) => {
        observed.push(props);
        void props.host.kvGet('word');
        void props.host.kvSet('word', 'inu');
        void props.host.kvRemove('word');
        props.host.closeWindow();
        return `Component UI ${String(props.context.word)}`;
      },
    }), container);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Component UI neko');
    expect(observed).toHaveLength(1);
    expect(mockPluginKVGet).toHaveBeenCalledWith('demo.plugin', 'word');
    expect(mockPluginKVSet).toHaveBeenCalledWith('demo.plugin', 'word', 'inu');
    expect(mockPluginKVRemove).toHaveBeenCalledWith('demo.plugin', 'word');
    expect(mockCloseWindow).toHaveBeenCalledOnce();
  });

  it('scopes plugin translation helper to the host language and dictionary target', async () => {
    const { PluginHost } = await import('./PluginHost');
    mockTranslate.mockResolvedValue({ data: [{ definitions: 'cat' }] });

    render(() => PluginHost({
      hostContext: {
        pluginId: 'demo.plugin',
        pluginName: 'Demo Plugin',
        initialContext: {
          __mlearnLanguage: 'ja',
          __mlearnDictionaryTargetLanguage: 'fr',
        },
        ui: {
          type: 'component',
          componentPath: 'dist/window.js',
          componentUrl: 'plugin-ui:///plugins/demo.plugin/dist/window.js',
        },
      },
      loadComponent: async () => (props: {
        host: {
          translate: (word: string) => Promise<unknown>;
        };
      }) => {
        void props.host.translate('猫');
        return 'Translator';
      },
    }), container);

    await waitFor(() => mockTranslate.mock.calls.length > 0);

    expect(mockTranslate).toHaveBeenCalledWith('猫', 'ja', { dictionaryTargetLanguage: 'fr' });
  });

  it('shows an alert when a plugin component throws during render', async () => {
    const { PluginHost } = await import('./PluginHost');

    render(() => PluginHost({
      hostContext: {
        pluginId: 'demo.plugin',
        pluginName: 'Demo Plugin',
        ui: {
          type: 'component',
          componentPath: 'dist/window.js',
          componentUrl: 'plugin-ui:///plugins/demo.plugin/dist/window.js',
        },
      },
      loadComponent: async () => () => {
        throw new Error('Boom');
      },
    }), container);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain('Demo Plugin');
    expect(alert?.textContent).toContain('Boom');
  });
});
