import { Component, createSignal, JSX, onMount } from 'solid-js';
import { A } from '@solidjs/router';
import { ThemeToggle } from './components';
import './Layout.css';

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview' },
  { href: '/services', label: 'Services' },
  { href: '/logs', label: 'Logs' },
  { href: '/config', label: 'Config' },
  { href: '/storage', label: 'Storage' },
  { href: '/ai-status', label: 'AI Status' },
  { href: '/school', label: 'School' },
];

const TOKEN_KEY = 'mlearn_admin_token';

const Layout: Component<{ children: JSX.Element }> = (props) => {
  const [token, setToken] = createSignal('');

  onMount(() => {
    try {
      setToken(window.localStorage.getItem(TOKEN_KEY) ?? '');
    } catch {
      setToken('');
    }
  });

  const commitToken = (value: string): void => {
    setToken(value);
    try {
      window.localStorage.setItem(TOKEN_KEY, value);
    } catch {
      return;
    }
  };

  return (
    <div class="layout">
      <aside class="layout__sidebar">
        <div class="layout__brand">mLearn</div>
        <nav class="layout__nav">
          {NAV_ITEMS.map((item) => (
            <A
              href={item.href}
              class="layout__nav-link"
              activeClass="layout__nav-link--active"
              end
            >
              {item.label}
            </A>
          ))}
        </nav>
        <div class="layout__sidebar-footer">
          <input
            class="layout__token-input"
            type="password"
            placeholder="Admin token"
            value={token()}
            onChange={(e) => commitToken(e.currentTarget.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                commitToken(e.currentTarget.value);
              }
            }}
          />
          <ThemeToggle />
        </div>
      </aside>
      <main class="layout__main">{props.children}</main>
    </div>
  );
};

export default Layout;
