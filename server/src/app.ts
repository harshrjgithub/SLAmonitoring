import express, { type Express } from 'express';
import cors from 'cors';
import type { DB } from './db.js';
import { authRoutes } from './routes/auth.routes.js';
import { ticketRoutes } from './routes/tickets.routes.js';
import { statsRoutes } from './routes/stats.routes.js';

/**
 * Build the Express app around a database instance. Kept as a factory so tests
 * can inject an in-memory DB and get a fresh, isolated app per suite.
 */
export function createApp(db: DB): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes(db));
  app.use('/api/tickets', ticketRoutes(db));
  app.use('/api/stats', statsRoutes(db));

  // Fallback 404 for unknown API routes.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  return app;
}
