import {
  BOARD_SIZE,
  hideShips,
  isValidShot,
  shipAt,
  type BattleshipBoard,
  type Coordinate,
} from '@honglinwei/arcade-core';

export function chooseShot(board: BattleshipBoard): Coordinate {
  const visible = hideShips(board);
  const open: Coordinate[] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (isValidShot(visible, x, y)) open.push({ x, y });
    }
  }
  const wounded = visible.shots.filter((shot) => shot.hit && !shipAt(visible, shot.x, shot.y));
  const nextToWounded = open.filter((cell) =>
    wounded.some((shot) => Math.abs(shot.x - cell.x) + Math.abs(shot.y - cell.y) === 1),
  );
  const choices = nextToWounded.length > 0 ? nextToWounded : open;
  return choices[Math.floor(Math.random() * choices.length)];
}
