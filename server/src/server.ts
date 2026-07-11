// Entry point: open (or create) the on-disk database, seed it on first run,
// and start listening.

import { createApp } from './app.js';
import { createDb } from './db.js';
import { seed, DEMO_PASSWORD } from './seed.js';

const PORT = Number(process.env.PORT ?? 4000);
const DB_PATH = process.env.DB_PATH ?? 'helpdesk.db';

const db = createDb(DB_PATH);
const result = seed(db);
if (result.users > 0) {
  console.log(`Seeded ${result.users} users and ${result.tickets} tickets.`);
  console.log(`Demo login: admin@helpdesk.local / ${DEMO_PASSWORD}`);
}

const app = createApp(db);
app.listen(PORT, () => {
  console.log(`HelpDeskHQ API listening on http://localhost:${PORT}`);
});
