import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { hasPermission } from '../src/auth.js';

describe('BankOps foundation schema', () => {
  it('creates organisational, role, permission and audit foundations', () => {
    const db = createDb(':memory:');
    seed(db);

    expect((db.prepare('SELECT COUNT(*) AS n FROM branches').get() as { n: number }).n).toBeGreaterThan(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM departments').get() as { n: number }).n).toBeGreaterThan(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number }).n).toBeGreaterThan(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM roles').get() as { n: number }).n).toBeGreaterThan(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM permissions').get() as { n: number }).n).toBeGreaterThanOrEqual(12);
    expect((db.prepare('SELECT COUNT(*) AS n FROM user_roles').get() as { n: number }).n).toBeGreaterThan(0);
  });

  it('grants permissions through role assignments and preserves legacy admin authority', () => {
    const db = createDb(':memory:');
    seed(db);

    const agent = db.prepare("SELECT id FROM users WHERE role = 'agent' ORDER BY id").get() as { id: number };
    expect(hasPermission(db, agent.id, 'agent', 'update_ticket_status')).toBe(true);
    expect(hasPermission(db, agent.id, 'agent', 'manage_roles')).toBe(false);

    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get() as { id: number };
    expect(hasPermission(db, admin.id, 'admin', 'manage_roles')).toBe(true);
  });

  it('adds organisation columns to users and tickets without rebuilding existing tables', () => {
    const db = createDb(':memory:');
    seed(db);

    const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    expect(userColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'employee_id', 'branch_id', 'department_id', 'team_id',
      'account_status', 'must_change_password', 'is_primary_manager',
    ]));

    const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all() as Array<{ name: string }>;
    expect(ticketColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'branch_id', 'department_id', 'team_id', 'affected_system',
      'escalated_at', 'internal_notes',
    ]));
  });
});
