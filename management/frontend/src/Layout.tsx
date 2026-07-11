import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { AppSidebar } from './components/AppSidebar';
import { GroupSwitcher } from './components/GroupSwitcher';

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="console-shell">
      <button className="mobile-nav-trigger" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></button>
      {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <AppSidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <section className="console-workspace">
        <header className="console-topbar"><GroupSwitcher /></header>
        <main className="console-main"><Outlet /></main>
      </section>
    </div>
  );
}
