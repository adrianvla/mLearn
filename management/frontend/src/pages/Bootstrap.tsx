import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { establishSession, ApiClient, AUTH_SIGNED_OUT_EVENT } from '../api/client';
import type { AuthSession } from '../api/types';
import { ConsoleButton, ConsoleTextField } from '../components/console';

export default function Bootstrap({ recoveryMode = false }: { recoveryMode?: boolean }) {
  const navigate = useNavigate();
  const [recovery, setRecovery] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (pending) return;
    setPending(true);
    setError(null);
    try {
    const response = await fetch(recoveryMode ? '/api/auth/recover-root' : '/api/auth/bootstrap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${recovery}`,
      },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      setError(recoveryMode ? 'Recovery failed. Check the recovery credential and administrator email.' : response.status === 409
        ? 'A root administrator already exists. Sign in instead.'
        : 'Bootstrap failed. Check the recovery credential and try again.');
      return;
    }
    if (recoveryMode) {
      new ApiClient().clearSession();
      window.dispatchEvent(new Event(AUTH_SIGNED_OUT_EVENT));
      setRecovery(''); setPassword(''); setConfirmPassword(''); setComplete(true);
      navigate('/login?recovered=1');
      return;
    }
    const body = await response.json() as { session: AuthSession };
    establishSession(body.session);
    setRecovery('');
    navigate('/');
    } catch {
      setError('Unable to reach Management. Check the connection and try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-screen">
      <form onSubmit={(event) => void submit(event)}>
        <header>
          <h1>{recoveryMode ? "Recover the root administrator" : "Create the root administrator"}</h1>
          <p>The recovery credential is used for this request only and is never stored.</p>
        </header>
        {complete ? <p role="status">Password reset. Sign in with your new password.</p> : <>
        <ConsoleTextField label="Recovery credential" type="password" value={recovery} onChange={setRecovery} isRequired />
        <ConsoleTextField label="Email" type="email" value={email} onChange={setEmail} isRequired />
        <ConsoleTextField label="Password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={setPassword} isRequired />
        <ConsoleTextField label="Confirm password" type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={setConfirmPassword} isRequired />
        {error && <p role="alert">{error}</p>}
        <ConsoleButton type="submit" isDisabled={pending}>{recoveryMode ? "Reset administrator password" : "Create administrator"}</ConsoleButton>
        </>}
        <Link to="/login">Back to sign in</Link>
      </form>
    </main>
  );
}
