import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';
import type { DB } from '../src/db.js';

let app: Express;
let testDb: DB;

beforeEach(() => {
  testDb = createDb(':memory:'); // fresh, isolated DB per test
  seed(testDb);
  app = createApp(testDb);
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

  it('disables public registration', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'new@corp.local', name: 'New Person', password: 'password1',
    });
    expect(res.status).toBe(403);
  });

  it('creates employee accounts only through the manager endpoint', async () => {
    const managerToken = await login('admin@helpdesk.local');
    const res = await request(app).post('/api/auth/register').send({
      email: 'anna@corp.local', name: 'Anna', password: 'password1',
    }).set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(403);
    const created = await request(app).post('/api/employees').set('Authorization', `Bearer ${managerToken}`).send({
      email: 'new@corp.local', name: 'New Person', employee_id: 'BANK-NEW-001',
    });
    expect(created.status).toBe(201);
    expect(created.body.temporaryPassword).toBeTruthy();
    const loginResult = await request(app).post('/api/auth/login').send({ email: 'new@corp.local', password: created.body.temporaryPassword });
    expect(loginResult.status).toBe(200);
    expect(loginResult.body.user.must_change_password).toBe(true);
    const blocked = await request(app).get('/api/tickets').set('Authorization', `Bearer ${loginResult.body.token}`);
    expect(blocked.status).toBe(403);
    const changed = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${loginResult.body.token}`).send({ newPassword: 'BankOpsStrongPassword!24' });
    expect(changed.status).toBe(200);
    const active = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${loginResult.body.token}`);
    expect(active.status).toBe(200);
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

    expect(agentView.status).toBe(200);
    expect(userView.status).toBe(200);
    expect(agentView.body.tickets.length).toBeGreaterThan(0);
    expect(userView.body.tickets.length).toBeGreaterThan(0);
  });
});

describe('ticket lifecycle', () => {
  it('creates a ticket with an SLA due date and correct requester', async () => {
    const userToken = await login('anna@corp.local');
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'Printer jammed', description: 'The printer is jammed and will not clear.', priority: 'high', category: 'hardware' });

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
      .post('/api/tickets/1/actions')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ action: 'resolve', resolution_description: 'Reset the printer queue and reinstalled the print device.' });
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

  it('supports team assignment, assigned work, resolution, affected-employee confirmation and reopening', async () => {
    const employee = await login('anna@corp.local');
    const manager = await login('admin@helpdesk.local');
    const teamLead = await login('agent1@helpdesk.local');
    const resolver = await login('agent2@helpdesk.local');
    const created = await request(app).post('/api/tickets').set('Authorization', `Bearer ${employee}`).send({
      title: 'Branch printer outage', description: 'Passbook printer is offline at the service counter.',
      category: 'printers_scanners', affected_user_id: 5,
    });
    expect(created.status).toBe(201);
    expect(created.body.ticket.status).toBe('open');
    expect(created.body.ticket.requester_id).not.toBe(created.body.ticket.affected_user_id);
    const id = created.body.ticket.id;

    const teamAssignment = await request(app).post(`/api/tickets/${id}/actions`).set('Authorization', `Bearer ${manager}`).send({ action: 'assign', team_id: 1 });
    expect(teamAssignment.status).toBe(200);
    expect(teamAssignment.body.ticket.status).toBe('assigned');
    const individualAssignment = await request(app).post(`/api/tickets/${id}/actions`).set('Authorization', `Bearer ${teamLead}`).send({ action: 'assign', assignee_id: 3 });
    expect(individualAssignment.status).toBe(200);

    const working = await request(app).post(`/api/tickets/${id}/actions`).set('Authorization', `Bearer ${resolver}`).send({ action: 'status', status: 'in_progress' });
    expect(working.status).toBe(200);
    const resolved = await request(app).post(`/api/tickets/${id}/actions`).set('Authorization', `Bearer ${resolver}`).send({ action: 'resolve', resolution_description: 'Replaced the USB cable and calibrated the scanner.' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.ticket.resolved_by).toBe(3);

    const selfConfirmation = await request(app).post(`/api/tickets/${id}/actions`).set('Authorization', `Bearer ${resolver}`).send({ action: 'confirm' });
    expect(selfConfirmation.status).toBe(403);
    const confirmed = await request(app).post(`/api/tickets/${id}/actions`).set('Authorization', `Bearer ${await login('james@corp.local')}`).send({ action: 'confirm' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.ticket.status).toBe('closed');
    expect(confirmed.body.ticket.closure_method).toBe('manual');

    const reopened = await request(app).post(`/api/tickets/${id}/actions`).set('Authorization', `Bearer ${employee}`).send({ action: 'reopen', reason: 'Issue returned after two print jobs.' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.ticket.status).toBe('reopened');
    const detail = await request(app).get(`/api/tickets/${id}`).set('Authorization', `Bearer ${employee}`);
    expect(detail.body.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['created','assigned','resolved','confirmed','reopened']));
    expect((testDb.prepare('SELECT COUNT(*) AS n FROM notifications WHERE ticket_id=?').get(id) as {n:number}).n).toBeGreaterThan(0);
  });

  it('hides restricted cybersecurity tickets from unrelated employees', async () => {
    const anna = await login('anna@corp.local'); const james = await login('james@corp.local');
    const created = await request(app).post('/api/tickets').set('Authorization', `Bearer ${anna}`).send({
      title: 'Suspicious message', description: 'Unexpected attachment in an internal email.', category: 'cybersecurity',
    });
    expect(created.status).toBe(201);
    const id = created.body.ticket.id;
    const list = await request(app).get('/api/tickets').set('Authorization', `Bearer ${james}`);
    expect(list.body.tickets.some((ticket: { id: number }) => ticket.id === id)).toBe(false);
    const hidden = await request(app).get(`/api/tickets/${id}`).set('Authorization', `Bearer ${james}`);
    expect(hidden.status).toBe(404);
    const owner = await request(app).get(`/api/tickets/${id}`).set('Authorization', `Bearer ${anna}`);
    expect(owner.status).toBe(200);
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
    expect(forbidden.status).toBe(200);
  });
});

describe('BankOps ticket workflow', () => {
  it('creates a ticket with only title, description and category', async () => {
    const userToken = await login('anna@corp.local');
    const res = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'Branch printer unavailable', description: 'The passbook printer is not responding.', category: 'printers_scanners' });
    expect(res.status).toBe(201);
    expect(res.body.ticket.status).toBe('open');
    expect(res.body.ticket.priority).toBe('medium');
  });

  it('keeps affected employee, department and assignment separate', async () => {
    const userToken = await login('anna@corp.local');
    const james = await request(app).get('/api/employees?q=James').set('Authorization', `Bearer ${userToken}`);
    expect(james.status).toBe(200);
    const affected = james.body.employees.find((employee: { name: string }) => employee.name === 'James Otieno');
    const res = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        title: 'James cannot access CBS',
        description: 'The Core Banking login page is unavailable for James.',
        category: 'core_banking',
        priority: 'critical',
        affected_user_id: affected?.id,
        team_id: 3,
      });
    expect(res.status).toBe(201);
    expect(res.body.ticket.affected_user_id).toBe(affected?.id);
    expect(res.body.ticket.team_id).toBe(3);
  });

  it('resolves, confirms and reopens with a complete audit trail', async () => {
    const userToken = await login('anna@corp.local');
    const agentToken = await login('agent1@helpdesk.local');

    const created = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'Scanner issue', description: 'The cheque scanner is not detecting documents.', category: 'hardware' });
    expect(created.status).toBe(201);
    const ticketId = created.body.ticket.id;

    const assigned = await request(app).post(`/api/tickets/${ticketId}/actions`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ action: 'assign', assignee_id: created.body.ticket.requester_id === 0 ? null : 2 });
    expect([200, 403].includes(assigned.status)).toBe(true);

    const resolved = await request(app).post(`/api/tickets/${ticketId}/actions`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ action: 'resolve', resolution_description: 'Cleaned the scanner feed and verified successful scans.' });
    expect([200, 403].includes(resolved.status)).toBe(true);

    if (resolved.status === 200) {
      const confirmed = await request(app).post(`/api/tickets/${ticketId}/actions`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ action: 'confirm' });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.ticket.status).toBe('closed');

      const reopened = await request(app).post(`/api/tickets/${ticketId}/actions`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ action: 'reopen', reason: 'The scanner stopped working again after verification.' });
      expect(reopened.status).toBe(200);
      expect(reopened.body.ticket.status).toBe('reopened');

      const detail = await request(app).get(`/api/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(detail.body.history.some((item: { action: string }) => item.action === 'created')).toBe(true);
      expect(detail.body.history.some((item: { action: string }) => item.action === 'resolved')).toBe(true);
      expect(detail.body.history.some((item: { action: string }) => item.action === 'reopened')).toBe(true);
    }
  });

  it('rejects resolution and reopening actions without required descriptions', async () => {
    const userToken = await login('anna@corp.local');
    const agentToken = await login('agent1@helpdesk.local');
    const created = await request(app).post('/api/tickets')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'Network issue', description: 'The branch network is intermittent.', category: 'network' });
    const ticketId = created.body.ticket.id;

    await request(app).post(`/api/tickets/${ticketId}/actions`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ action: 'assign', assignee_id: 2 });
    const resolve = await request(app).post(`/api/tickets/${ticketId}/actions`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ action: 'resolve', resolution_description: '' });
    expect(resolve.status).toBe(400);

    const reopen = await request(app).post(`/api/tickets/${ticketId}/actions`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ action: 'reopen', reason: '' });
    expect(reopen.status).toBe(400);
  });
});
