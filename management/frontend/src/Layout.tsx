import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button, Chip, Input, ScrollShadow, Separator, Tooltip } from '@heroui/react';
import appLogoUrl from '../../../src/html/assets/icons/logo.png';
import {
  Activity,
  BarChart3,
  Boxes,
  Cloud,
  FileText,
  Gauge,
  HardDrive,
  Lock,
  LogOut,
  Network,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Monitor',
    items: [
      { to: '/', label: 'Overview', icon: Gauge },
      { to: '/services', label: 'Services', icon: Activity },
      { to: '/logs', label: 'Logs', icon: FileText },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Configure',
    items: [
      { to: '/config', label: 'Configuration', icon: Settings },
      { to: '/storage', label: 'Storage', icon: HardDrive },
      { to: '/ai-status', label: 'AI Status', icon: Cloud },
      { to: '/llm-gateway', label: 'LLM Gateway', icon: Network },
    ],
  },
  {
    label: 'Deploy',
    items: [
      { to: '/school', label: 'School Deployment', icon: Shield },
      { to: '/users', label: 'Users', icon: Users },
      { to: '/distribution', label: 'Distribution', icon: Boxes },
    ],
  },
];

const TOKEN_KEY = 'mlearn_admin_token';

function NavButton({ item, isActive, onPress }: { item: NavItem; isActive: boolean; onPress: () => void }) {
  return (
    <Button
      fullWidth
      size="md"
      variant={isActive ? 'secondary' : 'ghost'}
      className="justify-start"
      onPress={onPress}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Button>
  );
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [navSearch, setNavSearch] = useState('');

  const selectedKey = NAV_GROUPS.flatMap((group) => group.items)
    .find((item) => item.to === location.pathname)?.to ?? '/';
  const currentItem = NAV_GROUPS.flatMap((group) => group.items)
    .find((item) => item.to === selectedKey);
  const filteredGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.label.toLowerCase().includes(navSearch.trim().toLowerCase()),
    ),
  })).filter((group) => group.items.length > 0);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      setToken(stored);
      setTokenSaved(true);
    }
  }, []);

  const handleSaveToken = () => {
    if (token.trim()) {
      localStorage.setItem(TOKEN_KEY, token.trim());
      setTokenSaved(true);
      window.location.reload();
    }
  };
  const handleClearToken = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setTokenSaved(false);
    window.location.reload();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-72 flex-col border-r border-border bg-background">
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <img
              src={appLogoUrl}
              alt="mLearn"
              className="h-12 w-12 shrink-0 object-contain"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-base font-semibold text-foreground">mLearn</span>
                <Chip size="sm" color="accent" variant="soft">Admin</Chip>
              </div>
              <p className="truncate text-sm text-muted">Management console</p>
            </div>
          </div>

          <Input
            variant="secondary"
            fullWidth
            placeholder="Search console"
            aria-label="Search console"
            value={navSearch}
            onChange={(event) => setNavSearch(event.currentTarget.value)}
          />
        </div>

        <Separator />

        <ScrollShadow className="flex-1 px-4 py-5" hideScrollBar>
          <nav className="space-y-7">
            {filteredGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  {group.label}
                </p>
                <div className="space-y-1.5">
                  {group.items.map((item) => (
                    <NavButton
                      key={item.to}
                      item={item}
                      isActive={item.to === selectedKey}
                      onPress={() => navigate(item.to)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </ScrollShadow>

        <Separator />

        <div className="p-4">
          <div className="mb-4 space-y-1.5">
            <Button fullWidth size="md" variant="ghost" className="justify-start" onPress={handleClearToken}>
              <LogOut className="h-4 w-4 shrink-0" />
              Log out
            </Button>
          </div>
          {tokenSaved ? (
            <div className="flex items-center justify-between gap-2">
              <Chip size="sm" color="success" variant="soft">
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="h-3 w-3" />
                  Authenticated
                </span>
              </Chip>
              <Tooltip>
                <Tooltip.Trigger>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={handleClearToken}
                  >
                    Clear
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Remove the saved admin token</Tooltip.Content>
              </Tooltip>
            </div>
          ) : (
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Lock className="h-4 w-4 text-accent" />
                  Admin token
                </div>
              <Input
                variant="secondary"
                fullWidth
                type="password"
                placeholder="Admin token"
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveToken();
                }}
              />
              <Button size="sm" variant="primary" fullWidth onPress={handleSaveToken} isDisabled={token.trim().length === 0}>
                Authenticate
              </Button>
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-2 text-sm text-muted">
            {currentItem && <currentItem.icon className="h-4 w-4" />}
            <span>{currentItem?.label ?? 'Management'}</span>
          </div>
          <div />
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </section>
    </div>
  );
}
