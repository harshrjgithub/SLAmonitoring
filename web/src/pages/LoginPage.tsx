import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function fillDemo() {
    setEmail('admin@helpdesk.local');
    setPassword('Password123!');
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1 className="auth-title">BankOps</h1>
        <p className="muted">Internal Banking IT Service Portal</p>

        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="error-box">{error}</div>}
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : 'Secure sign in'}
          </button>
        </form>

        <button className="btn-ghost btn-sm demo-btn" onClick={fillDemo}>
          Demo manager sign in
        </button>
      </div>
    </div>
  );
}
