import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { Employee } from '../lib/types';

export function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', employee_id: '', designation: '', role: 'user' });

  async function load(q = query) {
    try { setEmployees((await api.employees(q)).employees); setError(''); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Unable to load employees'); }
  }
  useEffect(() => { void load(''); }, []);

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage(''); setError(''); setTemporaryPassword('');
    try {
      const result = await api.createEmployee(form);
      setTemporaryPassword(result.temporaryPassword);
      setMessage(`Created account for ${result.employee.name}. Share the temporary password securely.`);
      setForm({ name: '', email: '', employee_id: '', designation: '', role: 'user' });
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Unable to create employee'); }
    finally { setBusy(false); }
  }

  async function toggle(employee: Employee) {
    const account_status = employee.account_status === 'active' ? 'inactive' : 'active';
    try { await api.updateEmployee(employee.id, { account_status }); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Unable to update account'); }
  }

  return <section>
    <div className="page-head"><div><p className="eyebrow">PEOPLE & ACCESS</p><h1>Employee Management</h1><p className="muted">Provision internal accounts and manage employee access.</p></div></div>
    {error && <div className="error-box">{error}</div>}{message && <div className="success-box">{message}{temporaryPassword && <div className="temp-password"><b>Temporary password</b><code>{temporaryPassword}</code><small>Shown once. Send it to the employee through your approved secure channel.</small></div>}</div>}
    <div className="grid-2 employee-layout">
      <div className="card"><h2>Register employee</h2><form onSubmit={create}>
        <label>Full name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label>Official email<input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
        <label>Employee ID<input required value={form.employee_id} onChange={e=>setForm({...form,employee_id:e.target.value})}/></label>
        <label>Designation<input value={form.designation} onChange={e=>setForm({...form,designation:e.target.value})}/></label>
        <label>Initial access<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="user">Employee</option><option value="agent">IT Support</option></select></label>
        <button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create employee account'}</button>
      </form></div>
      <div className="card"><div className="page-head"><h2>Registered employees</h2><span className="badge badge-count">{employees.length} accounts</span></div>
        <div className="employee-search"><input aria-label="Search employees" placeholder="Search name, email or employee ID" value={query} onChange={e=>{setQuery(e.target.value); void load(e.target.value)}}/></div>
        <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Team / department</th><th>Status</th><th></th></tr></thead><tbody>
          {employees.map(employee=><tr key={employee.id}><td><strong>{employee.name}</strong><small>{employee.employee_id} · {employee.email}</small><small>{employee.designation}</small></td><td>{employee.team_name || '—'}<small>{employee.department_name || '—'}</small></td><td><span className={`badge ${employee.account_status==='active'?'account-active':'account-inactive'}`}>{employee.account_status}</span></td><td><button className="btn-ghost btn-sm" disabled={employee.role==='admin'} onClick={()=>void toggle(employee)}>{employee.account_status==='active'?'Deactivate':'Activate'}</button></td></tr>)}
          {!employees.length && <tr><td colSpan={4} className="muted">No employees found.</td></tr>}
        </tbody></table></div>
      </div>
    </div>
  </section>;
}
