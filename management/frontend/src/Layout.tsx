import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useRef, useState } from 'react';
import { AppSidebar } from './components/AppSidebar';
import { GroupSwitcher } from './components/GroupSwitcher';

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeNavigation = () => {
    setMobileOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <div className="console-shell">
      <button ref={triggerRef} className="mobile-nav-trigger" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu /></button>
      {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={closeNavigation} />}
      <AppSidebar mobileOpen={mobileOpen} onNavigate={closeNavigation} />
      <section className="console-workspace">
        <header className="console-topbar"><GroupSwitcher /></header>
        <main className="console-main"><Outlet /></main>
      </section>
    </div>
  );
}
