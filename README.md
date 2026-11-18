# BankOps

BankOps is a fictional bank's internal IT service desk. Employees can report workplace IT issues, while support staff and managers triage, assign, track, resolve, and close tickets. It is a portfolio/demo application: it does not connect to real banking systems or handle real customer data.

## Demo video

The repository currently has no recorded demo video. To add one, save the recording as `docs/bankops-demo.mp4` and replace this note with:

```markdown
<video src="docs/bankops-demo.mp4" controls width="800"></video>
```

GitHub may not play MP4 files embedded directly from the repository in every view. For a hosted clip, upload the video to a GitHub Release or GitHub user attachment and link it here.

## What the platform does

- **Organisation-wide ticket queue:** active employees can search, sort, and filter the ticket list by department, branch, category, priority, status, and assignee.
- **Simple ticket reporting:** title, description, and category are required; priority defaults to Medium. Department, affected employee, assignment, and attachments are optional.
- **Clear ownership:** the authenticated employee is the requester; affected employee, affected department, branch, assigned person, and assigned team are stored separately.
- **Ticket lifecycle:** Open → Assigned → In Progress → On Hold or Escalated → Resolved → Closed, with reopening and server-validated transitions.
- **Resolution confirmation:** assigned support staff record a resolution; the requester or affected employee can confirm it or reopen it with a reason. Managers can apply a reasoned override.
- **Assignment and administration:** managers and authorised support staff can assign or reassign employees and teams, adjust priority, and manage employee accounts and organisation data according to permissions.
- **Privacy controls:** restricted HR and cybersecurity tickets, internal notes, and their attachments are permission-checked by the API.
- **Audit and notifications:** ticket history records key actions; relevant employees receive in-app notifications for ticket events. Managers also see SLA risk/overdue alerts.
- **SLA visibility:** ticket deadlines and at-risk/breached states are calculated from priority.
- **Responsive interface:** dashboard, ticket queue, ticket details, notifications, employee administration, and password-change screens.

## Demo logins

These accounts are seeded the first time the server starts with an empty database. All use the demo-only password `Password123!`.

| Account | Role | Login |
|---|---|---|
| Kyle Admin | Manager / admin | `admin@helpdesk.local` |
| Lucy Achieng | IT support | `agent1@helpdesk.local` |
| Brian Kim | IT support | `agent2@helpdesk.local` |
| Anna Moore | Employee | `anna@corp.local` |
| James Otieno | Employee | `james@corp.local` |

The login page's **Demo manager sign in** button fills the manager credentials. Demo credentials are public by design: do not reuse them outside a local demo. If an existing database already contains users, seeding does not reset or replace those accounts. Remove the local database file to start with fresh demo data (this permanently deletes that local database).

## Technology

| Part | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| API | Node.js 24+, Express, TypeScript |
| Database | Node's built-in `node:sqlite` with schema migrations |
| Authentication | `node:crypto` scrypt password hashes and signed session tokens |
| API tests | Vitest and Supertest |

## Run locally

Requirements: Node.js 24 or later and npm. The SQLite database is created as `server/helpdesk.db` by default. Set `DB_PATH` to change it; set `PORT` to change the API port (default `4000`).

Terminal 1 — API:

```bash
cd server
npm install
npm run dev
```

Terminal 2 — web app:

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` requests to `http://127.0.0.1:4000`. The API health endpoint is `http://localhost:4000/api/health`.

## Ticket attachments and local file management

- Users can attach up to **three files per upload**, with a **5 MB per-file limit**.
- Accepted types: PNG, JPEG, WebP, PDF, plain text, and DOCX.
- Files are stored in SQLite as base64 data URIs in `ticket_attachments`; they are not written into a project folder or uploaded to a cloud service.
- Attachment metadata includes filename, MIME type, size, uploader, ticket, and attachment kind. Ticket deletion cascades to its attachment rows.
- Ticket detail access uses the same sensitive-ticket and internal-note permissions as ticket data.
- The local database contains employee accounts, tickets, comments, notifications, audit/history records, and attachment data. Keep `helpdesk.db` private and back it up as a single file when the server is stopped.
- The database, environment files, dependency folders, and build output are excluded by `.gitignore`. Do not commit real employee, customer, or banking data.

For a portfolio deployment, replace database-backed base64 storage with private object storage and short-lived authorised download links before handling larger files or real data.

## Project layout

```text
server/
  src/
    app.ts                 Express app and API route wiring
    auth.ts                Password hashing, signed tokens, auth/permission middleware
    db.ts                  SQLite schema, migrations, and database setup
    seed.ts                Fictional demo organisation and accounts
    sla.ts                 SLA rules and deadline calculations
    tickets.ts             Ticket categories, priorities, and status transitions
    routes/                Auth, tickets, stats, employee, organisation, notifications APIs
  tests/                   Unit and HTTP integration tests
web/
  src/
    App.tsx                Navigation and route setup
    lib/                   API client, authentication context, shared types
    pages/                 Dashboard, tickets, employees, notifications, login
    styles.css             Responsive BankOps theme
```

## Checks

```bash
cd server
npm test
npm run typecheck

cd ../web
npm run build
```

The API suite covers auth, permissions, ticket lifecycle, assignment, resolution confirmation/reopening, sensitive-ticket visibility, and audit/history behavior.

## API overview

All API routes are under `/api`.

| Route | Purpose |
|---|---|
| `/health` | API health check |
| `/auth/login`, `/auth/me`, `/auth/change-password` | Authentication and session profile |
| `/tickets` | Ticket list, filters, creation, details, comments, and workflow actions |
| `/employees`, `/organisation` | Employee directory and organisation data/admin operations |
| `/notifications` | In-app notifications and read state |
| `/stats`, `/stats/agents` | Dashboard metrics and support staffing |

Ticket mutations are checked against current user permissions on the API. UI visibility alone is not treated as authorisation.

## Notes and limitations

- The project uses fictional seed data and is for demonstration. It is not a production banking system.
- SLA calculations use elapsed time; business calendars and holidays are not configured.
- In-app notifications are implemented; email and SMS delivery are not.
- Optional automatic closure after a confirmation timeout is not implemented.
- Attachments live inside SQLite for simplicity, so the database grows with uploaded files.

## License

This repository retains its upstream MIT license. See [LICENSE](LICENSE) if included in the repository.
