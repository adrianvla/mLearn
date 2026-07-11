import { BarChart3, Bot, Gauge, LogOut, MessageSquareText, Settings, ShieldCheck, Users, UsersRound, X, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import appLogoUrl from '../../../../src/html/assets/icons/logo.png';
import type { Capability } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useGroupScope } from '../groups/GroupScopeProvider';

interface NavigationItem { to: string; label: string; icon: LucideIcon; capability?: Capability }
const ITEMS: NavigationItem[] = [
  { to: '/', label: 'Dashboard', icon: Gauge },
  { to: '/users', label: 'Users', icon: Users, capability: 'members.view' },
  { to: '/groups', label: 'Groups', icon: UsersRound, capability: 'group.view' },
  { to: '/policies', label: 'Policies', icon: ShieldCheck, capability: 'policies.view' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, capability: 'analytics.view' },
  { to: '/conversations', label: 'Conversation Logs', icon: MessageSquareText, capability: 'conversations.view' },
  { to: '/llm-gateway', label: 'LLM Gateway', icon: Bot, capability: 'llm.configure' },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppSidebar({ mobileOpen = false, onNavigate }: { mobileOpen?: boolean; onNavigate?: () => void }) {
  const scope = useGroupScope();
  const auth = useAuth();
  const can = (capability?: Capability) => capability === undefined || (scope.status === 'ready' && scope.can(capability));
  return <aside className={`app-sidebar ${mobileOpen ? 'is-open' : ''}`}>
    <div className="sidebar-brand"><img src={appLogoUrl} alt="" /><div><strong>mLearn</strong><span>School Console</span></div><button aria-label="Close navigation" onClick={onNavigate}><X /></button></div>
    <nav aria-label="Primary">{ITEMS.filter((item) => can(item.capability)).map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={onNavigate}><item.icon /><span>{item.label}</span></NavLink>)}</nav>
    <div className="sidebar-footer"><div className="signed-in-user"><span>{auth.status === 'authenticated' ? auth.user.email : 'Session unavailable'}</span><small>{scope.status === 'ready' ? scope.selectedGroup?.name ?? 'Select a group' : 'Loading scope'}</small></div>{auth.status === 'authenticated' && <button onClick={() => void auth.signOut()}><LogOut /> Log out</button>}</div>
  </aside>;
}
