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
