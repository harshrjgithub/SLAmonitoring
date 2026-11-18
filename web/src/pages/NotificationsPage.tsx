import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

type Notice={id:number;ticket_id:number|null;type:string;message:string;is_read:number;created_at:string;ticket_title:string|null};
export function NotificationsPage(){
  const [items,setItems]=useState<Notice[]|null>(null);const [error,setError]=useState('');
  async function load(){try{setItems((await api.notifications()).notifications);}catch(e){setError(e instanceof Error?e.message:'Could not load notifications');}}
  useEffect(()=>{void load();},[]);
  async function markRead(id:number){await api.markNotificationRead(id);await load();}
  async function markAll(){await api.markAllNotificationsRead();await load();}
  if(error)return <div className="error-box">{error}</div>;
  return <section><div className="page-head"><div><p className="eyebrow">UPDATES</p><h1>Notifications</h1><p className="muted">Ticket assignments, progress, confirmations, escalations and SLA reminders.</p></div><button className="btn-ghost" onClick={()=>void markAll()} disabled={!items?.some(n=>!n.is_read)}>Mark all read</button></div>
    {!items&&<div className="center muted">Loading notifications…</div>}{items?.length===0&&<div className="card center muted">You're all caught up.</div>}
    <div className="notification-list">{items?.map(n=><article key={n.id} className={`card notification-card ${n.is_read?'':'notification-unread'}`}><div><div className="notification-head"><span className={`badge notification-${n.type}`}>{n.type.replaceAll('_',' ')}</span><small className="muted">{new Date(n.created_at+'Z').toLocaleString()}</small></div><p>{n.message}</p>{n.ticket_title&&<small className="muted">{n.ticket_title}</small>}</div><div className="notification-actions">{n.ticket_id&&<Link className="btn-ghost btn-sm" to={`/tickets/${n.ticket_id}`} onClick={()=>{if(!n.is_read)void markRead(n.id);}}>Open ticket</Link>}{!n.is_read&&<button className="btn-ghost btn-sm" onClick={()=>void markRead(n.id)}>Mark read</button>}</div></article>)}</div>
  </section>;
}
