# 🎫 HelpDeskHQ

[![CI](https://github.com/kyle21pixel/helpdesk-hq/actions/workflows/ci.yml/badge.svg)](https://github.com/kyle21pixel/helpdesk-hq/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Node](https://img.shields.io/badge/Node-24-339933?logo=node.js&logoColor=white)
![Tests](https://img.shields.io/badge/tests-42%20passing-brightgreen)
![License](https://img.shields.io/badge/License-MIT-blue)

A full-stack **IT support ticketing system** — think a lightweight ServiceNow / Zendesk for an internal helpdesk. Built end-to-end in TypeScript: a REST API with role-based access and **SLA tracking**, and a React single-page app for raising, triaging, and resolving tickets.

> Built to demonstrate that I can combine **IT domain knowledge** (ticket lifecycles, SLAs, agent workflows) with **real software engineering** (typed end-to-end, tested, CI-validated). Companion to my [Active Directory homelab](https://github.com/kyle21pixel/active-directory-homelab) and [ITOpsKit](https://github.com/kyle21pixel/ITOpsKit).

---

## Features

- 🔐 **Authentication & roles** — register/login with JWT-style tokens; three roles (**user**, **agent**, **admin**) with enforced permissions
- 🎫 **Ticket lifecycle** — a proper **status state machine** (`open → in_progress → on_hold → resolved → closed`, with reopen) that rejects illegal transitions
- ⏱️ **SLA tracking** — every ticket gets a priority-based resolution deadline and is classified **on-track / at-risk / breached / met** in real time
- 👥 **Agent workflows** — assign tickets, change priority, progress status; end-users only see and comment on their own tickets
- 💬 **Threaded comments** between requesters and agents
- 📊 **Dashboard** — open/unassigned counts, SLA breach/at-risk metrics, and status/priority breakdowns
- 🔎 **Filtering** by status, priority, and assignment (mine / unassigned)

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| API | Node + **Express** (TypeScript) | ubiquitous, easy to read |
| Database | **`node:sqlite`** (built-in) | zero native modules — clones and runs with no DB server to install |
| Auth | **`node:crypto`** (scrypt + HMAC) | no auth dependencies; demonstrates the primitives behind password hashing and signed tokens |
| Frontend | **React 18 + Vite** (TypeScript) | fast, modern SPA tooling |
| Tests | **Vitest + Supertest** | unit tests for domain logic + full HTTP integration tests |
| CI | **GitHub Actions** | typecheck + test the API, typecheck + build the web app |

The only runtime dependencies are `express` and `cors` — everything else (SQLite, hashing, tokens) uses the Node standard library.

## Architecture

```
helpdesk-hq/
├── server/                     # Express REST API
│   ├── src/
│   │   ├── sla.ts              # SLA policy & calculations  (pure, unit-tested)
│   │   ├── tickets.ts         # status state machine & stats (pure, unit-tested)
│   │   ├── auth.ts            # scrypt hashing + HMAC tokens + middleware
│   │   ├── db.ts / seed.ts    # SQLite schema and demo data
│   │   ├── routes/            # auth, tickets, stats
│   │   └── app.ts             # Express app factory (DB injected → testable)
│   └── tests/                 # 42 Vitest tests (unit + Supertest integration)
└── web/                        # React + Vite SPA
    └── src/
        ├── lib/               # api client, auth context, types, formatting
        ├── components/        # shared badges
        └── pages/             # login, dashboard, ticket list/detail, new ticket
```

The API is built as a **factory that takes a database instance**, so integration tests spin up the whole app against a fresh in-memory SQLite DB — fast and fully isolated.

## Running locally

Requires **Node 24+** (for built-in `node:sqlite`).

```bash
# 1. API  → http://localhost:4000
cd server
npm install
npm run dev

# 2. Web  → http://localhost:5173  (proxies /api to the server)
cd ../web
npm install
npm run dev
```

Open http://localhost:5173. The database is seeded on first run with demo users and tickets.

### Demo accounts (password `Password123!` for all)

| Email | Role | Sees |
|---|---|---|
| `admin@helpdesk.local` | admin | everything + dashboard |
| `agent1@helpdesk.local` | agent | all tickets, can assign/resolve |
| `anna@corp.local` | user | only her own tickets |

## Testing

```bash
cd server
npm test          # 42 tests: SLA math, state machine, auth crypto, and full API flows
npm run typecheck
```

The suite covers the logic that matters:
- **SLA** — due-date math per priority, at-risk threshold, breach vs met
- **State machine** — every legal/illegal transition, resolve/reopen side-effects
- **Auth** — password verify, tampered/expired token rejection
- **API** — auth guards, role permissions, ticket CRUD, comment threads, dashboard aggregates

## API reference

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | create an end-user account |
| `POST` | `/api/auth/login` | — | obtain a token |
| `GET` | `/api/auth/me` | any | current user |
| `GET` | `/api/tickets` | any | list (scoped to own tickets for users); `?status=&priority=&assignee=` |
| `POST` | `/api/tickets` | any | raise a ticket |
| `GET` | `/api/tickets/:id` | any | ticket + comments |
| `PATCH` | `/api/tickets/:id` | agent/admin | status / priority / assignee |
| `POST` | `/api/tickets/:id/comments` | requester/staff | add a comment |
| `GET` | `/api/stats` | agent/admin | dashboard metrics |
| `GET` | `/api/stats/agents` | agent/admin | assignable staff |

## Roadmap

- [ ] File attachments on tickets
- [ ] Email notifications on assignment / status change
- [ ] Business-hours-aware SLA (currently elapsed-time)
- [ ] Playwright end-to-end tests in CI
- [ ] Docker Compose for one-command startup

---

**Author:** Kyle — [@kyle21pixel](https://github.com/kyle21pixel). Part of a portfolio spanning IT infrastructure ([AD homelab](https://github.com/kyle21pixel/active-directory-homelab)), automation ([ITOpsKit](https://github.com/kyle21pixel/ITOpsKit)), security ([SOC lab](https://github.com/kyle21pixel/soc-detection-lab)), and full-stack development (this app).
