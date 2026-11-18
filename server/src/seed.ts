// Seed a database with demo users and tickets so the app is explorable
// immediately. Idempotent: does nothing if users already exist.

import type { DB } from './db.js';
import { hashPassword } from './auth.js';
import { computeSlaDueAt, type Priority } from './sla.js';
import type { Category, Status } from './tickets.js';

export interface SeedResult {
  users: number;
  tickets: number;
}

const DEMO_PASSWORD = 'Password123!';

function ensureFoundation(db: DB): void {
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT OR IGNORE INTO branches (id, name, code, address)
       VALUES (1, 'Mumbai Central Branch', 'MH-MUM-CENTRAL', 'Fictional Mumbai Central office')`,
    ).run();

    db.prepare(
      `INSERT OR IGNORE INTO departments (id, name, description, branch_id)
       VALUES (1, 'Information Technology', 'Internal banking technology operations', 1),
              (2, 'Human Resources', 'People operations and employee support', 1),
              (3, 'Banking Operations', 'Branch and operational support', 1)`,
    ).run();

    db.prepare(
      `INSERT OR IGNORE INTO teams (id, name, description, department_id)
       VALUES (1, 'IT Support', 'Endpoint, access and general IT support', 1),
              (2, 'Network Administration', 'Branch and network connectivity support', 1),
              (3, 'Application Support', 'Internal banking application support', 1),
              (4, 'Cybersecurity', 'Security incidents and suspicious activity', 1)`,
    ).run();

    const permissions: Array<[string, string, string]> = [
      ['view_dashboard', 'View dashboard', 'View organisational dashboard and operational statistics'],
      ['create_tickets', 'Create tickets', 'Raise employee support tickets'],
      ['view_all_tickets', 'View all tickets', 'View tickets across the organisation'],
      ['view_assigned_tickets', 'View assigned tickets', 'View tickets assigned to the employee or team'],
      ['assign_tickets', 'Assign tickets', 'Assign tickets to employees or teams'],
      ['update_ticket_status', 'Update ticket status', 'Progress and resolve assigned tickets'],
      ['resolve_tickets', 'Resolve tickets', 'Resolve and close tickets'],
      ['manage_employees', 'Manage employees', 'Create and manage employee accounts'],
      ['create_teams', 'Create teams', 'Create and maintain teams'],
      ['manage_roles', 'Manage roles', 'Create and modify roles and permissions'],
      ['view_audit_logs', 'View audit logs', 'View administrative and operational audit records'],
      ['manage_system_settings', 'Manage system settings', 'Configure organisation and system settings'],
      ['view_sensitive_tickets', 'View sensitive tickets', 'View restricted HR and cybersecurity tickets'],
      ['view_internal_notes', 'View internal notes', 'Read and add staff-only ticket notes'],
    ];
    const insertPermission = db.prepare(
      'INSERT OR IGNORE INTO permissions (permission_key, name, description) VALUES (?, ?, ?)',
    );
    for (const permission of permissions) insertPermission.run(...permission);

    db.prepare(
      `INSERT OR IGNORE INTO roles (name, description, department_id, role_key, is_system, is_protected)
       VALUES ('IT Manager', 'Primary bank IT administrator', 1, 'it_manager', 1, 1),
              ('IT Support Executive', 'Front-line internal IT support', 1, 'it_support', 1, 0),
              ('Branch Employee', 'Standard employee ticket requester', 3, 'branch_employee', 1, 0)`,
    ).run();

    const allPermissionRows = db.prepare('SELECT id FROM permissions').all() as Array<{ id: number }>;
    const managerRole = db.prepare("SELECT id FROM roles WHERE role_key = 'it_manager'").get() as { id: number };
    const insertRolePermission = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
    );
    for (const permission of allPermissionRows) {
      insertRolePermission.run(managerRole.id, permission.id);
    }

    const supportKeys = [
      'view_dashboard', 'create_tickets', 'view_assigned_tickets',
      'assign_tickets', 'update_ticket_status', 'resolve_tickets',
    ];
    const supportRole = db.prepare("SELECT id FROM roles WHERE role_key = 'it_support'").get() as { id: number };
    for (const key of supportKeys) {
      const permission = db.prepare('SELECT id FROM permissions WHERE permission_key = ?').get(key) as { id: number };
      insertRolePermission.run(supportRole.id, permission.id);
    }

    const employeeRole = db.prepare("SELECT id FROM roles WHERE role_key = 'branch_employee'").get() as { id: number };
    for (const key of ['create_tickets', 'view_assigned_tickets']) {
      const permission = db.prepare('SELECT id FROM permissions WHERE permission_key = ?').get(key) as { id: number };
      insertRolePermission.run(employeeRole.id, permission.id);
    }

    db.prepare(
      `INSERT OR IGNORE INTO user_roles (user_id, role_id)
       SELECT u.id,
              (SELECT r.id FROM roles r WHERE r.role_key =
                CASE u.role WHEN 'admin' THEN 'it_manager'
                            WHEN 'agent' THEN 'it_support'
                            ELSE 'branch_employee' END)
       FROM users u`,
    ).run();

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function seed(db: DB): SeedResult {
  ensureFoundation(db);
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (existing.n > 0) return { users: 0, tickets: 0 };

  const insertUser = db.prepare(
    'INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)',
  );
  const users: Array<[string, string, string]> = [
    ['admin@helpdesk.local', 'Kyle Admin', 'admin'],
    ['agent1@helpdesk.local', 'Lucy Achieng', 'agent'],
    ['agent2@helpdesk.local', 'Brian Kim', 'agent'],
    ['anna@corp.local', 'Anna Moore', 'user'],
    ['james@corp.local', 'James Otieno', 'user'],
  ];
  const userIds: number[] = [];
  for (const [email, name, role] of users) {
    const info = insertUser.run(email, name, role, hashPassword(DEMO_PASSWORD));
    userIds.push(Number(info.lastInsertRowid));
  }

  const [adminId, agent1, agent2, anna, james] = userIds;

  db.prepare(
    `UPDATE users
     SET employee_id = CASE id
           WHEN ? THEN 'BANK-ADMIN-001'
           WHEN ? THEN 'BANK-IT-001'
           WHEN ? THEN 'BANK-IT-002'
           WHEN ? THEN 'BANK-HR-001'
           WHEN ? THEN 'BANK-OPS-001'
         END,
         branch_id = 1,
         department_id = CASE role
           WHEN 'admin' THEN 1
           WHEN 'agent' THEN 1
           ELSE 3
         END,
         team_id = CASE id
           WHEN ? THEN 1
           WHEN ? THEN 2
           WHEN ? THEN 3
           ELSE NULL
         END,
         designation = CASE role
           WHEN 'admin' THEN 'IT Manager'
           WHEN 'agent' THEN 'IT Support Executive'
           ELSE 'Branch Employee'
         END,
         account_status = 'active',
         must_change_password = 0,
         is_primary_manager = CASE WHEN id = ? THEN 1 ELSE 0 END`,
  ).run(
    adminId, agent1, agent2, anna, james,
    adminId, agent1, agent2,
    adminId,
  );

  db.prepare(
    `INSERT OR IGNORE INTO team_members (team_id, user_id)
     SELECT team_id, id FROM users WHERE team_id IS NOT NULL`,
  ).run();
  db.prepare(
    `UPDATE teams SET leader_id = ? WHERE id = 1`,
  ).run(agent1);
  db.prepare(
    `INSERT OR IGNORE INTO user_roles (user_id, role_id)
     SELECT u.id,
            (SELECT r.id FROM roles r WHERE r.role_key =
              CASE u.role WHEN 'admin' THEN 'it_manager'
                          WHEN 'agent' THEN 'it_support'
                          ELSE 'branch_employee' END)
     FROM users u`,
  ).run();

  const insertTicket = db.prepare(
    `INSERT INTO tickets
       (title, description, status, priority, category, requester_id, assignee_id,
        sla_due_at, created_at, updated_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  interface SeedTicket {
    title: string;
    description: string;
    status: Status;
    priority: Priority;
    category: Category;
    requester: number;
    assignee: number | null;
    createdHoursAgo: number;
    resolvedHoursAgo?: number;
  }

  const tickets: SeedTicket[] = [
    {
      title: 'Cannot log in to email after password change',
      description: 'Outlook keeps prompting for credentials since I reset my password this morning.',
      status: 'open', priority: 'high', category: 'email',
      requester: anna, assignee: null, createdHoursAgo: 1,
    },
    {
      title: 'Laptop will not connect to office Wi-Fi',
      description: 'Shows "connected, no internet". Ethernet works fine.',
      status: 'in_progress', priority: 'normal', category: 'network',
      requester: james, assignee: agent1, createdHoursAgo: 5,
    },
    {
      title: 'Request: install Adobe Acrobat Pro',
      description: 'Need it to edit contract PDFs for the sales team.',
      status: 'on_hold', priority: 'low', category: 'software',
      requester: anna, assignee: agent2, createdHoursAgo: 30,
    },
    {
      title: 'Shared drive S: missing after restart',
      description: 'The Sales share is gone this morning for the whole team.',
      status: 'in_progress', priority: 'urgent', category: 'account_access',
      requester: james, assignee: agent1, createdHoursAgo: 3,
    },
    {
      title: 'Monitor flickering intermittently',
      description: 'Second monitor flickers every few minutes. Cable reseated already.',
      status: 'resolved', priority: 'normal', category: 'hardware',
      requester: anna, assignee: agent2, createdHoursAgo: 48, resolvedHoursAgo: 20,
    },
    {
      title: 'New hire account setup for Grace Wanjiku',
      description: 'Starts Monday, needs AD account, email, and Sales group access.',
      status: 'closed', priority: 'normal', category: 'account_access',
      requester: adminId, assignee: agent1, createdHoursAgo: 120, resolvedHoursAgo: 96,
    },
  ];

  for (const t of tickets) {
    const createdAt = hoursAgo(t.createdHoursAgo);
    insertTicket.run(
      t.title, t.description, t.status, t.priority, t.category,
      t.requester, t.assignee,
      computeSlaDueAt(t.priority, createdAt),
      createdAt, createdAt,
      t.resolvedHoursAgo !== undefined ? hoursAgo(t.resolvedHoursAgo) : null,
    );
  }

  const insertComment = db.prepare(
    'INSERT INTO comments (ticket_id, author_id, body, created_at) VALUES (?, ?, ?, ?)',
  );
  insertComment.run(2, agent1, 'Thanks — can you tell me if other devices connect to the Wi-Fi?', hoursAgo(4));
  insertComment.run(2, james, 'Yes, my phone connects fine on the same network.', hoursAgo(3));
  insertComment.run(4, agent1, 'Investigating the file server now, will update shortly.', hoursAgo(2));

  return { users: userIds.length, tickets: tickets.length };
}

export { DEMO_PASSWORD };
