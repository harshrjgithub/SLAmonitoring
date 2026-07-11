import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../src/auth.js';

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('S3cure!pass');
    expect(verifyPassword('S3cure!pass', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('S3cure!pass');
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('produces a different hash each time (random salt)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('rejects a malformed stored hash', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false);
    expect(verifyPassword('x', 'md5$salt$hash')).toBe(false);
  });
});

describe('token signing & verification', () => {
  it('round-trips a payload', () => {
    const token = signToken({ sub: 7, role: 'agent', name: 'Lucy' });
    const payload = verifyToken(token);
    expect(payload.sub).toBe(7);
    expect(payload.role).toBe('agent');
    expect(payload.name).toBe('Lucy');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a tampered payload', () => {
    const token = signToken({ sub: 1, role: 'user', name: 'Anna' });
    const [header, , sig] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ sub: 1, role: 'admin', name: 'Anna', exp: 9999999999 }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const forged = `${header}.${forgedBody}.${sig}`;
    expect(() => verifyToken(forged)).toThrow(/signature/i);
  });

  it('rejects an expired token', () => {
    const token = signToken({ sub: 1, role: 'user', name: 'Anna' }, -10);
    expect(() => verifyToken(token)).toThrow(/expired/i);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyToken('not.a.valid.token')).toThrow();
    expect(() => verifyToken('only-one-part')).toThrow(/Malformed/);
  });
});
