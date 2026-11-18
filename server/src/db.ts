// SQLite persistence via Node's built-in node:sqlite (no native modules).
// A single synchronous connection is plenty for a helpdesk-sized workload and
// keeps the code simple. Pass ':memory:' in tests for an isolated fresh DB.

// Loaded via createRequire rather than a static `import ... from 'node:sqlite'`
// so bundling test runners (Vitest/Vite) treat it as a native builtin instead
// of trying to resolve it as an npm package.
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export type DB = InstanceType<typeof DatabaseSync>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','agent','user')),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  address    TEXT NOT NULL DEFAULT '',
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  branch_id  INTEGER REFERENCES branches(id),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  department_id INTEGER REFERENCES departments(id),
  leader_id   INTEGER REFERENCES users(id),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  department_id INTEGER REFERENCES departments(id),
  role_key    TEXT NOT NULL UNIQUE,
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permission_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','assigned','in_progress','on_hold','escalated','resolved','closed','reopened')),
  priority    TEXT NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('critical','urgent','high','medium','normal','low')),
  category    TEXT NOT NULL DEFAULT 'other',
  requester_id INTEGER NOT NULL REFERENCES users(id),
  assignee_id  INTEGER REFERENCES users(id),
  sla_due_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT,
  affected_user_id INTEGER REFERENCES users(id),
  resolution_description TEXT,
  resolved_by INTEGER REFERENCES users(id),
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at TEXT,
  reopened_by INTEGER REFERENCES users(id),
  reopened_at TEXT,
  reopen_reason TEXT,
  closure_method TEXT NOT NULL DEFAULT 'manual' CHECK (closure_method IN ('manual','manager_override','automatic')),
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','restricted'))
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  assignee_id INTEGER REFERENCES users(id),
  team_id     INTEGER REFERENCES teams(id),
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (assignee_id IS NOT NULL OR team_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS ticket_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  file_name   TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes >= 0),
  file_url    TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'attachment'
                CHECK (kind IN ('attachment','resolution','internal')),
  is_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sla_rules (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  priority            TEXT NOT NULL UNIQUE CHECK (priority IN ('critical','urgent','high','medium','normal','low')),
  resolution_minutes  INTEGER NOT NULL CHECK (resolution_minutes > 0),
  at_risk_percent     INTEGER NOT NULL DEFAULT 25 CHECK (at_risk_percent BETWEEN 1 AND 100),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  details     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_comments_ticket  ON comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_departments_branch ON departments(branch_id);
CREATE INDEX IF NOT EXISTS idx_teams_department ON teams(department_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_ticket_assignments_ticket ON ticket_assignments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
`;

function addColumnIfMissing(db: DB, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateUserOrganisationColumns(db: DB): void {
  addColumnIfMissing(db, 'users', 'employee_id', 'TEXT');
  addColumnIfMissing(db, 'users', 'phone', 'TEXT');
  addColumnIfMissing(db, 'users', 'branch_id', 'INTEGER REFERENCES branches(id)');
  addColumnIfMissing(db, 'users', 'department_id', 'INTEGER REFERENCES departments(id)');
  addColumnIfMissing(db, 'users', 'designation', 'TEXT');
  addColumnIfMissing(db, 'users', 'team_id', 'INTEGER REFERENCES teams(id)');
  addColumnIfMissing(db, 'users', 'account_status', "TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','inactive'))");
  addColumnIfMissing(db, 'users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1))');
  addColumnIfMissing(db, 'users', 'is_primary_manager', 'INTEGER NOT NULL DEFAULT 0 CHECK (is_primary_manager IN (0,1))');
}

function migrateTicketOrganisationColumns(db: DB): void {
  addColumnIfMissing(db, 'tickets', 'branch_id', 'INTEGER REFERENCES branches(id)');
  addColumnIfMissing(db, 'tickets', 'department_id', 'INTEGER REFERENCES departments(id)');
  addColumnIfMissing(db, 'tickets', 'team_id', 'INTEGER REFERENCES teams(id)');
  addColumnIfMissing(db, 'tickets', 'affected_system', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'escalated_at', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'internal_notes', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'tickets', 'lifecycle_status', "TEXT NOT NULL DEFAULT 'open'");
  addColumnIfMissing(db, 'tickets', 'priority_level', "TEXT NOT NULL DEFAULT 'medium'");
  addColumnIfMissing(db, 'tickets', 'affected_employee_id', 'INTEGER REFERENCES users(id)');
  addColumnIfMissing(db, 'tickets', 'assigned_team_id', 'INTEGER REFERENCES teams(id)');
  addColumnIfMissing(db, 'tickets', 'resolution_description', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'resolved_by', 'INTEGER REFERENCES users(id)');
  addColumnIfMissing(db, 'tickets', 'confirmed_by', 'INTEGER REFERENCES users(id)');
  addColumnIfMissing(db, 'tickets', 'confirmed_at', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'reopened_by', 'INTEGER REFERENCES users(id)');
  addColumnIfMissing(db, 'tickets', 'reopened_at', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'reopening_reason', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'closure_method', "TEXT CHECK (closure_method IN ('manual','automatic','manager_override'))");
  addColumnIfMissing(db, 'tickets', 'closure_reason', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'is_sensitive', 'INTEGER NOT NULL DEFAULT 0 CHECK (is_sensitive IN (0,1))');
  addColumnIfMissing(db, 'tickets', 'affected_user_id', 'INTEGER REFERENCES users(id)');
  addColumnIfMissing(db, 'tickets', 'resolution_description', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'resolved_by', 'INTEGER REFERENCES users(id)');
  addColumnIfMissing(db, 'tickets', 'confirmed_by', 'INTEGER REFERENCES users(id)');
  addColumnIfMissing(db, 'tickets', 'confirmed_at', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'reopened_by', 'INTEGER REFERENCES users(id)');
  addColumnIfMissing(db, 'tickets', 'reopened_at', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'reopen_reason', 'TEXT');
  addColumnIfMissing(db, 'tickets', 'closure_method', "TEXT NOT NULL DEFAULT 'manual'");
  addColumnIfMissing(db, 'tickets', 'sensitivity', "TEXT NOT NULL DEFAULT 'normal'");
  addColumnIfMissing(db, 'comments', 'is_internal', 'INTEGER NOT NULL DEFAULT 0');
}

function migrateTicketStatusConstraint(db: DB): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tickets'").get() as { sql: string } | undefined;
  if (!row?.sql.includes("'escalated'") || !row.sql.includes("'critical'") || !row.sql.includes("'medium'")) {
    // Rebuild without losing existing rows. Child tables keep their references
    // to the canonical `tickets` name while FK checks are briefly suspended.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
    db.exec(`CREATE TABLE tickets_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','in_progress','on_hold','escalated','resolved','closed','reopened')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('critical','urgent','high','medium','normal','low')),
      category TEXT NOT NULL DEFAULT 'other', requester_id INTEGER NOT NULL REFERENCES users(id),
      assignee_id INTEGER REFERENCES users(id), sla_due_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT,
      branch_id INTEGER REFERENCES branches(id), department_id INTEGER REFERENCES departments(id),
      team_id INTEGER REFERENCES teams(id), affected_system TEXT, escalated_at TEXT, internal_notes TEXT NOT NULL DEFAULT '',
      affected_user_id INTEGER REFERENCES users(id), resolution_description TEXT, resolved_by INTEGER REFERENCES users(id),
      confirmed_by INTEGER REFERENCES users(id), confirmed_at TEXT, reopened_by INTEGER REFERENCES users(id),
      reopened_at TEXT, reopen_reason TEXT, closure_method TEXT NOT NULL DEFAULT 'manual',
      sensitivity TEXT NOT NULL DEFAULT 'normal', lifecycle_status TEXT NOT NULL DEFAULT 'open',
      priority_level TEXT NOT NULL DEFAULT 'medium', affected_employee_id INTEGER REFERENCES users(id),
      assigned_team_id INTEGER REFERENCES teams(id), reopening_reason TEXT,
      closure_reason TEXT, is_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(is_sensitive IN (0,1))
    );
    INSERT INTO tickets_next SELECT id,title,description,
      CASE WHEN status='new' THEN 'open' ELSE status END,
      priority,category,requester_id,assignee_id,sla_due_at,created_at,updated_at,resolved_at,
      branch_id,department_id,team_id,affected_system,escalated_at,internal_notes,
      affected_user_id,resolution_description,resolved_by,confirmed_by,confirmed_at,reopened_by,reopened_at,reopen_reason,closure_method,sensitivity,
      lifecycle_status,priority_level,affected_employee_id,assigned_team_id,reopening_reason,closure_reason,is_sensitive
      FROM tickets;
    DROP TABLE tickets;
    ALTER TABLE tickets_next RENAME TO tickets;`);
    db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

export function createDb(path = ':memory:'): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrateUserOrganisationColumns(db);
  migrateTicketOrganisationColumns(db);
  db.exec(`
    UPDATE tickets SET lifecycle_status = CASE status
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'on_hold' THEN 'on_hold'
      WHEN 'resolved' THEN 'resolved'
      WHEN 'closed' THEN 'closed'
      ELSE 'open'
    END
    WHERE lifecycle_status = 'open' AND status != 'open';
    UPDATE tickets SET priority_level = CASE priority
      WHEN 'urgent' THEN 'critical'
      WHEN 'normal' THEN 'medium'
      ELSE priority
    END
    WHERE priority_level = 'medium';
  `);
  migrateTicketStatusConstraint(db);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id
      ON users(employee_id) WHERE employee_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status);
    CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id);
    CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
    CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_branch ON tickets(branch_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_department ON tickets(department_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_team ON tickets(team_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_lifecycle_status ON tickets(lifecycle_status);
    CREATE INDEX IF NOT EXISTS idx_tickets_affected_employee ON tickets(affected_employee_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_assigned_team ON tickets(assigned_team_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON ticket_attachments(ticket_id);
  `);
  return db;
}
