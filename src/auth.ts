import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { MongoServerError } from 'mongodb';
import { z } from 'zod';
import { db, nextId } from './db.ts';
import type { AppEnv, User, UserDocument } from './types.ts';
import { validate } from './validate.ts';

const SALT_ROUNDS = 10;
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const DUPLICATE_KEY_ERROR = 11000;

const email = z.string().trim().toLowerCase().max(254, 'Email is too long').email('Enter a valid email address');

const signupBody = z.object({
  email,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
});

const loginBody = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toUser(account: UserDocument): User {
  return { id: account._id, email: account.email, username: account.email.split('@')[0] };
}

export const session = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  const tokenHash = token ? hashToken(token) : null;
  const activeSession = tokenHash
    ? await db.sessions.findOne({ _id: tokenHash, expiresAt: { $gt: new Date() } })
    : null;
  const account = activeSession ? await db.users.findOne({ _id: activeSession.userId }) : null;
  c.set('user', account ? toUser(account) : null);
  c.set('tokenHash', account ? tokenHash : null);
  await next();
});

export const requireUser = createMiddleware<{ Variables: { user: User; tokenHash: string } }>(async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'Log in first' }, 401);
  await next();
});

export const auth = new Hono<AppEnv>();

auth.post('/signup', validate('json', signupBody), async (c) => {
  const { email, password } = c.req.valid('json');
  const account: UserDocument = {
    _id: await nextId('users'),
    email,
    passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
    createdAt: new Date(),
  };
  try {
    await db.users.insertOne(account);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY_ERROR) {
      return c.json({ error: 'An account with this email already exists' }, 409);
    }
    throw error;
  }
  return c.json({ user: toUser(account) }, 201);
});

auth.post('/login', validate('json', loginBody), async (c) => {
  const { email, password } = c.req.valid('json');
  const account = await db.users.findOne({ email });
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    return c.json({ error: 'Wrong email or password' }, 401);
  }
  const token = randomBytes(32).toString('base64url');
  await db.sessions.insertOne({
    _id: hashToken(token),
    userId: account._id,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
  });
  return c.json({ token, user: toUser(account) }, 200);
});

auth.post('/logout', requireUser, async (c) => {
  await db.sessions.deleteOne({ _id: c.get('tokenHash') });
  return c.json({ message: 'Logged out' }, 200);
});

auth.get('/me', requireUser, (c) => c.json({ user: c.get('user') }, 200));
