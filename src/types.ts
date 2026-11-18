import type { BattleshipBoard } from '@honglinwei/arcade-core';

export interface User {
  id: number;
  email: string;
  username: string;
}

export interface AppEnv {
  Variables: {
    user: User | null;
    tokenHash: string | null;
  };
}

export type GameStatus = 'waiting' | 'playing' | 'finished';

export interface Player {
  id: number | null;
  username: string;
}

export interface CounterDocument {
  _id: 'users' | 'games';
  seq: number;
}

export interface UserDocument {
  _id: number;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface SessionDocument {
  _id: string;
  userId: number;
  expiresAt: Date;
}

export interface GameDocument {
  _id: number;
  status: GameStatus;
  ai: boolean;
  players: Player[];
  boards: BattleshipBoard[];
  turn: number | null;
  winner: number | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type GameSummaryDocument = Omit<GameDocument, 'boards'>;
