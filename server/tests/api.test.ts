import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';

let app: Express;

beforeEach(() => {
  const db = createDb(':memory:'); // fresh, isolated DB per test
  seed(db);
  app = createApp(db);
});

async function login(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe('health', () => {
  it('responds ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('auth', () => {
  it('logs in seeded users and returns a token + role', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'agent1@helpdesk.local', password: DEMO_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('agent');
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects bad credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'agent1@helpdesk.local', password: 'wrong',
    });
    expect(res.status).toBe(401);
  });

  it('registers a new end-user', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'new@corp.local', name: 'New Person', password: 'password1',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });

  it('blocks duplicate registration', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'anna@corp.local', name: 'Anna', password: 'password1',
    });
    expect(res.status).toBe(409);
  });
});

describe('ticket access control', () => {
  it('requires authentication to list tickets', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });

  it('lets staff see all tickets but a user only their own', async () => {
    const agentToken = await login('agent1@helpdesk.local');
    const userToken = await login('anna@corp.local');

    const agentView = await request(app).get('/api/tickets').set('Authorization', `Bearer ${agentToken}`);
    const userView = await request(app).get('/api/tickets').set('Authorization', `Bearer ${userToken}`);

    expect(agentView.body.tickets.length).toBeGreaterThan(userView.body.tickets.length);
    // Every ticket the user sees is one they requested.
    for (const t of userView.body.tickets) {
      expect(t.requester_name).toBe('Anna Moore');
    }
  });
});

describe('ticket lifecycle', () => {
  it('creates a ticket with an SLA due date and correct requester', async () => {
    const userToken = await login('anna@corp.local');
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'Printer jammed', priority: 'high', category: 'hardware' });

    expect(res.status).toBe(201);
    expect(res.body.ticket.title).toBe('Printer jammed');
    expect(res.body.ticket.status).toBe('open');
    expect(res.body.ticket.sla).toBeDefined();
    expect(res.body.ticket.sla.dueAt).toBeTruthy();
  });

  it('validates ticket input', async () => {
    const userToken = await login('anna@corp.local');
    const noTitle = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${userToken}`).send({ title: '' });
    expect(noTitle.status).toBe(400);

    const badPriority = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${userToken}`).send({ title: 'x', priority: 'whenever' });
    expect(badPriority.status).toBe(400);
  });

  it('lets an agent assign, progress, and resolve a ticket', async () => {
    const agentToken = await login('agent1@helpdesk.local');

    // agent2 id — fetch from the agents endpoint
    const agents = await request(app).get('/api/stats/agents').set('Authorization', `Bearer ${agentToken}`);
    const lucy = agents.body.agents.find((a: { name: string }) => a.name === 'Lucy Achieng');

    const patch = await request(app)
      .patch('/api/tickets/1')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'in_progress', assignee_id: lucy.id });
    expect(patch.status).toBe(200);
    expect(patch.body.ticket.status).toBe('in_progress');
    expect(patch.body.ticket.assignee_name).toBe('Lucy Achieng');

    const resolve = await request(app)
      .patch('/api/tickets/1')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'resolved' });
    expect(resolve.status).toBe(200);
    expect(resolve.body.ticket.resolved_at).toBeTruthy();
    expect(resolve.body.ticket.sla.state === 'met' || resolve.body.ticket.sla.state === 'breached').toBe(true);
  });

  it('rejects an illegal status transition with 409', async () => {
    const agentToken = await login('agent1@helpdesk.local');
    // ticket 6 is seeded as closed (terminal)
    const res = await request(app)
      .patch('/api/tickets/6')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'open' });
    expect(res.status).toBe(409);
  });

  it('forbids an end-user from patching tickets', async () => {
    const userToken = await login('anna@corp.local');
    const res = await request(app)
      .patch('/api/tickets/1')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(403);
  });
});

describe('comments', () => {
  it('lets the requester and staff comment, and updates the thread', async () => {
    const userToken = await login('anna@corp.local');
    // Anna created ticket 1 in the seed.
    const res = await request(app)
      .post('/api/tickets/1/comments')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ body: 'Any update on this?' });
    expect(res.status).toBe(201);
    expect(res.body.comment.author_name).toBe('Anna Moore');

    const detail = await request(app).get('/api/tickets/1').set('Authorization', `Bearer ${userToken}`);
    expect(detail.body.comments.some((c: { body: string }) => c.body === 'Any update on this?')).toBe(true);
  });
});

describe('stats dashboard', () => {
  it('returns aggregates for staff and 403 for users', async () => {
    const agentToken = await login('agent1@helpdesk.local');
    const userToken = await login('anna@corp.local');

    const ok = await request(app).get('/api/stats').set('Authorization', `Bearer ${agentToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBeGreaterThan(0);
    expect(ok.body).toHaveProperty('slaBreached');
    expect(ok.body).toHaveProperty('byStatus');

    const forbidden = await request(app).get('/api/stats').set('Authorization', `Bearer ${userToken}`);
    expect(forbidden.status).toBe(403);
  });
});
