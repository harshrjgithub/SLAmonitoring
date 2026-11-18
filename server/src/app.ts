import express, { type Express } from 'express';
import cors from 'cors';
import type { DB } from './db.js';
import { authRoutes } from './routes/auth.routes.js';
import { ticketRoutes } from './routes/tickets.routes.js';
import { statsRoutes } from './routes/stats.routes.js';
import { employeeRoutes } from './routes/employees.routes.js';
import { organisationRoutes } from './routes/organisation.routes.js';
import { notificationRoutes } from './routes/notifications.routes.js';

/**
 * Build the Express app around a database instance. Kept as a factory so tests
 * can inject an in-memory DB and get a fresh, isolated app per suite.
 */
export function createApp(db: DB): Express {
  const app = express();
  app.locals.db = db;
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes(db));
  app.use('/api/employees', employeeRoutes(db));
  app.use('/api/organisation', organisationRoutes(db));
  app.use('/api/notifications', notificationRoutes(db));
  app.use('/api/tickets', ticketRoutes(db));
  app.use('/api/stats', statsRoutes(db));

  // Fallback 404 for unknown API routes.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  return app;
}
