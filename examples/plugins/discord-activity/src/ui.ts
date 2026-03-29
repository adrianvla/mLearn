import { loadDiscordActivityConfig } from './runtime';

type HostApi = {
  kvGet: (key: string) => Promise<string | null>;
  kvSet: (key: string, value: string) => Promise<void>;
  closeWindow: () => void;
};

type PluginComponentProps = {
  context: Record<string, unknown>;
  host: HostApi;
};

type RuntimeStatus = {
  connected: boolean;
  lastError: string;
};

const SAVE_MESSAGE = 'Saved. Disable and re-enable the plugin to apply Discord changes.';

function readRuntimeStatus(value: string | null): RuntimeStatus {
  if (!value) {
    return {
      connected: false,
      lastError: '',
    };
  }

  try {
    const parsed = JSON.parse(value) as Partial<RuntimeStatus>;
    return {
      connected: parsed.connected === true,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : '',
    };
  } catch {
    return {
      connected: false,
      lastError: 'Unable to read Discord runtime status.',
    };
  }
}

export default function DiscordActivityPanel(props: PluginComponentProps): HTMLElement {
  const root = document.createElement('section');
  const heading = document.createElement('h2');
  const intro = document.createElement('p');
  const activityDescription = document.createElement('p');
  const activityList = document.createElement('ul');
  const form = document.createElement('form');
  const enabledLabel = document.createElement('label');
  const enabledInput = document.createElement('input');
  const showTimestampLabel = document.createElement('label');
  const showTimestampInput = document.createElement('input');
  const status = document.createElement('p');
  const runtimeStatus = document.createElement('p');
  const errorStatus = document.createElement('p');
  const saveButton = document.createElement('button');

  root.style.display = 'grid';
  root.style.gap = '12px';
  root.style.padding = '16px';

  form.style.display = 'grid';
  form.style.gap = '12px';

  heading.textContent = 'Discord Rich Presence';
  intro.textContent = 'Control the automatic live activity shown by the example Discord plugin.';
  activityDescription.textContent = 'The plugin publishes automatic live activity based on what you are doing in mLearn:';
  activityList.innerHTML = [
    '<li>Idle: Using mLearn / Idling</li>',
    '<li>Reader: Reading on mLearn / Reading page x/y of {work name}</li>',
    '<li>Video: Watching on mLearn / {current time}/{duration} - {work name}</li>',
    '<li>Flashcards: Using mLearn / Reviewing Flashcards</li>',
  ].join('');

  enabledLabel.textContent = 'Enable Discord activity';
  enabledInput.type = 'checkbox';
  enabledInput.name = 'enabled';
  enabledLabel.append(document.createTextNode(' '), enabledInput);

  showTimestampLabel.textContent = 'Show timestamp';
  showTimestampInput.type = 'checkbox';
  showTimestampInput.name = 'showTimestamp';
  showTimestampLabel.append(document.createTextNode(' '), showTimestampInput);

  saveButton.type = 'submit';
  saveButton.textContent = 'Save';

  status.textContent = 'Loading Discord activity settings...';
  runtimeStatus.textContent = 'Runtime status: Disconnected';

  void (async () => {
    const [config, runtimeStatusValue] = await Promise.all([
      loadDiscordActivityConfig({
        get: (key: string) => props.host.kvGet(key),
        set: async () => {
          throw new Error('Config loading does not write to storage');
        },
      }),
      props.host.kvGet('discord-activity:runtime-status'),
    ]);

    enabledInput.checked = config.enabled;
    showTimestampInput.checked = config.showTimestamp;

    const currentStatus = readRuntimeStatus(runtimeStatusValue);
    runtimeStatus.textContent = currentStatus.connected
      ? 'Runtime status: Connected'
      : 'Runtime status: Disconnected';
    errorStatus.textContent = currentStatus.lastError ? `Last error: ${currentStatus.lastError}` : '';
    status.textContent = 'Ready to save Discord activity settings.';
  })();

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    void (async () => {
      await props.host.kvSet('discord-activity:enabled', String(enabledInput.checked));
      await props.host.kvSet('discord-activity:showTimestamp', String(showTimestampInput.checked));

      status.textContent = SAVE_MESSAGE;
      props.host.closeWindow();
    })();
  });

  form.append(enabledLabel, showTimestampLabel, saveButton);
  root.append(heading, intro, activityDescription, activityList, form, runtimeStatus, errorStatus, status);
  return root;
}
