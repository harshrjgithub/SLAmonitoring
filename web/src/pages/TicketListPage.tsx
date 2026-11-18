import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { CATEGORY_LABELS, STATUS_LABELS, PRIORITY_LABELS, type Ticket, type Status, type Priority } from '../lib/types';
import { StatusBadge, PriorityBadge, SlaBadge } from '../components/Badges';
import { relativeTime } from '../lib/format';

const STATUSES: Status[] = ['open','assigned','in_progress','on_hold','escalated','resolved','closed','reopened'];
const PRIORITIES: Priority[] = ['critical','high','medium','low','urgent','normal'];
const CATEGORIES = Object.keys(CATEGORY_LABELS);

export function TicketListPage() {
  const [params,setParams]=useSearchParams();
  const [tickets,setTickets]=useState<Ticket[]|null>(null); const [error,setError]=useState('');
  const [people,setPeople]=useState<Array<{id:number;name:string;employee_id:string;role:string}>>([]);
  const [org,setOrg]=useState<{branches:Array<{id:number;name:string}>;departments:Array<{id:number;name:string}>;teams:Array<{id:number;name:string}>;roles:Array<{id:number;name:string}>}>({branches:[],departments:[],teams:[],roles:[]});
  const q=params.get('q')??'',status=params.get('status')??'',priority=params.get('priority')??'',category=params.get('category')??'',department_id=params.get('department_id')??'',branch_id=params.get('branch_id')??'',assignee=params.get('assignee')??'',sort=params.get('sort')??'created_at',direction=params.get('direction')??'desc';
  const assignee_id=params.get('assignee_id')??'',team_id=params.get('team_id')??'';
  useEffect(()=>{api.organisation().then(setOrg).catch(()=>{});api.directory().then(r=>setPeople(r.employees.filter(p=>p.role==='agent'||p.role==='admin'))).catch(()=>{});},[]);
  useEffect(()=>{setTickets(null);setError('');api.listTickets({q,status,priority,category,department_id,branch_id,assignee:assignee as 'me'|'unassigned',assignee_id,team_id,sort,direction}).then(r=>setTickets(r.tickets)).catch(e=>setError(e.message));},[q,status,priority,category,department_id,branch_id,assignee,assignee_id,team_id,sort,direction]);
  function set(key:string,value:string){const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);setParams(next);}
  return <section>
    <div className="page-head"><div><p className="eyebrow">BANKOPS SERVICE DESK</p><h1>Organisation Tickets</h1><p className="muted">Shared operational queue. Restricted HR and cybersecurity tickets stay private.</p></div><Link to="/new" className="btn-primary">+ Raise ticket</Link></div>
    <div className="filters card ticket-filters">
      <input className="search-filter" placeholder="Search ticket, title or raised by" value={q} onChange={e=>set('q',e.target.value)}/>
      <select value={department_id} onChange={e=>set('department_id',e.target.value)}><option value="">All departments</option>{org.departments.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select value={branch_id} onChange={e=>set('branch_id',e.target.value)}><option value="">All branches</option>{org.branches.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select value={category} onChange={e=>set('category',e.target.value)}><option value="">All categories</option>{CATEGORIES.map(x=><option key={x} value={x}>{CATEGORY_LABELS[x]}</option>)}</select>
      <select value={priority} onChange={e=>set('priority',e.target.value)}><option value="">All priorities</option>{PRIORITIES.map(x=><option key={x} value={x}>{PRIORITY_LABELS[x]}</option>)}</select>
      <select value={status} onChange={e=>set('status',e.target.value)}><option value="">All statuses</option>{STATUSES.map(x=><option key={x} value={x}>{STATUS_LABELS[x]}</option>)}</select>
      <select value={assignee} onChange={e=>set('assignee',e.target.value)}><option value="">All assignees</option><option value="me">Assigned to me / my team</option><option value="unassigned">Unassigned</option></select>
      <select value={assignee_id} onChange={e=>{set('assignee_id',e.target.value);if(e.target.value){set('team_id','');set('assignee','');}}}><option value="">Any employee</option>{people.map(p=><option key={p.id} value={p.id}>{p.name} · {p.employee_id}</option>)}</select>
      <select value={team_id} onChange={e=>{set('team_id',e.target.value);if(e.target.value){set('assignee_id','');set('assignee','');}}}><option value="">Any team</option>{org.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select value={`${sort}:${direction}`} onChange={e=>{const [s,d]=e.target.value.split(':');set('sort',s);set('direction',d);}}><option value="created_at:desc">Newest first</option><option value="created_at:asc">Oldest first</option><option value="priority:asc">Priority</option><option value="title:asc">Title</option><option value="status:asc">Status</option></select>
    </div>
    {error&&<div className="error-box">{error}</div>}{!tickets&&<div className="center muted">Loading organisation queue…</div>}{tickets?.length===0&&<div className="center muted">No tickets match these filters.</div>}
    {tickets&&tickets.length>0&&<div className="card table-wrap"><table className="ticket-table"><thead><tr><th>Ticket</th><th>Category / priority</th><th>Raised by</th><th>Affected</th><th>Assigned to</th><th>Status</th><th>Created</th><th>SLA</th></tr></thead><tbody>
      {tickets.map(t=><tr key={t.id}><td><Link to={`/tickets/${t.id}`}><strong>#{t.id} · {t.title}</strong></Link><small>{t.branch_name||'Branch not set'}</small></td><td>{CATEGORY_LABELS[t.category]??t.category}<small><PriorityBadge priority={t.priority}/></small></td><td>{t.requester_name}</td><td>{t.affected_name||'Branch / team issue'}<small>{t.department_name||'Department not set'}</small></td><td>{t.assignee_name||t.team_name||'Unassigned'}</td><td><StatusBadge status={t.status}/></td><td>{relativeTime(t.created_at)}</td><td>{t.status!=='closed'&&<SlaBadge sla={t.sla}/>}</td></tr>)}
    </tbody></table></div>}
  </section>;
}
