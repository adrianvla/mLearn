import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { establishSession } from '../api/client';
import type { AuthSession } from '../api/types';

export default function Bootstrap() {
  const navigate = useNavigate();
  const [recovery, setRecovery] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    const response = await fetch('/api/auth/bootstrap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${recovery}`,
      },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      setError(response.status === 409
        ? 'A root administrator already exists. Sign in instead.'
        : 'Bootstrap failed. Check the recovery credential and try again.');
      return;
    }
    const body = await response.json() as { session: AuthSession };
    establishSession(body.session);
    setRecovery('');
    navigate('/');
  };

  return (
    <main className="auth-screen">
      <form onSubmit={(event) => void submit(event)}>
        <header>
          <h1>Create the root administrator</h1>
          <p>The recovery credential is used for this request only and is never stored.</p>
        </header>
        <label>Recovery credential<input aria-label="Recovery credential" type="password" value={recovery} onChange={(event) => setRecovery(event.currentTarget.value)} required /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required /></label>
        <label>Password<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.currentTarget.value)} required /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} required /></label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Create administrator</button>
        <Link to="/login">Back to sign in</Link>
      </form>
    </main>
  );
}
