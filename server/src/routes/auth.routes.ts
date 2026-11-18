import { Router } from 'express';
import type { DB } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireAuth, type AuthedRequest } from '../auth.js';

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'agent' | 'user';
  password_hash: string;
  account_status?: 'active' | 'inactive';
  must_change_password?: number;
}

export function authRoutes(db: DB): Router {
  const router = Router();

  // Public employee registration is disabled. Managers provision accounts.
  router.post('/register', (req, res) => {
    return res.status(403).json({ error: 'Public registration is disabled. Contact your BankOps manager.' });
  });

  router.post('/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase()) as unknown as UserRow | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    if (user.account_status !== 'active') {
      return res.status(403).json({ error: 'account is inactive' });
    }
    const token = signToken({ sub: user.id, role: user.role, name: user.name });
    const roles = db.prepare(
      `SELECT r.role_key, r.name
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`,
    ).all(user.id);
    const permissions = db.prepare(
      `SELECT DISTINCT p.permission_key
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ?`,
    ).all(user.id);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        must_change_password: Boolean(user.must_change_password),
        roles,
        permissions: permissions.map((entry) =>
          String((entry as unknown as { permission_key: string }).permission_key),
        ),
      },
    });
  });

  router.get('/me', requireAuth, (req: AuthedRequest, res) => {
    const user = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.employee_id, u.phone,
                u.branch_id, u.department_id, u.designation, u.team_id,
                u.account_status, u.must_change_password, u.is_primary_manager,
                b.name AS branch_name, d.name AS department_name, t.name AS team_name
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN teams t ON t.id = u.team_id
         WHERE u.id = ?`,
      )
      .get(req.user!.sub);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const roles = db.prepare(
      `SELECT r.role_key, r.name
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`,
    ).all(req.user!.sub);
    const permissions = db.prepare(
      `SELECT DISTINCT p.permission_key
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ?`,
    ).all(req.user!.sub);
    return res.json({
      user: {
        ...(user as object),
        must_change_password: Boolean((user as { must_change_password?: number }).must_change_password),
        roles,
        permissions: permissions.map((entry) =>
          String((entry as unknown as { permission_key: string }).permission_key),
        ),
      },
    });
  });

  router.post('/change-password', requireAuth, (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof newPassword !== 'string' || newPassword.length < 12) {
      return res.status(400).json({ error: 'New password must be at least 12 characters' });
    }
    const user = db.prepare('SELECT password_hash,must_change_password FROM users WHERE id=?').get(req.user!.sub) as { password_hash: string; must_change_password: number } | undefined;
    if (!user) return res.status(404).json({ error: 'Employee not found' });
    if (!user.must_change_password && (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, user.password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').run(hashPassword(newPassword), req.user!.sub);
    return res.json({ changed: true });
  });

  return router;
}
