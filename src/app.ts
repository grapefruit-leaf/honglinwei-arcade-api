import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { auth, session } from './auth.ts';
import { games } from './battleship/games.ts';
import type { AppEnv } from './types.ts';

export const app = new Hono<AppEnv>();

app.use(logger());

app.get('/', (c) => c.json({ name: 'arcade-api', status: 'ok' }, 200));

app.use('/api/*', session);
app.route('/api/auth', auth);
app.route('/api/games', games);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  console.error(error);
  return c.json({ error: 'Something went wrong on the server' }, 500);
});
