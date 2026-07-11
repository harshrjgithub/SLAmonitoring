import { useEffect, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth, isStaff } from '../lib/auth';
import {
  CATEGORY_LABELS, STATUS_LABELS, PRIORITY_LABELS,
  type Ticket, type Comment, type Agent, type Status, type Priority,
} from '../lib/types';
import { StatusBadge, PriorityBadge, SlaBadge } from '../components/Badges';
import { relativeTime } from '../lib/format';

const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];

export function TicketDetailPage() {
  const { id } = useParams();
  const ticketId = Number(id);
  const { user } = useAuth();
  const staff = isStaff(user?.role);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  function load() {
    api.getTicket(ticketId)
      .then((res) => { setTicket(res.ticket); setComments(res.comments); })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    if (staff) api.agents().then((r) => setAgents(r.agents)).catch(() => {});
  }, [ticketId, staff]);

  async function patch(changes: { status?: string; priority?: string; assignee_id?: number | null }) {
    setError('');
    try {
      const res = await api.updateTicket(ticketId, changes);
      setTicket(res.ticket);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    try {
      const res = await api.addComment(ticketId, comment);
      setComments((prev) => [...prev, res.comment]);
      setComment('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add comment');
    }
  }

  if (error && !ticket) return <div className="error-box">{error}</div>;
  if (!ticket) return <div className="center muted">Loading…</div>;

  return (
    <div>
      <Link to="/tickets" className="back-link">← Back to tickets</Link>

      <div className="detail-head">
        <div>
          <h1><span className="ticket-id">#{ticket.id}</span> {ticket.title}</h1>
          <div className="muted">
            {CATEGORY_LABELS[ticket.category] ?? ticket.category} · opened by {ticket.requester_name} {relativeTime(ticket.created_at)}
          </div>
        </div>
        <div className="detail-badges">
          <PriorityBadge priority={ticket.priority} />
          <StatusBadge status={ticket.status} />
          {ticket.status !== 'closed' && <SlaBadge sla={ticket.sla} />}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="grid-detail">
        <div>
          <div className="card">
            <h2>Description</h2>
            <p className="description">{ticket.description || <span className="muted">No description provided.</span>}</p>
          </div>

          <div className="card">
            <h2>Conversation</h2>
            {comments.length === 0 && <p className="muted">No comments yet.</p>}
            <ul className="comments">
              {comments.map((c) => (
                <li key={c.id} className={`comment ${isStaff(c.author_role) ? 'from-staff' : ''}`}>
                  <div className="comment-head">
                    <strong>{c.author_name}</strong>
                    <span className={`badge role-${c.author_role}`}>{c.author_role}</span>
                    <span className="muted">{relativeTime(c.created_at)}</span>
                  </div>
                  <div className="comment-body">{c.body}</div>
                </li>
              ))}
            </ul>
            <form className="comment-form" onSubmit={submitComment}>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)}
                rows={3} placeholder="Add a reply…" />
              <button type="submit" className="btn-primary" disabled={!comment.trim()}>Reply</button>
            </form>
          </div>
        </div>

        <aside className="card side-panel">
          <h2>Details</h2>
          <dl className="detail-list">
            <dt>Requester</dt><dd>{ticket.requester_name}</dd>
            <dt>Assignee</dt><dd>{ticket.assignee_name ?? <span className="muted">Unassigned</span>}</dd>
            <dt>Priority</dt><dd>{PRIORITY_LABELS[ticket.priority]}</dd>
            <dt>Status</dt><dd>{STATUS_LABELS[ticket.status]}</dd>
            <dt>SLA due</dt><dd>{relativeTime(ticket.sla.dueAt)}</dd>
            {ticket.resolved_at && (<><dt>Resolved</dt><dd>{relativeTime(ticket.resolved_at)}</dd></>)}
          </dl>

          {staff && (
            <div className="staff-controls">
              <h3>Agent actions</h3>
              <label>
                Change status
                <div className="transition-buttons">
                  {ticket.allowedTransitions.length === 0 && <span className="muted">No further transitions</span>}
                  {ticket.allowedTransitions.map((s: Status) => (
                    <button key={s} className="btn-ghost btn-sm" onClick={() => patch({ status: s })}>
                      → {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                Assign to
                <select value={ticket.assignee_id ?? ''} onChange={(e) =>
                  patch({ assignee_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Unassigned</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>
                Priority
                <select value={ticket.priority} onChange={(e) => patch({ priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                </select>
              </label>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
