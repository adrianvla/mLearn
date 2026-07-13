import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import Layout from './Layout';
import { lazy, Suspense } from 'react';
import { Spinner } from '@heroui/react';
import { useAuth } from './auth/AuthProvider';
import type { ReactNode } from 'react';
import Login, { DesktopApproval } from './pages/Login';

const Overview = lazy(() => import('./pages/Overview'));
const Services = lazy(() => import('./pages/Services'));
const Logs = lazy(() => import('./pages/Logs'));
const Config = lazy(() => import('./pages/Config'));
const Storage = lazy(() => import('./pages/Storage'));
const AiStatus = lazy(() => import('./pages/AiStatus'));
const School = lazy(() => import('./pages/School'));
const Users = lazy(() => import('./pages/Users'));
const Groups = lazy(() => import('./pages/Groups'));
const Policies = lazy(() => import('./pages/Policies'));
const LlmGateway = lazy(() => import('./pages/LlmGateway'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Governance = lazy(() => import('./pages/Governance'));
const Activity = lazy(() => import('./pages/Activity'));
const Settings = lazy(() => import('./pages/Settings'));
const Bootstrap = lazy(() => import('./pages/Bootstrap'));
const Diagnostics = lazy(() => import('./pages/Diagnostics'));
const OperationalLogs = lazy(() => import('./pages/OperationalLogs'));

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <PageLoader />;
  if (auth.status !== 'authenticated') return <Routes><Route path="/bootstrap" element={<Suspense fallback={<PageLoader />}><Bootstrap /></Suspense>} /><Route path="*" element={<Suspense fallback={<PageLoader />}><Login /></Suspense>} /></Routes>;
  if (location.pathname === '/login' && new URLSearchParams(location.search).has('request')) return <DesktopApproval />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Suspense fallback={<PageLoader />}><Overview /></Suspense>} />
        <Route path="/services" element={<RootOnly><Suspense fallback={<PageLoader />}><Services /></Suspense></RootOnly>} />
        <Route path="/settings/diagnostics/logs" element={<RootOnly><Suspense fallback={<PageLoader />}><OperationalLogs /></Suspense></RootOnly>} />
        <Route path="/conversations" element={<Suspense fallback={<PageLoader />}><Logs /></Suspense>} />
        <Route path="/config" element={<RootOnly><Suspense fallback={<PageLoader />}><Config /></Suspense></RootOnly>} />
        <Route path="/storage" element={<RootOnly><Suspense fallback={<PageLoader />}><Storage /></Suspense></RootOnly>} />
        <Route path="/ai-status" element={<RootOnly><Suspense fallback={<PageLoader />}><AiStatus /></Suspense></RootOnly>} />
        <Route path="/school" element={<RootOnly><Suspense fallback={<PageLoader />}><School /></Suspense></RootOnly>} />
        <Route path="/users" element={<Suspense fallback={<PageLoader />}><Users /></Suspense>} />
        <Route path="/groups" element={<Suspense fallback={<PageLoader />}><Groups /></Suspense>} />
        <Route path="/policies" element={<Suspense fallback={<PageLoader />}><Policies /></Suspense>} />
        <Route path="/llm-gateway" element={<Suspense fallback={<PageLoader />}><LlmGateway /></Suspense>} />
        <Route path="/analytics" element={<Suspense fallback={<PageLoader />}><Analytics /></Suspense>} />
        <Route path="/governance" element={<Suspense fallback={<PageLoader />}><Governance /></Suspense>} />
        <Route path="/activity" element={<Suspense fallback={<PageLoader />}><Activity /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
        <Route path="/settings/diagnostics" element={<RootOnly><Suspense fallback={<PageLoader />}><Diagnostics /></Suspense></RootOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function RootOnly({children}:{children:ReactNode}) { const auth=useAuth(); return auth.status==='authenticated'&&auth.user.isRoot?children:<Navigate to="/settings" replace/>; }
