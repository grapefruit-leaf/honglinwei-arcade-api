import {
  BOARD_SIZE,
  createRandomBoard,
  hideShips,
  isGameComplete,
  isSunk,
  isValidShot,
  shipAt,
  updateBoard,
} from '@honglinwei/arcade-core';
import { Hono } from 'hono';
import type { Filter, Sort } from 'mongodb';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import { db, nextId } from '../db.ts';
import type { AppEnv, GameDocument, GameStatus, GameSummaryDocument, Player } from '../types.ts';
import { validate } from '../validate.ts';
import { chooseShot } from './ai.ts';

const AI_PLAYER: Player = { id: null, username: 'Computer' };
const LIST_LIMIT = 20;

const gameParams = z.object({
  id: z.coerce
    .number({ error: 'Game ids are whole numbers' })
    .int('Game ids are whole numbers')
    .min(1, 'Game ids start at 1'),
});

const newGameBody = z.object({
  opponent: z.enum(['human', 'ai'], { error: 'opponent must be "human" or "ai"' }).default('human'),
});

const coordinate = z
  .int('x and y must be whole numbers')
  .min(0, `x and y go from 0 to ${BOARD_SIZE - 1}`)
  .max(BOARD_SIZE - 1, `x and y go from 0 to ${BOARD_SIZE - 1}`);

const shotBody = z.object({ x: coordinate, y: coordinate });

function seatOf(game: GameSummaryDocument, userId: number | undefined): number {
  return game.players.findIndex((player) => player.id === userId);
}

function toSummary(game: GameSummaryDocument) {
  return {
    id: game._id,
    status: game.status,
    ai: game.ai,
    players: game.players,
    turn: game.turn,
    winner: game.winner,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

function toGame(game: GameDocument, userId: number | undefined) {
  const summary = toSummary(game);
  const seat = seatOf(game, userId);
  const finished = game.status === 'finished';
  if (seat === -1 && !finished) return summary;
  return {
    ...summary,
    players: game.players.map((player, index) => ({
      ...player,
      board: finished || index === seat ? game.boards[index] : hideShips(game.boards[index]),
    })),
  };
}

function findSummaries(filter: Filter<GameDocument>, sort: Sort, limit = 0): Promise<GameSummaryDocument[]> {
  return db.games.find<GameSummaryDocument>(filter, { projection: { boards: 0 }, sort, limit }).toArray();
}

export const games = new Hono<AppEnv>();

games.get('/', async (c) => {
  const userId = c.get('user')?.id;
  const notMine: Filter<GameDocument> = userId === undefined ? {} : { 'players.id': { $ne: userId } };
  const [waiting, mine, finished] = await Promise.all([
    findSummaries({ status: 'waiting', ...notMine }, { createdAt: -1 }, LIST_LIMIT),
    userId === undefined ? [] : findSummaries({ 'players.id': userId }, { updatedAt: -1 }),
    findSummaries({ status: 'finished', ...notMine }, { updatedAt: -1 }, LIST_LIMIT),
  ]);
  return c.json(
    {
      waiting: waiting.map(toSummary),
      mine: mine.map(toSummary),
      finished: finished.map(toSummary),
    },
    200,
  );
});

games.post('/', requireUser, validate('json', newGameBody), async (c) => {
  const user = c.get('user');
  const ai = c.req.valid('json').opponent === 'ai';
  const creator: Player = { id: user.id, username: user.username };
  const now = new Date();
  const game: GameDocument = {
    _id: await nextId('games'),
    status: ai ? 'playing' : 'waiting',
    ai,
    players: ai ? [creator, AI_PLAYER] : [creator],
    boards: [createRandomBoard(), createRandomBoard()],
    turn: ai ? 0 : null,
    winner: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.games.insertOne(game);
  return c.json({ game: toGame(game, user.id) }, 201);
});

games.get('/:id', validate('param', gameParams), async (c) => {
  const user = c.get('user');
  const game = await db.games.findOne({ _id: c.req.valid('param').id });
  if (!game) return c.json({ error: 'Game not found' }, 404);
  if (game.status !== 'finished') {
    if (!user) return c.json({ error: 'Log in to see a game before it is over' }, 401);
    if (game.status === 'playing' && seatOf(game, user.id) === -1) {
      return c.json({ error: 'Only the two players can see a game in progress' }, 403);
    }
  }
  return c.json({ game: toGame(game, user?.id) }, 200);
});

games.post('/:id/players', requireUser, validate('param', gameParams), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const game = await db.games.findOne({ _id: id });
  if (!game) return c.json({ error: 'Game not found' }, 404);
  if (game.players[0].id === user.id) return c.json({ error: 'You can’t join your own game' }, 409);
  if (game.status !== 'waiting') return c.json({ error: 'This game already has two players' }, 409);
  const joined = await db.games.findOneAndUpdate(
    { _id: id, status: 'waiting' },
    {
      $push: { players: { id: user.id, username: user.username } },
      $set: { status: 'playing', turn: 0, updatedAt: new Date() },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!joined) return c.json({ error: 'This game already has two players' }, 409);
  return c.json({ game: toGame(joined, user.id) }, 201);
});

games.post('/:id/shots', requireUser, validate('param', gameParams), validate('json', shotBody), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const { x, y } = c.req.valid('json');
  const game = await db.games.findOne({ _id: id });
  if (!game) return c.json({ error: 'Game not found' }, 404);
  const seat = seatOf(game, user.id);
  if (seat === -1) return c.json({ error: 'Only the two players can fire in this game' }, 403);
  if (game.status === 'waiting') return c.json({ error: 'The game starts when a second player joins' }, 409);
  if (game.status === 'finished') return c.json({ error: 'This game is over' }, 409);
  if (game.turn !== seat) return c.json({ error: 'It’s not your turn' }, 409);

  const opponent = 1 - seat;
  const boards = [...game.boards];
  if (!isValidShot(boards[opponent], x, y)) return c.json({ error: 'You already fired at that square' }, 409);

  boards[opponent] = updateBoard(boards[opponent], x, y);
  let status: GameStatus = 'playing';
  let turn: number | null = opponent;
  let winner: number | null = null;
  if (isGameComplete(boards[opponent])) {
    status = 'finished';
    turn = null;
    winner = seat;
  } else if (game.ai) {
    const reply = chooseShot(boards[seat]);
    boards[seat] = updateBoard(boards[seat], reply.x, reply.y);
    turn = seat;
    if (isGameComplete(boards[seat])) {
      status = 'finished';
      turn = null;
      winner = opponent;
    }
  }

  const updated = await db.games.findOneAndUpdate(
    { _id: id, version: game.version },
    { $set: { boards, status, turn, winner, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: 'after' },
  );
  if (!updated) return c.json({ error: 'The game changed before your shot landed. Reload and try again.' }, 409);

  const ship = shipAt(boards[opponent], x, y);
  const shot = { x, y, hit: ship !== undefined, sunk: ship && isSunk(boards[opponent], ship) ? ship.name : null };
  return c.json({ shot, game: toGame(updated, user.id) }, 201);
});
