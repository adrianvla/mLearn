import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button, Input, Chip } from '@heroui/react';
import {
  Activity,
  BarChart3,
  Boxes,
  Cloud,
  FileText,
  Gauge,
  HardDrive,
  Lock,
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

export default function Layout() {
  const [token, setToken] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);

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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-64 flex-col border-r border-default-200 bg-content1">
        <div className="flex h-16 items-center gap-2 border-b border-default-200 px-6">
          <Lock className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold text-foreground">mLearn</span>
          <Chip size="sm" color="primary" variant="flat">Admin</Chip>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-default-400">
                {group.label}
              </p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-default-600 hover:bg-default-100 hover:text-default-900'
                    }`
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-default-200 p-4">
          {tokenSaved ? (
            <div className="flex items-center justify-between">
              <Chip size="sm" color="success" variant="flat" startContent={<Shield className="h-3 w-3" />}>
                Token set
              </Chip>
              <Button
                size="sm"
                variant="light"
                color="danger"
                onPress={() => {
                  localStorage.removeItem(TOKEN_KEY);
                  setToken('');
                  setTokenSaved(false);
                  window.location.reload();
                }}
              >
                Clear
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                size="sm"
                type="password"
                placeholder="Admin token"
                value={token}
                onValueChange={setToken}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveToken();
                }}
              />
              <Button size="sm" color="primary" className="w-full" onPress={handleSaveToken}>
                Authenticate
              </Button>
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
