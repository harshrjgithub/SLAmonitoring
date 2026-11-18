import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CATEGORY_LABELS, PRIORITY_LABELS, type Priority } from '../lib/types';

const priorities: Priority[]=['critical','high','medium','low'];
export function NewTicketPage(){
  const navigate=useNavigate(); const {user}=useAuth();
  const [title,setTitle]=useState('');const [description,setDescription]=useState('');const [category,setCategory]=useState('');const [priority,setPriority]=useState<Priority>('medium');
  const [department,setDepartment]=useState('');const [affected,setAffected]=useState('');const [assignee,setAssignee]=useState('');const [team,setTeam]=useState('');const [search,setSearch]=useState('');
  const [org,setOrg]=useState<{branches:Array<{id:number;name:string}>;departments:Array<{id:number;name:string}>;teams:Array<{id:number;name:string}>;roles:Array<{id:number;name:string}>}>({branches:[],departments:[],teams:[],roles:[]});
  const [people,setPeople]=useState<Array<{id:number;name:string;email:string;employee_id:string;role:string;department_id:number|null;department_name:string|null;branch_id:number|null;branch_name:string|null;team_id:number|null}>>([]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [files,setFiles]=useState<File[]>([]);
  useEffect(()=>{api.organisation().then(setOrg).catch(()=>{});api.directory().then(r=>setPeople(r.employees)).catch(()=>{});},[]);
  const selected=people.find(p=>String(p.id)===affected);const canAssign=user?.permissions?.includes('assign_tickets')||user?.role==='admin';
  async function submit(e:FormEvent){e.preventDefault();setError('');setBusy(true);try{const attachments=await Promise.all(files.map(async file=>{const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Unable to read attachment'));reader.readAsDataURL(file);});return{file_name:file.name,mime_type:file.type,size_bytes:file.size,base64:data.split(',')[1]??''};}));const r=await api.createTicket({title,description,category,priority,department_id:department?Number(department):selected?.department_id??null,affected_user_id:affected?Number(affected):null,assignee_id:assignee?Number(assignee):null,team_id:team?Number(team):null,attachments});navigate(`/tickets/${r.ticket.id}`);}catch(err){setError(err instanceof ApiError?err.message:err instanceof Error?err.message:'Could not create ticket');setBusy(false);}}
  const filtered=people.filter(p=>`${p.name} ${p.email} ${p.employee_id}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="narrow"><p className="eyebrow">INTERNAL IT SUPPORT</p><h1>Raise a ticket</h1><p className="muted">Tell the support team what is affected. Your branch is taken from your employee profile.</p>
    <form className="card" onSubmit={submit}>
      <label>Ticket title<input value={title} onChange={e=>setTitle(e.target.value)} required maxLength={160} placeholder="e.g. Core banking login unavailable"/></label>
      <label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} required minLength={8} rows={5} placeholder="Describe what happened, when it started, and who or what is affected."/></label>
      <div className="grid-2"><label>Issue category<select value={category} onChange={e=>setCategory(e.target.value)} required><option value="">Select a category</option>{Object.entries(CATEGORY_LABELS).filter(([key])=>key!=='hr_confidential'||user?.permissions?.includes('view_sensitive_tickets')).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>Priority<select value={priority} onChange={e=>setPriority(e.target.value as Priority)}>{priorities.map(p=><option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select></label></div>
      {priority==='critical'&&<div className="warning-box"><strong>Critical incident</strong><br/>Use this only for branch wide outages or major banking application disruptions. Clearly state the scope and impact in the description.</div>}
      <div className="grid-2"><label>Affected department (optional)<select value={selected?.department_id?String(selected.department_id):department} onChange={e=>setDepartment(e.target.value)}><option value="">Use my department / not specified</option>{org.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Ticket is for (optional)<input placeholder="Search name, email or employee ID" value={search} onChange={e=>setSearch(e.target.value)}/><select value={affected} onChange={e=>{setAffected(e.target.value);setDepartment('');}}><option value="">No specific employee</option>{filtered.map(p=><option key={p.id} value={p.id}>{p.name} · {p.employee_id} · {p.department_name||'No department'}</option>)}</select></label></div>
      {selected&&<p className="muted selection-info">Affected employee: {selected.name} · {selected.department_name||'No department'} · {selected.branch_name||user?.branch_name||'Branch from your profile'}. This does not assign the ticket to them.</p>}
      {canAssign&&<div className="grid-2"><label>Assign to employee (optional)<select value={assignee} onChange={e=>{setAssignee(e.target.value);if(e.target.value)setTeam('');}}><option value="">Leave unassigned</option>{people.filter(p=>p.id!==user?.id&&(p.role==='agent'||p.role==='admin')).map(p=><option key={p.id} value={p.id}>{p.name} · {p.employee_id}</option>)}</select></label><label>Or assign to team<select value={team} onChange={e=>{setTeam(e.target.value);if(e.target.value)setAssignee('');}}><option value="">No team</option>{org.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>}
      <label>Attachments (optional)<input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>{const next=Array.from(e.target.files??[]);if(next.length>3||next.some(f=>f.size>5*1024*1024)){setError('Attach up to three files, 5 MB each.');setFiles([]);}else{setError('');setFiles(next);}}}/><small className="muted">PNG, JPG, WebP, PDF, TXT or DOCX. Up to 3 files, 5 MB each.</small></label>
      <div className="branch-note"><b>Branch</b><span>{selected?.branch_name||user?.branch_name||'Your registered branch'}</span><small>Contact a manager if this ticket affects a different branch.</small></div>
      {error&&<div className="error-box">{error}</div>}<div className="form-actions"><button type="button" className="btn-ghost" onClick={()=>navigate(-1)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy?'Submitting…':'Submit ticket'}</button></div>
    </form>
  </div>;
}
