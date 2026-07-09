import { Routes, Route } from 'react-router-dom';
import Layout from './Layout';
import { lazy, Suspense } from 'react';
import { Spinner } from '@heroui/react';

const Overview = lazy(() => import('./pages/Overview'));
const Services = lazy(() => import('./pages/Services'));
const Logs = lazy(() => import('./pages/Logs'));
const Config = lazy(() => import('./pages/Config'));
const Storage = lazy(() => import('./pages/Storage'));
const AiStatus = lazy(() => import('./pages/AiStatus'));
const School = lazy(() => import('./pages/School'));
const Users = lazy(() => import('./pages/Users'));
const Distribution = lazy(() => import('./pages/Distribution'));
const LlmGateway = lazy(() => import('./pages/LlmGateway'));
const Analytics = lazy(() => import('./pages/Analytics'));

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Suspense fallback={<PageLoader />}><Overview /></Suspense>} />
        <Route path="/services" element={<Suspense fallback={<PageLoader />}><Services /></Suspense>} />
        <Route path="/logs" element={<Suspense fallback={<PageLoader />}><Logs /></Suspense>} />
        <Route path="/config" element={<Suspense fallback={<PageLoader />}><Config /></Suspense>} />
        <Route path="/storage" element={<Suspense fallback={<PageLoader />}><Storage /></Suspense>} />
        <Route path="/ai-status" element={<Suspense fallback={<PageLoader />}><AiStatus /></Suspense>} />
        <Route path="/school" element={<Suspense fallback={<PageLoader />}><School /></Suspense>} />
        <Route path="/users" element={<Suspense fallback={<PageLoader />}><Users /></Suspense>} />
        <Route path="/distribution" element={<Suspense fallback={<PageLoader />}><Distribution /></Suspense>} />
        <Route path="/llm-gateway" element={<Suspense fallback={<PageLoader />}><LlmGateway /></Suspense>} />
        <Route path="/analytics" element={<Suspense fallback={<PageLoader />}><Analytics /></Suspense>} />
      </Route>
    </Routes>
  );
}
