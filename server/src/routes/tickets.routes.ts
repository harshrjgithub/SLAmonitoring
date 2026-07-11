import { Router } from 'express';
import type { DB } from '../db.js';
import { requireAuth, requireRole, type AuthedRequest } from '../auth.js';
import {
  isValidPriority,
  isValidCategory,
  isValidStatus,
  transitionStatus,
  allowedTransitions,
  type Status,
} from '../tickets.js';
import { computeSlaDueAt, getSlaStatus, type Priority } from '../sla.js';

interface TicketRow {
  id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  category: string;
  requester_id: number;
  assignee_id: number | null;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  requester_name?: string;
  assignee_name?: string | null;
}

const SELECT_WITH_NAMES = `
  SELECT t.*,
         r.name AS requester_name,
         a.name AS assignee_name
  FROM tickets t
  JOIN users r ON r.id = t.requester_id
  LEFT JOIN users a ON a.id = t.assignee_id
`;

function withSla(row: TicketRow) {
  const sla = getSlaStatus({
    priority: row.priority,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
  return { ...row, sla, allowedTransitions: allowedTransitions(row.status) };
}

const isStaff = (role: string) => role === 'agent' || role === 'admin';

export function ticketRoutes(db: DB): Router {
  const router = Router();
  router.use(requireAuth);

  // List tickets. Staff see all; end-users see only their own. Supports
  // ?status=, ?priority=, ?assignee=me filters.
  router.get('/', (req: AuthedRequest, res) => {
    const clauses: string[] = [];
    const params: Array<string | number | null> = [];

    if (!isStaff(req.user!.role)) {
      clauses.push('t.requester_id = ?');
      params.push(req.user!.sub);
    }
    if (typeof req.query.status === 'string' && isValidStatus(req.query.status)) {
      clauses.push('t.status = ?');
      params.push(req.query.status);
    }
    if (typeof req.query.priority === 'string' && isValidPriority(req.query.priority)) {
      clauses.push('t.priority = ?');
      params.push(req.query.priority);
    }
    if (req.query.assignee === 'me') {
      clauses.push('t.assignee_id = ?');
      params.push(req.user!.sub);
    } else if (req.query.assignee === 'unassigned') {
      clauses.push('t.assignee_id IS NULL');
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`${SELECT_WITH_NAMES} ${where} ORDER BY t.created_at DESC`)
      .all(...params) as unknown as TicketRow[];
    res.json({ tickets: rows.map(withSla) });
  });

  router.get('/:id', (req: AuthedRequest, res) => {
    const row = db.prepare(`${SELECT_WITH_NAMES} WHERE t.id = ?`).get(req.params.id) as unknown as TicketRow | undefined;
    if (!row) return res.status(404).json({ error: 'ticket not found' });
    if (!isStaff(req.user!.role) && row.requester_id !== req.user!.sub) {
      return res.status(403).json({ error: 'not your ticket' });
    }
    const comments = db
      .prepare(
        `SELECT c.*, u.name AS author_name, u.role AS author_role
         FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.ticket_id = ? ORDER BY c.created_at ASC`,
      )
      .all(req.params.id);
    return res.json({ ticket: withSla(row), comments });
  });

  // Create a ticket. Anyone authenticated can raise one; requester is the caller.
  router.post('/', (req: AuthedRequest, res) => {
    const { title, description = '', priority = 'normal', category = 'other' } = req.body ?? {};
    if (!title || String(title).trim() === '') {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!isValidPriority(priority)) return res.status(400).json({ error: 'invalid priority' });
    if (!isValidCategory(category)) return res.status(400).json({ error: 'invalid category' });

    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO tickets
           (title, description, priority, category, requester_id, sla_due_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(String(title).trim(), description, priority, category, req.user!.sub,
        computeSlaDueAt(priority, now), now, now);

    const row = db.prepare(`${SELECT_WITH_NAMES} WHERE t.id = ?`).get(info.lastInsertRowid) as unknown as TicketRow;
    return res.status(201).json({ ticket: withSla(row) });
  });

  // Update status / priority / assignee. Staff only — enforces the state machine.
  router.patch('/:id', requireRole('agent', 'admin'), (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id) as unknown as TicketRow | undefined;
    if (!row) return res.status(404).json({ error: 'ticket not found' });

    const updates: string[] = [];
    const params: Array<string | number | null> = [];

    if (req.body?.status !== undefined) {
      const target = req.body.status;
      if (!isValidStatus(target)) return res.status(400).json({ error: 'invalid status' });
      let effect;
      try {
        effect = transitionStatus(row.status, target);
      } catch (err) {
        return res.status(409).json({ error: (err as Error).message });
      }
      updates.push('status = ?');
      params.push(target);
      if (effect.resolved) {
        updates.push('resolved_at = ?');
        params.push(new Date().toISOString());
      } else if (effect.reopened) {
        updates.push('resolved_at = NULL');
      }
    }

    if (req.body?.priority !== undefined) {
      if (!isValidPriority(req.body.priority)) return res.status(400).json({ error: 'invalid priority' });
      updates.push('priority = ?', 'sla_due_at = ?');
      params.push(req.body.priority, computeSlaDueAt(req.body.priority, row.created_at));
    }

    if (req.body?.assignee_id !== undefined) {
      const assignee = req.body.assignee_id;
      if (assignee === null) {
        updates.push('assignee_id = NULL');
      } else {
        const staff = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('agent','admin')").get(assignee);
        if (!staff) return res.status(400).json({ error: 'assignee must be an agent or admin' });
        updates.push('assignee_id = ?');
        params.push(assignee);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'no valid fields to update' });

    updates.push('updated_at = ?');
    params.push(new Date().toISOString(), req.params.id);
    db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare(`${SELECT_WITH_NAMES} WHERE t.id = ?`).get(req.params.id) as unknown as TicketRow;
    return res.json({ ticket: withSla(updated) });
  });

  // Add a comment. Requester or any staff member may comment.
  router.post('/:id/comments', (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id) as unknown as TicketRow | undefined;
    if (!row) return res.status(404).json({ error: 'ticket not found' });
    if (!isStaff(req.user!.role) && row.requester_id !== req.user!.sub) {
      return res.status(403).json({ error: 'not your ticket' });
    }
    const body = req.body?.body;
    if (!body || String(body).trim() === '') return res.status(400).json({ error: 'comment body is required' });

    const now = new Date().toISOString();
    const info = db
      .prepare('INSERT INTO comments (ticket_id, author_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(req.params.id, req.user!.sub, String(body).trim(), now);
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, req.params.id);

    const comment = db
      .prepare(
        `SELECT c.*, u.name AS author_name, u.role AS author_role
         FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`,
      )
      .get(info.lastInsertRowid);
    return res.status(201).json({ comment });
  });

  return router;
}
