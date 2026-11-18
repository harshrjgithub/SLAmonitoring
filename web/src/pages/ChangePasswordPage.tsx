import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export function ChangePasswordPage() {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const { refreshUser } = useAuth(); const navigate = useNavigate();
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    try { await api.changePassword(password); await refreshUser(); navigate('/'); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Unable to change password'); }
    finally { setBusy(false); }
  }
  return <div className="auth-wrap"><div className="card auth-card"><p className="eyebrow">ACCOUNT SECURITY</p><h1>Set your password</h1><p className="muted">Choose a new password before entering BankOps. Use at least 12 characters.</p>
    <form onSubmit={submit}><label>New password<input type="password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirm password<input type="password" minLength={12} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>{error&&<div className="error-box">{error}</div>}<button className="btn-primary" disabled={busy}>{busy?'Saving…':'Update password'}</button></form></div></div>;
}
