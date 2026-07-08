import { Component, createSignal, onMount, Show, JSX } from 'solid-js';

const THEME_KEY = 'mlearn_theme';

type ThemeMode = 'light' | 'dark';

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
  } catch {
    stored = null;
  }
  if (stored === 'dark' || stored === 'light') return stored;
  const attr = document.documentElement.dataset.theme;
  return attr === 'dark' ? 'dark' : 'light';
}

function persistTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    return;
  }
}

export const ThemeToggle: Component = () => {
  const [theme, setTheme] = createSignal<ThemeMode>('light');

  onMount(() => {
    const initial = readInitialTheme();
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  });

  const toggle = (): void => {
    const next: ThemeMode = theme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    persistTheme(next);
  };

  const targetLabel = (): string => (theme() === 'dark' ? 'light' : 'dark');

  const buttonStyle: JSX.CSSProperties = {
    display: 'inline-flex',
    'align-items': 'center',
    'justify-content': 'center',
    width: '36px',
    height: '36px',
    padding: '0',
    background: 'transparent',
    border: '1px solid var(--border-color)',
    'border-radius': 'var(--radius-md)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    'transition-property': 'color, background-color, border-color',
    'transition-duration': 'var(--transition-fast)',
  };

  return (
    <button
      type="button"
      class="mlearn-theme-toggle"
      style={buttonStyle}
      onClick={toggle}
      aria-label={`Switch to ${targetLabel()} theme`}
      title={`Switch to ${targetLabel()} theme`}
    >
      <Show
        when={theme() === 'dark'}
        fallback={
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            role="presentation"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        }
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          role="presentation"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      </Show>
    </button>
  );
};
