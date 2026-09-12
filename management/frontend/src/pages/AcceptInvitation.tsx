import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ConsoleButton, ConsoleTextField } from '../components/console';

export default function AcceptInvitation() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/provisioning/invitations/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), email: email.trim(), displayName: displayName.trim(), password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'Invitation could not be accepted. Check the code and account details.');
      }
      setToken(''); setPassword(''); setComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reach Management. Try again.');
    } finally { setPending(false); }
  };
  return <main className="auth-screen"><form onSubmit={(event) => void submit(event)}>
    <header><h1>Accept your school invitation</h1><p>Use the invitation code your administrator shared with you. For an existing account, enter your current password.</p></header>
    {complete ? <p role="status">Invitation accepted. You can now sign in.</p> : <>
      <ConsoleTextField label="Invitation code" value={token} onChange={setToken} isRequired />
      <ConsoleTextField label="Email" type="email" autoComplete="username" value={email} onChange={setEmail} isRequired />
      <ConsoleTextField label="Display name" value={displayName} onChange={setDisplayName} isRequired />
      <ConsoleTextField label="Password" type="password" minLength={12} value={password} onChange={setPassword} isRequired />
      {error ? <p role="alert">{error}</p> : null}
      <ConsoleButton type="submit" isDisabled={pending}>Accept invitation</ConsoleButton>
    </>}
    <Link to="/login">Sign in</Link>
  </form></main>;
}
