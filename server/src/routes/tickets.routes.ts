import { Router } from 'express';
import type { DB } from '../db.js';
import { hasPermission, requireAuth, type AuthedRequest } from '../auth.js';
import { isValidPriority, isValidCategory, isValidStatus, transitionStatus, allowedTransitions, type Status } from '../tickets.js';
import { computeSlaDueAt, getSlaStatus, type Priority } from '../sla.js';

interface TicketRow {
  id: number; title: string; description: string; status: Status; priority: Priority;
  category: string; requester_id: number; assignee_id: number | null; team_id: number | null;
  affected_user_id: number | null; department_id: number | null; branch_id: number | null;
  sensitivity: 'normal' | 'restricted'; sla_due_at: string | null; created_at: string;
  updated_at: string; resolved_at: string | null; resolved_by: number | null;
  internal_notes?: string; escalated_at?: string | null;
  requester_name?: string; assignee_name?: string | null; team_name?: string | null;
  affected_name?: string | null; department_name?: string | null; branch_name?: string | null;
}

const SELECT_WITH_NAMES = `SELECT t.*, r.name AS requester_name, a.name AS assignee_name,
  tm.name AS team_name, x.name AS affected_name, d.name AS department_name, b.name AS branch_name
  FROM tickets t JOIN users r ON r.id=t.requester_id LEFT JOIN users a ON a.id=t.assignee_id
  LEFT JOIN teams tm ON tm.id=t.team_id LEFT JOIN users x ON x.id=t.affected_user_id
  LEFT JOIN departments d ON d.id=t.department_id LEFT JOIN branches b ON b.id=t.branch_id`;

const ALLOWED_ATTACHMENT_TYPES = new Set(['image/png','image/jpeg','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
type IncomingAttachment = {file_name:string;mime_type:string;size_bytes:number;base64:string};
function validateAttachments(input: unknown): IncomingAttachment[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 3) throw new Error('Attach up to three files');
  return input.map((item) => {
    const file = item as Partial<IncomingAttachment>;
    if (typeof file.file_name !== 'string' || typeof file.mime_type !== 'string' || typeof file.base64 !== 'string' ||
      !Number.isInteger(file.size_bytes) || !ALLOWED_ATTACHMENT_TYPES.has(file.mime_type) || file.size_bytes! < 1 || file.size_bytes! > MAX_ATTACHMENT_BYTES ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) throw new Error('Attachment type or size is not allowed (5 MB per file)');
    const bytes=Buffer.from(file.base64,'base64');
    if(bytes.byteLength!==file.size_bytes) throw new Error('Attachment data failed validation');
    return {file_name:file.file_name.replace(/[^\w. -]/g,'_').slice(0,120),mime_type:file.mime_type,size_bytes:file.size_bytes!,base64:file.base64};
  });
}
function saveAttachments(db:DB,ticketId:number,actorId:number,files:IncomingAttachment[],kind:'attachment'|'resolution') {
  const insert=db.prepare('INSERT INTO ticket_attachments (ticket_id,uploaded_by,file_name,mime_type,size_bytes,file_url,kind) VALUES (?,?,?,?,?,?,?)');
  for(const f of files) insert.run(ticketId,actorId,f.file_name,f.mime_type,f.size_bytes,`data:${f.mime_type};base64,${f.base64}`,kind);
}

const isManager = (db: DB, user: NonNullable<AuthedRequest['user']>) =>
  user.role === 'admin' || hasPermission(db, user.sub, user.role, 'manage_employees');
const can = (db: DB, user: NonNullable<AuthedRequest['user']>, key: string) =>
  isManager(db, user) || hasPermission(db, user.sub, user.role, key);

function addHistory(db: DB, ticketId: number, actorId: number, action: string, details = '') {
  db.prepare('INSERT INTO ticket_history (ticket_id,actor_id,action,details) VALUES (?,?,?,?)')
    .run(ticketId, actorId, action, details);
  db.prepare('INSERT INTO audit_logs (actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)')
    .run(actorId, `ticket.${action}`, 'ticket', String(ticketId), details);
}
function notify(db: DB, ticketId: number, type: string, message: string, userIds: Array<number | null | undefined>) {
  const insert = db.prepare('INSERT INTO notifications (user_id,ticket_id,type,message) VALUES (?,?,?,?)');
  for (const id of new Set(userIds.filter((value): value is number => typeof value === 'number'))) insert.run(id, ticketId, type, message);
}
function canSeeSensitive(db: DB, user: NonNullable<AuthedRequest['user']>, row: TicketRow) {
  const restricted = row.sensitivity === 'restricted' || Boolean((row as TicketRow & { is_sensitive?: number }).is_sensitive);
  return !restricted || can(db, user, 'view_sensitive_tickets') ||
    row.requester_id === user.sub || row.affected_user_id === user.sub || row.assignee_id === user.sub;
}
function isAssigned(db: DB, user: NonNullable<AuthedRequest['user']>, row: TicketRow) {
  return row.assignee_id === user.sub || Boolean(row.team_id && db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(row.team_id, user.sub));
}
function present(db: DB, user: NonNullable<AuthedRequest['user']>, row: TicketRow) {
  const details = { ...row, sla: getSlaStatus({ priority: row.priority, createdAt: row.created_at, resolvedAt: row.resolved_at }), allowedTransitions: allowedTransitions(row.status) };
  if (!can(db, user, 'view_internal_notes')) delete (details as Partial<TicketRow>).internal_notes;
  return details;
}
function transition(from: Status, to: Status) {
  try { return transitionStatus(from, to); } catch (error) { throw new Error((error as Error).message); }
}

export function ticketRoutes(db: DB): Router {
  const router = Router();
  router.use(requireAuth);

  // Active employees can see the organisation queue; restricted tickets are
  // removed server-side unless the employee is authorised or a participant.
  router.get('/', (req: AuthedRequest, res) => {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) { clauses.push('(CAST(t.id AS TEXT) LIKE ? OR t.title LIKE ? OR r.name LIKE ? OR r.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    const filters: Array<[string, string]> = [['status', 't.status'], ['priority', 't.priority'], ['category', 't.category'], ['department_id', 't.department_id'], ['branch_id', 't.branch_id']];
    for (const [key, column] of filters) {
      const value = req.query[key];
      if (typeof value === 'string' && value && (key !== 'status' || isValidStatus(value)) && (key !== 'priority' || isValidPriority(value))) { clauses.push(`${column} = ?`); params.push(value); }
    }
    if (req.query.assignee === 'me') { clauses.push('(t.assignee_id=? OR t.team_id IN (SELECT team_id FROM team_members WHERE user_id=?))'); params.push(req.user!.sub, req.user!.sub); }
    else if (req.query.assignee === 'unassigned') clauses.push('t.assignee_id IS NULL AND t.team_id IS NULL');
    else if (typeof req.query.assignee === 'string' && /^\d+$/.test(req.query.assignee)) { clauses.push('(t.assignee_id=? OR t.team_id=?)'); params.push(Number(req.query.assignee), Number(req.query.assignee)); }
    if (typeof req.query.assignee_id === 'string' && /^\d+$/.test(req.query.assignee_id)) { clauses.push('t.assignee_id=?'); params.push(Number(req.query.assignee_id)); }
    if (typeof req.query.team_id === 'string' && /^\d+$/.test(req.query.team_id)) { clauses.push('t.team_id=?'); params.push(Number(req.query.team_id)); }
    const sortBy = typeof req.query.sort === 'string' && ['title','priority','status','created_at'].includes(req.query.sort) ? req.query.sort : 'created_at';
    const direction = req.query.direction === 'asc' ? 'ASC' : 'DESC';
    const rows = db.prepare(`${SELECT_WITH_NAMES} WHERE ${clauses.length ? clauses.join(' AND ') : '1=1'} ORDER BY t.${sortBy} ${direction}`).all(...params) as unknown as TicketRow[];
    const restrictedPermission = can(db, req.user!, 'view_sensitive_tickets');
    res.json({ tickets: rows.filter(row => restrictedPermission || canSeeSensitive(db, req.user!, row)).map(row => present(db, req.user!, row)) });
  });

  router.get('/:id', (req: AuthedRequest, res) => {
    const row = db.prepare(`${SELECT_WITH_NAMES} WHERE t.id=?`).get(req.params.id) as unknown as TicketRow | undefined;
    if (!row) return res.status(404).json({ error: 'ticket not found' });
    if (!canSeeSensitive(db, req.user!, row)) return res.status(404).json({ error: 'ticket not found' });
    const comments = db.prepare(`SELECT c.*,u.name AS author_name,u.role AS author_role FROM comments c JOIN users u ON u.id=c.author_id
      WHERE c.ticket_id=? AND (c.is_internal=0 OR ?=1) ORDER BY c.created_at ASC`)
      .all(req.params.id, can(db, req.user!, 'view_internal_notes') ? 1 : 0);
    const history = db.prepare(`SELECT h.*,u.name AS actor_name FROM ticket_history h LEFT JOIN users u ON u.id=h.actor_id
      WHERE h.ticket_id=? ORDER BY h.created_at ASC`).all(req.params.id);
    const attachments = db.prepare(`SELECT id,file_name,mime_type,size_bytes,file_url,kind,is_internal FROM ticket_attachments
      WHERE ticket_id=? AND (is_internal=0 OR ?=1) ORDER BY created_at`).all(req.params.id, can(db, req.user!, 'view_internal_notes') ? 1 : 0);
    return res.json({ ticket: present(db, req.user!, row), comments, history, attachments });
  });

  router.post('/', (req: AuthedRequest, res) => {
    const { title, description, category, priority = 'medium', department_id = null, affected_user_id = null,
      assignee_id = null, team_id = null } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim() || typeof description !== 'string' || !description.trim()) return res.status(400).json({ error: 'Ticket title and description are required' });
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Select a valid ticket category' });
    if (!isValidPriority(priority)) return res.status(400).json({ error: 'Invalid priority' });
    let files:IncomingAttachment[]; try { files=validateAttachments(req.body?.attachments); } catch(error) { return res.status(400).json({error:(error as Error).message}); }
    const actor = req.user!;
    const profile = db.prepare('SELECT branch_id,department_id FROM users WHERE id=? AND account_status=\'active\'').get(actor.sub) as { branch_id: number | null; department_id: number | null } | undefined;
    if (!profile) return res.status(401).json({ error: 'Active employee account required' });
    if (assignee_id && !can(db, actor, 'assign_tickets')) return res.status(403).json({ error: 'You cannot assign tickets to an individual employee during creation' });
    if (assignee_id) {
      const target=db.prepare("SELECT id,role FROM users WHERE id=? AND account_status='active'").get(assignee_id) as {id:number;role:'admin'|'agent'|'user'}|undefined;
      if (!target || (target.role!=='admin' && target.role!=='agent' && !hasPermission(db,target.id,target.role,'update_ticket_status'))) return res.status(400).json({ error: 'Assignee must be an active authorised support employee' });
    }
    if (team_id && !db.prepare('SELECT id FROM teams WHERE id=? AND is_active=1').get(team_id)) return res.status(400).json({ error: 'Select an active support team' });
    let affected: { department_id: number | null; branch_id: number | null } | undefined;
    if (affected_user_id) {
      affected = db.prepare("SELECT department_id,branch_id FROM users WHERE id=? AND account_status='active'").get(affected_user_id) as typeof affected;
      if (!affected) return res.status(400).json({ error: 'Affected employee must be active and registered' });
    }
    if (department_id && !db.prepare('SELECT id FROM departments WHERE id=? AND is_active=1').get(department_id)) return res.status(400).json({ error: 'Invalid department' });
    const finalDepartment = department_id ?? affected?.department_id ?? null;
    const branchId = affected?.branch_id ?? profile.branch_id;
    const sensitivity = ['cybersecurity', 'hr_confidential'].includes(category) ? 'restricted' : 'normal';
    const now = new Date().toISOString();
    const assigned = Boolean(assignee_id || team_id);
    let info: { lastInsertRowid: number | bigint };
    try {
      db.exec('BEGIN');
      const initialStatus = assigned ? 'assigned' : 'open';
      const restricted = ['cybersecurity', 'hr_confidential'].includes(category);
      info = db.prepare(`INSERT INTO tickets (title,description,status,lifecycle_status,priority,priority_level,category,requester_id,assignee_id,team_id,assigned_team_id,
        affected_user_id,affected_employee_id,department_id,branch_id,sensitivity,is_sensitive,sla_due_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(title.trim(), description.trim(), initialStatus, initialStatus, priority, priority, category,
          actor.sub, assignee_id || null, team_id || null, team_id || null, affected_user_id || null, affected_user_id || null, finalDepartment, branchId, sensitivity, restricted ? 1 : 0,
          computeSlaDueAt(priority, now), now, now);
      const id = Number(info.lastInsertRowid);
      saveAttachments(db,id,actor.sub,files,'attachment');
      addHistory(db, id, actor.sub, 'created', `Category: ${category}`);
      if (assigned) {
        db.prepare('INSERT INTO ticket_assignments (ticket_id,assignee_id,team_id,assigned_by) VALUES (?,?,?,?)').run(id, assignee_id || null, team_id || null, actor.sub);
        addHistory(db, id, actor.sub, 'assigned', assignee_id ? `Employee ID ${assignee_id}` : `Team ID ${team_id}`);
      }
      notify(db, id, 'created', `Ticket #${id} was raised`, [actor.sub, ...(assignee_id ? [Number(assignee_id)] : []), ...(team_id ? (db.prepare('SELECT user_id FROM team_members WHERE team_id=?').all(team_id) as Array<{user_id:number}>).map(m=>m.user_id) : [])]);
      if(priority==='critical'){
        const managers=db.prepare(`SELECT DISTINCT u.id FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN role_permissions rp ON rp.role_id=ur.role_id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE u.account_status='active' AND (u.role='admin' OR p.permission_key='manage_employees')`).all() as Array<{id:number}>;
        notify(db,id,'critical_incident',`Critical ticket #${id}: ${title.trim()}`,managers.map(m=>m.id));
      }
      db.exec('COMMIT');
      const row = db.prepare(`${SELECT_WITH_NAMES} WHERE t.id=?`).get(id) as unknown as TicketRow;
      return res.status(201).json({ ticket: present(db, actor, row) });
    } catch (error) { db.exec('ROLLBACK'); return res.status(400).json({ error: (error as Error).message }); }
  });

  router.post('/:id/actions', (req: AuthedRequest, res) => {
    const id = Number(req.params.id); const actor = req.user!;
    const row = db.prepare(`${SELECT_WITH_NAMES} WHERE t.id=?`).get(id) as unknown as TicketRow | undefined;
    if (!row) return res.status(404).json({ error: 'ticket not found' });
    if (!canSeeSensitive(db, actor, row)) return res.status(404).json({ error: 'ticket not found' });
    const { action, reason, resolution_description, resolution_attachment, assignee_id, team_id, priority, body } = req.body ?? {};
    const manager = isManager(db, actor); const assigned = isAssigned(db, actor, row);
    const now = new Date().toISOString();
    try {
      db.exec('BEGIN');
      if (action === 'assign') {
        const teamLeader = (team_id || row.team_id) && db.prepare('SELECT 1 FROM teams WHERE id=? AND leader_id=? AND is_active=1').get(team_id || row.team_id, actor.sub);
        if (!manager && !can(db, actor, 'assign_tickets') && !teamLeader) throw new Error('You are not allowed to assign this ticket');
        if ((!assignee_id && !team_id) || (assignee_id && team_id)) throw new Error('Choose one active employee or team');
        if (assignee_id) {
          const target=db.prepare("SELECT id,role FROM users WHERE id=? AND account_status='active'").get(assignee_id) as {id:number;role:'admin'|'agent'|'user'}|undefined;
          if (!target || (target.role!=='admin' && target.role!=='agent' && !hasPermission(db,target.id,target.role,'update_ticket_status'))) throw new Error('Assignee must be an active authorised support employee');
        }
        if (team_id && !db.prepare('SELECT id FROM teams WHERE id=? AND is_active=1').get(team_id)) throw new Error('Team is inactive or unavailable');
        const to = row.status === 'open' || row.status === 'reopened' ? 'assigned' : row.status;
        if (to !== row.status) transition(row.status, to);
        db.prepare('UPDATE tickets SET assignee_id=?,team_id=?,assigned_team_id=?,status=?,lifecycle_status=?,updated_at=? WHERE id=?').run(assignee_id || null, team_id || null, team_id || null, to, to, now, id);
        db.prepare('INSERT INTO ticket_assignments (ticket_id,assignee_id,team_id,assigned_by) VALUES (?,?,?,?)').run(id, assignee_id || null, team_id || null, actor.sub);
        addHistory(db, id, actor.sub, 'assigned', assignee_id ? `Assigned to employee ${assignee_id}` : `Assigned to team ${team_id}`);
        const teamMembers = team_id ? (db.prepare('SELECT user_id FROM team_members WHERE team_id=?').all(team_id) as Array<{user_id:number}>).map(m=>m.user_id) : [];
        notify(db, id, 'assigned', `Ticket #${id} was assigned`, [row.requester_id, row.affected_user_id, assignee_id ? Number(assignee_id) : null, ...teamMembers]);
      } else if (action === 'priority') {
        if (!can(db, actor, 'assign_tickets')) throw new Error('You cannot change ticket priority');
        if (!isValidPriority(priority)) throw new Error('Invalid priority');
        db.prepare('UPDATE tickets SET priority=?,priority_level=?,sla_due_at=?,updated_at=? WHERE id=?').run(priority, priority, computeSlaDueAt(priority,row.created_at),now,id);
        addHistory(db,id,actor.sub,'priority_changed',`Priority changed to ${priority}`);
        notify(db,id,'priority_changed',`Ticket #${id} priority changed`,[row.requester_id,row.affected_user_id,row.assignee_id]);
      } else if (action === 'status') {
        if (!assigned && !manager) throw new Error('Only the assigned support employee or a manager can change this status');
        if (!isValidStatus(req.body?.status) || !['in_progress','on_hold','escalated'].includes(req.body.status)) throw new Error('Choose In Progress, On Hold or Escalated');
        const target = req.body.status as Status; transition(row.status,target);
        const statusReason = typeof reason === 'string' ? reason.trim() : '';
        if (target === 'on_hold' && !statusReason) throw new Error('A reason is required when putting a ticket on hold');
        db.prepare('UPDATE tickets SET status=?,lifecycle_status=?,escalated_at=?,updated_at=? WHERE id=?')
          .run(target, target, target === 'escalated' ? now : null, now, id);
        addHistory(db,id,actor.sub,'status_changed',`${row.status} → ${target}${statusReason ? `: ${statusReason}` : ''}`);
        if (target === 'escalated') notify(db,id,'escalated',`Ticket #${id} was escalated`,[row.requester_id,row.affected_user_id,row.assignee_id,...(db.prepare("SELECT id FROM users WHERE role='admin' AND account_status='active'").all() as Array<{id:number}>).map(u=>u.id)]);
        else notify(db,id,'status_changed',`Ticket #${id} is now ${target.replace('_',' ')}`,[row.requester_id,row.affected_user_id,row.assignee_id]);
      } else if (action === 'resolve') {
        if (typeof resolution_description !== 'string' || resolution_description.trim().length < 8) throw new Error('Provide a clear resolution description (at least 8 characters)');
        const resolutionFiles=validateAttachments(resolution_attachment?[resolution_attachment]:[]);
        if (!assigned && !manager) throw new Error('Only the assigned support employee or a manager can resolve this ticket');
        transition(row.status,'resolved');
        db.prepare('UPDATE tickets SET status=\'resolved\',lifecycle_status=\'resolved\',resolution_description=?,resolved_by=?,resolved_at=?,updated_at=? WHERE id=?').run(resolution_description.trim(),actor.sub,now,now,id);
        saveAttachments(db,id,actor.sub,resolutionFiles,'resolution');
        addHistory(db,id,actor.sub,'resolved',resolution_description.trim());
        notify(db,id,'awaiting_confirmation',`Ticket #${id} was resolved and awaits confirmation`,[row.requester_id,row.affected_user_id]);
      } else if (action === 'confirm') {
        if (![row.requester_id,row.affected_user_id].includes(actor.sub) && !manager) throw new Error('Only the ticket creator, affected employee or manager can confirm closure');
        if (row.resolved_by === actor.sub) throw new Error('The resolver cannot confirm their own resolution');
        if (row.status !== 'resolved') throw new Error('Only a resolved ticket can be confirmed');
        if (manager && typeof reason !== 'string' || manager && !reason.trim()) throw new Error('Managers must provide an override reason');
        db.prepare('UPDATE tickets SET status=\'closed\',lifecycle_status=\'closed\',confirmed_by=?,confirmed_at=?,closure_method=?,closure_reason=?,updated_at=? WHERE id=?').run(actor.sub,now,manager?'manager_override':'manual',manager?reason.trim():null,now,id);
        addHistory(db,id,actor.sub,manager?'manager_closed':'confirmed',manager?`Manager override: ${reason.trim()}`:'Confirmed by employee');
        notify(db,id,'closed',`Ticket #${id} was closed`,[row.requester_id,row.affected_user_id,row.assignee_id]);
      } else if (action === 'reopen') {
        if (![row.requester_id,row.affected_user_id].includes(actor.sub) && !manager) throw new Error('Only the ticket creator, affected employee or manager can reopen this ticket');
        if (typeof reason !== 'string' || reason.trim().length < 5) throw new Error('Provide a reason for reopening (at least 5 characters)');
        if (!['resolved','closed'].includes(row.status)) throw new Error('Only resolved or closed tickets can be reopened');
        if (row.status !== 'closed') transition(row.status,'reopened');
        db.prepare('UPDATE tickets SET status=\'reopened\',lifecycle_status=\'reopened\',reopened_by=?,reopened_at=?,reopen_reason=?,reopening_reason=?,resolved_at=NULL,confirmed_at=NULL,confirmed_by=NULL,updated_at=? WHERE id=?').run(actor.sub,now,reason.trim(),reason.trim(),now,id);
        addHistory(db,id,actor.sub,'reopened',reason.trim());
        notify(db,id,'reopened',`Ticket #${id} was reopened: ${reason.trim()}`,[row.assignee_id,row.requester_id,row.affected_user_id,...(db.prepare("SELECT id FROM users WHERE role='admin' AND account_status='active'").all() as Array<{id:number}>).map(u=>u.id)]);
      } else if (action === 'manager_close') {
        if (!manager) throw new Error('Manager permission required');
        if (typeof reason !== 'string' || reason.trim().length < 5) throw new Error('Provide a manager override reason');
        if (row.status === 'closed') throw new Error('Ticket is already closed');
        db.prepare("UPDATE tickets SET status='closed',lifecycle_status='closed',resolved_at=COALESCE(resolved_at,?),confirmed_by=?,confirmed_at=?,closure_method='manager_override',closure_reason=?,updated_at=? WHERE id=?").run(now,actor.sub,now,reason.trim(),now,id);
        addHistory(db,id,actor.sub,'manager_closed',reason.trim());
        notify(db,id,'closed',`Ticket #${id} was closed by a manager`,[row.requester_id,row.affected_user_id,row.assignee_id]);
      } else if (action === 'internal_note') {
        if (!can(db,actor,'view_internal_notes')) throw new Error('Permission required to add internal notes');
        if (typeof body !== 'string' || !body.trim()) throw new Error('Internal note cannot be empty');
        db.prepare('INSERT INTO comments (ticket_id,author_id,body,is_internal) VALUES (?,?,?,1)').run(id,actor.sub,body.trim());
        addHistory(db,id,actor.sub,'internal_note','Internal note added');
      } else throw new Error('Unknown ticket action');

      db.exec('COMMIT');
      const updated = db.prepare(`${SELECT_WITH_NAMES} WHERE t.id=?`).get(id) as unknown as TicketRow;
      return res.json({ ticket: present(db,actor,updated) });
    } catch (error) {
      db.exec('ROLLBACK');
      const message=(error as Error).message;
      const status=message.startsWith('Illegal transition')?409:
        /permission|not allowed|Only the|Only an|cannot confirm|cannot resolve|cannot assign|cannot change/i.test(message)?403:400;
      return res.status(status).json({ error: message });
    }
  });

  // Compatibility endpoint for existing UI: limited to priority and status
  // progressions; resolution and closure require the reason-bearing actions.
  router.patch('/:id', (req: AuthedRequest, res) => {
    const id=Number(req.params.id); const row=db.prepare(`${SELECT_WITH_NAMES} WHERE t.id=?`).get(id) as unknown as TicketRow|undefined;
    if(!row) return res.status(404).json({error:'ticket not found'});
    const actor=req.user!; const {status,priority,assignee_id}=req.body??{};
    const manager=isManager(db,actor);
    if(!manager && !can(db,actor,'assign_tickets') && status!==undefined && status==='resolved') return res.status(403).json({error:'Only authorised support employees or managers can resolve tickets'});
    if(!manager && status===undefined && assignee_id!==undefined && !can(db,actor,'assign_tickets')) return res.status(403).json({error:'Only authorised users can assign tickets'});
    if(!manager && priority!==undefined && !can(db,actor,'assign_tickets')) return res.status(403).json({error:'Only authorised users can change priority'});
    if(status!==undefined) {
      if(!isValidStatus(status)) return res.status(400).json({error:'Invalid status'});
      if(status==='resolved') return res.status(400).json({error:'Use the resolve workflow action with a resolution description'});
      const assigned=isAssigned(db,actor,row);
      const assigningInSameRequest=assignee_id!==undefined && can(db,actor,'assign_tickets');
      if(!assigned&&!manager&&!assigningInSameRequest) return res.status(403).json({error:'Only the assigned employee or manager can change status'});
      try { transition(row.status,status); } catch(error) { return res.status(409).json({error:(error as Error).message}); }
      const now=new Date().toISOString();
      db.prepare('UPDATE tickets SET status=?,lifecycle_status=?,updated_at=? WHERE id=?').run(status,status,now,id);
      addHistory(db,id,actor.sub,'status_changed',`${row.status} → ${status}`);
    }
    if(priority!==undefined) {
      if(!isValidPriority(priority)) return res.status(400).json({error:'Invalid priority'});
      const now=new Date().toISOString();
      db.prepare('UPDATE tickets SET priority=?,priority_level=?,sla_due_at=?,updated_at=? WHERE id=?').run(priority,priority,computeSlaDueAt(priority,row.created_at),now,id);
      addHistory(db,id,actor.sub,'priority_changed',`Priority changed to ${priority}`);
    }
    if(assignee_id!==undefined) {
      if(assignee_id!==null){const target=db.prepare("SELECT id,role FROM users WHERE id=? AND account_status='active'").get(assignee_id) as {id:number;role:'admin'|'agent'|'user'}|undefined;if(!target||(target.role!=='admin'&&target.role!=='agent'&&!hasPermission(db,target.id,target.role,'update_ticket_status')))return res.status(400).json({error:'Assignee must be an active authorised support employee'});}
      const now=new Date().toISOString();
      const nextStatus = status ?? (assignee_id === null ? row.status : 'assigned');
      db.prepare('UPDATE tickets SET assignee_id=?,status=?,lifecycle_status=?,updated_at=? WHERE id=?')
        .run(assignee_id, nextStatus, nextStatus, now, id);
      db.prepare('INSERT INTO ticket_assignments (ticket_id,assignee_id,assigned_by) VALUES (?,?,?)').run(id,assignee_id,actor.sub);
      addHistory(db,id,actor.sub,'assigned',assignee_id?`Assigned to employee ${assignee_id}`:'Assignment removed');
    }
    const updated=db.prepare(`${SELECT_WITH_NAMES} WHERE t.id=?`).get(id) as unknown as TicketRow;
    return res.json({ticket:present(db,actor,updated)});
  });

  router.post('/:id/comments', (req: AuthedRequest, res) => {
    const row=db.prepare('SELECT * FROM tickets WHERE id=?').get(req.params.id) as unknown as TicketRow|undefined;
    if(!row) return res.status(404).json({error:'ticket not found'});
    if(!canSeeSensitive(db,req.user!,row)) return res.status(404).json({error:'ticket not found'});
    const actor=req.user!;
    if(!can(db,actor,'view_all_tickets') && row.requester_id!==actor.sub && row.affected_user_id!==actor.sub && row.assignee_id!==actor.sub && !isAssigned(db,actor,row)) return res.status(403).json({error:'not a ticket participant'});
    const body=req.body?.body;
    if(typeof body!=='string'||!body.trim()) return res.status(400).json({error:'comment body is required'});
    const info=db.prepare('INSERT INTO comments (ticket_id,author_id,body) VALUES (?,?,?)').run(req.params.id,actor.sub,body.trim());
    addHistory(db,Number(req.params.id),actor.sub,'comment_added','Progress update added');
    notify(db,row.id,'comment',`A new update was added to ticket #${row.id}`,[row.requester_id,row.affected_user_id,row.assignee_id].filter(uid=>uid!==actor.sub));
    const comment=db.prepare('SELECT c.*,u.name AS author_name,u.role AS author_role FROM comments c JOIN users u ON u.id=c.author_id WHERE c.id=?').get(info.lastInsertRowid);
    return res.status(201).json({comment});
  });

  return router;
}
