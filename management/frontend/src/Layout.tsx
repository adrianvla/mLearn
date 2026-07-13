import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { ConsoleButton } from './components/console';
import { useEffect, useRef, useState } from 'react';
import { AppSidebar } from './components/AppSidebar';
import { GroupSwitcher } from './components/GroupSwitcher';
import { GlobalSearch } from './components/GlobalSearch';
import { NotificationMenu } from './components/NotificationMenu';
import { useGroupScope } from './groups/GroupScopeProvider';

export default function Layout() {
  const scope = useGroupScope();
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocusManagement();
  const closeNavigation = () => {
    setMobileOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <div className="console-shell">
      <ConsoleButton ref={triggerRef} variant="secondary" isIconOnly className="mobile-nav-trigger" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu /></ConsoleButton>
      {mobileOpen && <ConsoleButton variant="ghost" className="mobile-backdrop" aria-label="Close navigation" onClick={closeNavigation}>Close navigation</ConsoleButton>}
      <AppSidebar mobileOpen={mobileOpen} onNavigate={closeNavigation} />
      <section className="console-workspace">
        <header className="console-topbar"><GlobalSearch /><NotificationMenu groupId={scope.status === 'ready' ? scope.selectedGroup?.id ?? null : null} /><GroupSwitcher /></header>
        <main className="console-main"><Outlet /></main>
      </section>
    </div>
  );
}

function useDialogFocusManagement() {
  useEffect(() => {
    let activeDialog: HTMLElement | null = null;
    let returnFocus: HTMLElement | null = null;
    const sync = () => {
      const nextDialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (nextDialog && !activeDialog) {
        activeDialog = nextDialog;
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        queueMicrotask(() => {
          const focusTarget = nextDialog.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
          focusTarget?.focus();
        });
      } else if (!nextDialog && activeDialog) {
        activeDialog = null;
        returnFocus?.focus();
        returnFocus = null;
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, []);
}
