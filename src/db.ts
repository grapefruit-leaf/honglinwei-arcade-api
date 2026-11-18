import { MongoClient } from 'mongodb';
import type { CounterDocument, GameDocument, SessionDocument, UserDocument } from './types.ts';

const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://localhost:27017');
const database = client.db('arcade');

export const db = {
  counters: database.collection<CounterDocument>('counters'),
  users: database.collection<UserDocument>('users'),
  sessions: database.collection<SessionDocument>('sessions'),
  games: database.collection<GameDocument>('games'),
};

export async function initDatabase(): Promise<void> {
  await client.connect();
  await Promise.all([
    db.users.createIndex({ email: 1 }, { unique: true }),
    db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.games.createIndex({ status: 1, updatedAt: -1 }),
    db.games.createIndex({ 'players.id': 1, updatedAt: -1 }),
  ]);
}

export async function nextId(name: CounterDocument['_id']): Promise<number> {
  const counter = await db.counters.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return counter!.seq;
}
