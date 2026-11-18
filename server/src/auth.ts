// Authentication primitives built on Node's crypto — no external dependencies.
//  * Passwords: scrypt with a per-user random salt (stored as scrypt$salt$hash).
//  * Sessions:  compact HMAC-SHA256 signed tokens (JWT-style) so the API is
//    stateless. Not a full JWT library, but the same idea and format.

import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DB } from './db.js';

export type Role = 'admin' | 'agent' | 'user';

const SCRYPT_KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(plain, salt, expected.length);
  // Lengths match by construction, but guard anyway before timingSafeEqual.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// --- Token (JWT-shaped: header.payload.signature, all base64url) ------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface TokenPayload {
  sub: number; // user id
  role: Role;
  name: string;
  exp: number; // unix seconds
}

export function requirePermission(db: DB, ...permissions: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    // The original administrator remains the bootstrap authority. Other
    // accounts are checked against their current database role assignments.
    const user = db.prepare('SELECT role, account_status, is_primary_manager FROM users WHERE id = ?')
      .get(req.user.sub) as { role: string; account_status: string; is_primary_manager: number } | undefined;
    if (!user || user.account_status !== 'active') {
      res.status(401).json({ error: 'Account is inactive' });
      return;
    }
    if (user.role === 'admin' || user.is_primary_manager === 1) {
      next();
      return;
    }
    const allowed = permissions.some((permission) =>
      hasPermission(db, req.user!.sub, req.user!.role, permission),
    );
    if (!allowed) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

function getSecret(): string {
  return process.env.JWT_SECRET ?? 'dev-insecure-secret-change-me';
}

export function signToken(
  payload: Omit<TokenPayload, 'exp'>,
  ttlSeconds = 60 * 60 * 8,
): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  );
  const sig = base64url(createHmac('sha256', getSecret()).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload {
  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('Malformed token');
  const [header, body, sig] = segments;

  const expectedSig = base64url(
    createHmac('sha256', getSecret()).update(`${header}.${body}`).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Bad signature');
  }

  const payload = JSON.parse(base64urlDecode(body).toString()) as TokenPayload;
  if (payload.exp * 1000 < Date.now()) throw new Error('Token expired');
  return payload;
}

// --- Express middleware -----------------------------------------------------

export interface AuthedRequest extends Request {
  user?: TokenPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    req.user = verifyToken(header.slice(7));
    // Check current account state on each request so deactivation takes effect
    // immediately, even if an employee still has a valid bearer token.
    const db = (req.app as unknown as { locals: { db?: import('./db.js').DB } }).locals.db;
    const current = db?.prepare('SELECT account_status, must_change_password FROM users WHERE id = ?')
      .get(req.user.sub) as { account_status: string; must_change_password: number } | undefined;
    if (!current || current.account_status !== 'active') {
      res.status(401).json({ error: 'Account is inactive' });
      return;
    }
    if (current.must_change_password && !req.path.endsWith('/change-password') && !req.path.endsWith('/me')) {
      res.status(403).json({ error: 'You must change your temporary password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Restrict a route to specific roles. Use after requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export const LEGACY_PERMISSION_KEYS: Record<Role, readonly string[]> = {
  admin: ['*'],
  agent: [
    'view_dashboard',
    'create_tickets',
    'view_assigned_tickets',
    'assign_tickets',
    'update_ticket_status',
    'resolve_tickets',
  ],
  user: ['create_tickets', 'view_assigned_tickets'],
};

export function hasPermission(db: DB, userId: number, legacyRole: Role, permission: string): boolean {
  if (legacyRole === 'admin') return true;

  const customPermission = db.prepare(
    `SELECT 1
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ? AND p.permission_key = ?
     LIMIT 1`,
  ).get(userId, permission);
  if (customPermission) return true;

  return LEGACY_PERMISSION_KEYS[legacyRole].includes(permission);
}
