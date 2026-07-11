import { Router } from 'express';
import type { DB } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireAuth, type AuthedRequest } from '../auth.js';

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'agent' | 'user';
  password_hash: string;
}

export function authRoutes(db: DB): Router {
  const router = Router();

  // Register a new end-user account. Agent/admin accounts are provisioned by an admin.
  router.post('/register', (req, res) => {
    const { email, name, password } = req.body ?? {};
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'email, name and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) return res.status(409).json({ error: 'email already registered' });

    const info = db
      .prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)')
      .run(email, name, 'user', hashPassword(password));

    const token = signToken({ sub: Number(info.lastInsertRowid), role: 'user', name });
    return res.status(201).json({ token, user: { id: Number(info.lastInsertRowid), email, name, role: 'user' } });
  });

  router.post('/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as UserRow | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const token = signToken({ sub: user.id, role: user.role, name: user.name });
    return res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  router.get('/me', requireAuth, (req: AuthedRequest, res) => {
    const user = db
      .prepare('SELECT id, email, name, role FROM users WHERE id = ?')
      .get(req.user!.sub);
    if (!user) return res.status(404).json({ error: 'user not found' });
    return res.json({ user });
  });

  return router;
}
