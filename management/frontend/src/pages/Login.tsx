import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiClient } from '../api/client';
import { useAuth } from '../auth/AuthProvider';

const api = new ApiClient();

export default function Login() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const desktopRequest = params.get('request');
  return <main className="auth-screen"><form onSubmit={(event) => { event.preventDefault(); void auth.login(email, password); }}>
    <header><h1>Sign in to mLearn</h1><p>{desktopRequest ? 'Sign in to review a desktop login request' : 'School administration console'}</p></header>
    <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required /></label>
    <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} required /></label>
    {auth.status === 'error' && <p role="alert">{auth.error.message}</p>}
    <button type="submit">Sign in</button>
    <Link to="/bootstrap">Set up the first administrator</Link>
  </form></main>;
}

export function DesktopApproval() {
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const [status, setStatus] = useState<'ready' | 'approving' | 'approved' | 'error'>('ready');
  const approve = async () => {
    if (!requestId) return;
    setStatus('approving');
    try {
      await api.get('/api/auth/desktop/approve', { method: 'POST', body: JSON.stringify({ requestId }) });
      setStatus('approved');
    } catch {
      setStatus('error');
    }
  };
  return <main className="auth-screen"><section className="desktop-approval" aria-labelledby="desktop-approval-title">
    <header><h1 id="desktop-approval-title">Desktop login request</h1><p>Approve only if you initiated a sign-in from your mLearn desktop app.</p></header>
    {requestId ? <code>{requestId}</code> : <p role="alert">This desktop request link is incomplete.</p>}
    {status === 'approved' ? <p role="status">Desktop login approved. You can return to the app.</p> : <button disabled={!requestId || status === 'approving'} onClick={() => void approve()}>{status === 'approving' ? 'Approving…' : 'Approve desktop login'}</button>}
    {status === 'error' ? <p role="alert">The desktop request is invalid or expired.</p> : null}
    <Link to="/">Cancel and return to the console</Link>
  </section></main>;
}
