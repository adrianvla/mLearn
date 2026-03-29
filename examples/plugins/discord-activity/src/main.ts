type HostApi = {
  kvGet: (key: string) => Promise<string | null>;
  kvSet: (key: string, value: string) => Promise<void>;
  kvRemove: (key: string) => Promise<void>;
  closeWindow: () => void;
};

type PluginComponentProps = {
  context: Record<string, unknown>;
  host: HostApi;
};

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function activate(): void {
  console.log('[discord-activity] ready');
}

export async function openDiscordActivityPanel(
  pluginOpenWindow: (payload: { pluginId: string; context?: Record<string, unknown> }) => Promise<boolean>,
  activityName: string,
): Promise<boolean> {
  return pluginOpenWindow({
    pluginId: 'discord-activity',
    context: {
      activityName,
      launchedAt: new Date().toISOString(),
    },
  });
}

export default function DiscordActivityPanel(props: PluginComponentProps) {
  const root = document.createElement('section');
  const title = document.createElement('h2');
  const subtitle = document.createElement('p');
  const textarea = document.createElement('textarea');
  const actions = document.createElement('div');
  const saveButton = document.createElement('button');
  const resetButton = document.createElement('button');
  const closeButton = document.createElement('button');
  const status = document.createElement('p');

  root.style.display = 'grid';
  root.style.gap = '12px';
  root.style.padding = '16px';

  title.textContent = readString(props.context.activityName, 'Discord study session');
  subtitle.textContent = 'Component UI loaded through plugin-ui:// inside the plugin-host window.';

  textarea.rows = 6;
  textarea.placeholder = 'What are you studying right now?';

  actions.style.display = 'flex';
  actions.style.gap = '8px';

  saveButton.type = 'button';
  saveButton.textContent = 'Save draft';

  resetButton.type = 'button';
  resetButton.textContent = 'Clear draft';

  closeButton.type = 'button';
  closeButton.textContent = 'Close';

  status.textContent = 'Loading saved draft...';

  void props.host.kvGet('discord-activity:draft').then((savedDraft) => {
    if (savedDraft) {
      textarea.value = savedDraft;
      status.textContent = 'Loaded saved draft from plugin KV storage.';
      return;
    }

    status.textContent = 'No saved draft yet.';
  });

  saveButton.addEventListener('click', () => {
    void props.host.kvSet('discord-activity:draft', textarea.value).then(() => {
      status.textContent = 'Draft saved.';
    });
  });

  resetButton.addEventListener('click', () => {
    textarea.value = '';
    void props.host.kvRemove('discord-activity:draft').then(() => {
      status.textContent = 'Draft cleared.';
    });
  });

  closeButton.addEventListener('click', () => {
    props.host.closeWindow();
  });

  actions.append(saveButton, resetButton, closeButton);
  root.append(title, subtitle, textarea, actions, status);
  return root;
}
