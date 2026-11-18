import { Router } from 'express';
import type { DB } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../auth.js';

export function organisationRoutes(db: DB): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', (_req, res) => res.json({
    branches: db.prepare('SELECT id,name,code FROM branches WHERE is_active=1 ORDER BY name').all(),
    departments: db.prepare('SELECT id,name,branch_id FROM departments WHERE is_active=1 ORDER BY name').all(),
    teams: db.prepare('SELECT id,name,department_id,leader_id FROM teams WHERE is_active=1 ORDER BY name').all(),
    roles: db.prepare('SELECT id,name,description,department_id,role_key,is_protected FROM roles ORDER BY name').all(),
  }));
  router.get('/directory', (_req, res) => {
    const employees = db.prepare(`SELECT u.id,u.name,u.email,u.employee_id,u.department_id,u.branch_id,u.role,
      d.name AS department_name,b.name AS branch_name,u.team_id
      FROM users u LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN branches b ON b.id=u.branch_id
      WHERE u.account_status='active' ORDER BY u.name`).all();
    res.json({ employees });
  });

  router.post('/teams', requirePermission(db, 'create_teams'), (req: AuthedRequest, res) => {
    const { name, description = '', department_id = null, leader_id = null } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Team name is required' });
    try {
      const result = db.prepare('INSERT INTO teams (name,description,department_id,leader_id) VALUES (?,?,?,?)').run(name.trim(), description, department_id, leader_id);
      db.prepare('INSERT INTO audit_logs (actor_id,action,entity_type,entity_id) VALUES (?,\'team.created\',\'team\',?)').run(req.user!.sub, String(result.lastInsertRowid));
      return res.status(201).json({ team: db.prepare('SELECT * FROM teams WHERE id=?').get(result.lastInsertRowid) });
    } catch { return res.status(400).json({ error: 'Invalid department or team details' }); }
  });

  router.post('/roles', requirePermission(db, 'manage_roles'), (req: AuthedRequest, res) => {
    const { name, description = '', department_id = null, permissions = [] } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || !Array.isArray(permissions) || permissions.some((p: unknown) => typeof p !== 'string')) {
      return res.status(400).json({ error: 'Role name and permission keys are required' });
    }
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now().toString(36);
    try {
      db.exec('BEGIN');
      const role = db.prepare('INSERT INTO roles (name,description,department_id,role_key) VALUES (?,?,?,?)').run(name.trim(), description, department_id, slug);
      const link = db.prepare('INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE permission_key=?');
      for (const key of permissions as string[]) link.run(role.lastInsertRowid, key);
      db.prepare("INSERT INTO audit_logs (actor_id,action,entity_type,entity_id) VALUES (?,'role.created','role',?)").run(req.user!.sub, String(role.lastInsertRowid));
      db.exec('COMMIT');
      return res.status(201).json({ role: db.prepare('SELECT * FROM roles WHERE id=?').get(role.lastInsertRowid) });
    } catch {
      db.exec('ROLLBACK');
      return res.status(400).json({ error: 'Could not create role; check that the role name and permissions are valid' });
    }
  });
  router.get('/permissions', requirePermission(db, 'manage_roles'), (_req, res) => {
    res.json({ permissions: db.prepare('SELECT id,name,description,permission_key FROM permissions ORDER BY name').all() });
  });
  return router;
}
