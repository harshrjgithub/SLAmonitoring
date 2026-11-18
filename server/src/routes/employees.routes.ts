import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { DB } from '../db.js';
import { hashPassword, hasPermission, requireAuth, requirePermission, type AuthedRequest } from '../auth.js';

function audit(db: DB, actor: number, action: string, id: number, details = '') {
  db.prepare('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)')
    .run(actor, action, 'employee', String(id), details);
}

export function employeeRoutes(db: DB): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req: AuthedRequest, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = q ? `%${q}%` : '%';
    const canManage = hasPermission(db, req.user!.sub, req.user!.role, 'manage_employees');
    const rows = db.prepare(`
      SELECT u.id, u.name, u.email, u.employee_id, u.phone, u.designation,
        u.account_status, u.created_at, b.name AS branch_name,
        d.name AS department_name, t.name AS team_name, u.role
      FROM users u LEFT JOIN branches b ON b.id=u.branch_id
      LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN teams t ON t.id=u.team_id
      WHERE u.account_status = 'active'
        AND (? = 1 OR (u.name LIKE ? OR u.email LIKE ? OR COALESCE(u.employee_id, '') LIKE ?))
      ORDER BY u.name
    `).all(canManage ? 1 : q ? 0 : 1, pattern, pattern, pattern);
    res.json({ employees: rows });
  });

  router.post('/', requirePermission(db, 'manage_employees'), (req: AuthedRequest, res) => {
    const { name, email, employee_id, phone = null, branch_id = null, department_id = null,
      designation = '', team_id = null, role = 'user' } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof employee_id !== 'string' || !employee_id.trim()) {
      return res.status(400).json({ error: 'Full name, valid official email and employee ID are required' });
    }
    if (!['agent', 'user'].includes(role)) return res.status(400).json({ error: 'Choose an employee or IT support role; manager privileges are assigned separately' });
    const tempPassword = `Bk${randomBytes(12).toString('base64url')}!9`;
    try {
      const info = db.prepare(`INSERT INTO users
        (email, name, role, password_hash, employee_id, phone, branch_id, department_id, designation, team_id, must_change_password)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(email.trim().toLowerCase(), name.trim(), role, hashPassword(tempPassword), employee_id.trim(), phone,
          branch_id, department_id, String(designation).trim(), team_id);
      const id = Number(info.lastInsertRowid);
      if (team_id) db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(team_id, id);
      const roleKey = role === 'agent' ? 'it_support' : 'branch_employee';
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id,role_id) SELECT ?,id FROM roles WHERE role_key=?').run(id, roleKey);
      audit(db, req.user!.sub, 'employee.created', id, `employee_id=${employee_id.trim()}`);
      return res.status(201).json({ employee: { id, email: email.trim().toLowerCase(), name: name.trim(), employee_id }, temporaryPassword: tempPassword });
    } catch (error) {
      const msg = String(error);
      return res.status(msg.includes('UNIQUE') ? 409 : 400).json({ error: msg.includes('UNIQUE') ? 'Email or employee ID already exists' : 'Invalid branch, department or team' });
    }
  });

  router.patch('/:id', requirePermission(db, 'manage_employees'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const target = db.prepare('SELECT id, is_primary_manager FROM users WHERE id = ?').get(id) as { id: number; is_primary_manager: number } | undefined;
    if (!target) return res.status(404).json({ error: 'Employee not found' });
    if (target.is_primary_manager && req.body?.account_status === 'inactive') return res.status(403).json({ error: 'Primary manager account is protected' });
    const fields: Record<string, string> = { name: 'name', email: 'email', employee_id: 'employee_id', phone: 'phone', branch_id: 'branch_id', department_id: 'department_id', designation: 'designation', team_id: 'team_id', account_status: 'account_status' };
    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [key, column] of Object.entries(fields)) {
      if (!(key in (req.body ?? {}))) continue;
      const value = req.body[key];
      if (key === 'account_status' && !['active', 'inactive'].includes(value)) return res.status(400).json({ error: 'Invalid account status' });
      updates.push(`${column} = ?`); values.push(value === '' ? null : value);
    }
    if (req.body?.role !== undefined) {
      if (target.is_primary_manager) return res.status(403).json({ error: 'Primary manager privileges are protected' });
      if (!['agent', 'user'].includes(req.body.role)) return res.status(400).json({ error: 'Manager privileges cannot be assigned to an employee account' });
      updates.push('role = ?'); values.push(req.body.role);
    }
    if (!updates.length) return res.status(400).json({ error: 'No supported employee changes supplied' });
    try { db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values, id); }
    catch (error) { return res.status(String(error).includes('UNIQUE') ? 409 : 400).json({ error: 'Could not update employee details' }); }
    if ('team_id' in req.body) {
      db.prepare('DELETE FROM team_members WHERE user_id = ?').run(id);
      if (req.body.team_id) db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(req.body.team_id, id);
    }
    if (req.body?.role !== undefined) {
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
      const roleKey = req.body.role === 'agent' ? 'it_support' : 'branch_employee';
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id,role_id) SELECT ?,id FROM roles WHERE role_key=?').run(id, roleKey);
    }
    audit(db, req.user!.sub, req.body.account_status === 'inactive' ? 'employee.deactivated' : 'employee.updated', id);
    return res.json({ employee: db.prepare('SELECT id,name,email,employee_id,phone,branch_id,department_id,designation,team_id,account_status,role FROM users WHERE id = ?').get(id) });
  });

  router.get('/audit', requirePermission(db, 'view_audit_logs'), (_req, res) => {
    const logs = db.prepare(`SELECT a.*, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 200`).all();
    return res.json({ logs });
  });
  return router;
}
