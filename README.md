# honglinwei-arcade-api

The backend for Battleship on my arcade site, built with [Hono](https://hono.dev) on Node and MongoDB. The game
rules (placing ships, checking and recording shots, deciding when a fleet is sunk) come from
[`@honglinwei/arcade-core`](https://www.npmjs.com/package/@honglinwei/arcade-core), so the frontend and the backend
share the same logic. The server is the source of truth for every ship, every shot, whose turn it is and who won.

Only the SvelteKit server of [honglinwei-arcade](https://github.com/grapefruit-leaf/honglinwei-arcade) calls this API.

## Run locally

Needs Node 22.18 or later (the TypeScript source runs directly) and MongoDB: a local server (for example
`docker run -d -p 27017:27017 mongo:8`) or a free Atlas cluster.

```sh
npm install
npm run dev            # http://localhost:3000
npm run check          # type-check with tsc
```

The indexes are created on startup, and `GET /` returns `{ "name": "arcade-api", "status": "ok" }` as a health check.

Both variables are optional locally. To override them, put them in a `.env` file, which `npm run dev` loads if present.

| Variable | Default | |
| --- | --- | --- |
| `MONGODB_URI` | `mongodb://localhost:27017` | Connection string. Set it on Render, for example to an Atlas `mongodb+srv://` string. The data lives in the `arcade` database. |
| `PORT` | `3000` | Render sets this for you. |

## Data

- `users`: `email` has a unique index and is stored in lower case. Passwords are hashed with bcrypt before they’re stored
  and are never returned.
- `sessions`: a random 32-byte token is given to the client at login; only its SHA-256 hash is stored, as the `_id`, with
  an `expiresAt` 7 days out. A TTL index makes MongoDB delete expired sessions, and logging out deletes the document.
- `games`: `players` and `boards` are arrays in seat order (seat 0 created the game), and `turn` and `winner` are seats
  (0 or 1). `version` goes up on every write, and a shot is only saved if the version is unchanged since the game was
  read, so two requests can’t both land on the same turn.
- `counters`: sequential ids for users and games, so game links stay short (`/games/battleship/12`).

## Auth

Send the token from `POST /api/auth/login` as `Authorization: Bearer <token>`. Routes marked **auth** return `401` without
a valid token.

## Errors

Every error is JSON: `{ "error": "A message for the user" }`. Invalid input (bad JSON, missing fields, wrong types, ids
that aren’t positive whole numbers) returns `400` with the first problem found. Unknown routes return `404`, and anything
unexpected is logged and returns `500` from the `onError` handler.

## Shapes

```ts
User = { id: number, email: string, username: string }        // username is the part of the email before @
Player = { id: number | null, username: string, board?: Board } // id is null for the computer
Board = { ships: { name, cells: { x, y }[] }[], shots: { x, y, hit }[] } // x is the column, y the row, 0 to 9
Game = {
  id, status: 'waiting' | 'playing' | 'finished', ai: boolean,
  players: Player[], turn: 0 | 1 | null, winner: 0 | 1 | null, createdAt, updatedAt
}
```

`board` is only included where the caller may see it. A player gets their own full board and the opponent’s board with
every shot but only the ships that are already sunk. Once a game is finished, both boards are shown in full to anyone.

## Endpoints

### `POST /api/auth/signup`

Create an account.

Body: `{ "email": "ana@example.com", "password": "at least 8 characters" }`

| Status | When |
| --- | --- |
| `201` | `{ "user": User }` |
| `400` | Invalid email, or a password shorter than 8 or longer than 72 characters |
| `409` | An account with this email already exists |

### `POST /api/auth/login`

Check the email and password and start a session.

Body: `{ "email": "ana@example.com", "password": "..." }`

| Status | When |
| --- | --- |
| `200` | `{ "token": string, "user": User }` |
| `400` | Missing or invalid fields |
| `401` | Wrong email or password |

### `POST /api/auth/logout` (auth)

End the current session. The token stops working right away.

| Status | When |
| --- | --- |
| `200` | `{ "message": "Logged out" }` |
| `401` | No valid session |

### `GET /api/auth/me` (auth)

| Status | When |
| --- | --- |
| `200` | `{ "user": User }` |
| `401` | No one is logged in |

### `GET /api/games`

The lobby. Works without a token, in which case `mine` is empty. No boards are included.

| Status | When |
| --- | --- |
| `200` | `{ "waiting": Game[], "mine": Game[], "finished": Game[] }`: games waiting for a second player (not yours), every game you play in, and recently finished games you didn’t play in |

### `POST /api/games` (auth)

Create a game with both fleets placed at random. With `"opponent": "ai"` the computer joins right away as the second
player, the game starts, and no one else can join it.

Body (optional): `{ "opponent": "human" | "ai" }`, default `"human"`

| Status | When |
| --- | --- |
| `201` | `{ "game": Game }` |
| `400` | `opponent` is something else |
| `401` | Not logged in |

### `GET /api/games/:id`

One game, with the opponent’s unsunk ships left out.

| Status | When |
| --- | --- |
| `200` | `{ "game": Game }`. A logged-in user who isn’t a player can see a waiting game without boards, and anyone can see a finished game |
| `400` | `id` isn’t a positive whole number |
| `401` | Not logged in and the game isn’t over |
| `403` | The game is in progress and you aren’t one of its players |
| `404` | No game with this id |

### `POST /api/games/:id/players` (auth)

Join a waiting game as the second player. The game starts and the creator fires first.

| Status | When |
| --- | --- |
| `201` | `{ "game": Game }` |
| `400` | Invalid `id` |
| `401` | Not logged in |
| `404` | No game with this id |
| `409` | It’s your own game, or it already has two players |

### `POST /api/games/:id/shots` (auth)

Fire at a square on the opponent’s board. In a game against the computer, the computer fires back in the same request,
so the response already shows its shot and it’s your turn again.

Body: `{ "x": 0-9, "y": 0-9 }`

| Status | When |
| --- | --- |
| `201` | `{ "shot": { x, y, hit, sunk: ShipName \| null }, "game": Game }` |
| `400` | `x` or `y` missing, not a whole number, or off the board |
| `401` | Not logged in |
| `403` | You aren’t a player in this game |
| `404` | No game with this id |
| `409` | The game hasn’t started or is over, it isn’t your turn, you already fired at that square, or another request changed the game first |

## The computer opponent

The AI lives only in `src/battleship/ai.ts`. It looks at the board the way a player would (shots and sunk ships only):
if it has hit a ship that isn’t sunk yet, it fires next to that hit; otherwise it picks a random square it hasn’t tried.
