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

export function seed(db: DB): SeedResult {
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
