import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { initDatabase } from './db.ts';

await initDatabase();

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3000 }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
