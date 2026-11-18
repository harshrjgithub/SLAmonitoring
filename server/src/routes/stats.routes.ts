import { Router } from 'express';
import type { DB } from '../db.js';
import { hasPermission, requireAuth, requireRole, type AuthedRequest } from '../auth.js';
import { computeStats, type TicketLike } from '../tickets.js';
import { getSlaStatus, type Priority } from '../sla.js';

export function statsRoutes(db: DB): Router {
  const router = Router();

  // Organisation ticket dashboard is available to every active employee;
  // restricted HR/cybersecurity counts are withheld from unauthorised viewers.
  router.get('/', requireAuth, (req: AuthedRequest, res) => {
    const canSeeSensitive = req.user!.role === 'admin' || hasPermission(db, req.user!.sub, req.user!.role, 'view_sensitive_tickets');
    const rows = db.prepare(`SELECT status, priority, assignee_id, created_at, resolved_at FROM tickets ${canSeeSensitive ? '' : "WHERE sensitivity != 'restricted' AND is_sensitive=0"}`)
      .all() as unknown as Array<TicketLike & { priority: Priority; created_at: string; resolved_at: string | null }>;

    const stats = computeStats(rows);

    // SLA breaches among currently-open tickets.
    let slaBreached = 0;
    let slaAtRisk = 0;
    for (const r of rows) {
      if (r.resolved_at) continue;
      const sla = getSlaStatus({ priority: r.priority, createdAt: r.created_at });
      if (sla.state === 'breached') slaBreached += 1;
      else if (sla.state === 'at_risk') slaAtRisk += 1;
    }

    res.json({ ...stats, slaBreached, slaAtRisk });
  });

  // List staff members (for assignment dropdowns).
  router.get('/agents', requireAuth, requireRole('agent', 'admin'), (_req, res) => {
    const agents = db
      .prepare("SELECT id, name, role FROM users WHERE role IN ('agent','admin') ORDER BY name")
      .all();
    res.json({ agents });
  });

  return router;
}
