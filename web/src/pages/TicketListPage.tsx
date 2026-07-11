import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, isStaff } from '../lib/auth';
import {
  CATEGORY_LABELS, STATUS_LABELS, PRIORITY_LABELS,
  type Ticket, type Status, type Priority,
} from '../lib/types';
import { StatusBadge, PriorityBadge, SlaBadge } from '../components/Badges';
import { relativeTime } from '../lib/format';

const STATUS_OPTIONS: Status[] = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'];
const PRIORITY_OPTIONS: Priority[] = ['urgent', 'high', 'normal', 'low'];

export function TicketListPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState('');

  const status = searchParams.get('status') ?? '';
  const priority = searchParams.get('priority') ?? '';
  const assignee = searchParams.get('assignee') ?? '';

  useEffect(() => {
    setTickets(null);
    api.listTickets({
      status: status || undefined,
      priority: priority || undefined,
      assignee: (assignee as 'me' | 'unassigned') || undefined,
    })
      .then((res) => setTickets(res.tickets))
      .catch((e) => setError(e.message));
  }, [status, priority, assignee]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  return (
    <div>
      <div className="page-head">
        <h1>Tickets</h1>
        <Link to="/new" className="btn-primary">+ New Ticket</Link>
      </div>

      <div className="filters card">
        <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select value={priority} onChange={(e) => setFilter('priority', e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
        {isStaff(user?.role) && (
          <select value={assignee} onChange={(e) => setFilter('assignee', e.target.value)}>
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}
      {!tickets && <div className="center muted">Loading tickets…</div>}
      {tickets && tickets.length === 0 && <div className="center muted">No tickets match these filters.</div>}

      {tickets && tickets.length > 0 && (
        <div className="ticket-list">
          {tickets.map((t) => (
            <Link key={t.id} to={`/tickets/${t.id}`} className="ticket-row card">
              <div className="ticket-row-main">
                <div className="ticket-row-title">
                  <span className="ticket-id">#{t.id}</span> {t.title}
                </div>
                <div className="ticket-row-meta muted">
                  {CATEGORY_LABELS[t.category] ?? t.category} · {t.requester_name} · opened {relativeTime(t.created_at)}
                  {t.assignee_name ? ` · assigned to ${t.assignee_name}` : ' · unassigned'}
                </div>
              </div>
              <div className="ticket-row-badges">
                <PriorityBadge priority={t.priority} />
                <StatusBadge status={t.status} />
                {t.status !== 'closed' && <SlaBadge sla={t.sla} />}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
