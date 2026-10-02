import { describe, expect, it } from "vitest";
import { BOARD, BOARD_SIZE } from "../../shared/board/index.js";
import type { Seat } from "../../shared/engine/index.js";
import {
  BOARD_HALF,
  BUILDING_BAND,
  buildingBandZ,
  faceRotation,
  INNER_HALF,
  LOT_DEPTH,
  LOT_TOP,
  passingSpot,
  pawnSpot,
  ROAD_WIDTH,
  reserveAnchor,
  screenPoint,
  screenTop,
  tileCenter,
  tilePoint,
  tileRotation,
  tileSize,
  visibleFaces,
} from "./board-layout.js";

const SEATS: readonly Seat[] = [0, 1, 2, 3];

function screen(index: number) {
  const [x, z] = tileCenter(index);
  return screenPoint(x, LOT_TOP, z);
}

/** World direction of a tile-local axis after a y rotation. */
function rotate(rotation: number, x: number, z: number) {
  return [
    x * Math.cos(rotation) + z * Math.sin(rotation),
    -x * Math.sin(rotation) + z * Math.cos(rotation),
  ] as const;
}

function screenDirection(x: number, z: number) {
  const [ax, ay] = screenPoint(0, 0, 0);
  const [bx, by] = screenPoint(x, 0, z);
  return [bx - ax, by - ay] as const;
}

describe("board layout", () => {
  it("puts Start in front and the other corners left, back and right", () => {
    const corners = [0, 8, 16, 24].map(screen);
    const [start, island, championship, worldTour] = corners;
    const ys = corners.map(([, y]) => y);
    const xs = corners.map(([x]) => x);
    expect(start[1]).toBe(Math.min(...ys));
    expect(championship[1]).toBe(Math.max(...ys));
    expect(island[0]).toBe(Math.min(...xs));
    expect(worldTour[0]).toBe(Math.max(...xs));
    expect(Math.abs(start[0])).toBeLessThan(1e-9);
  });

  it("leaves Start towards the left and runs clockwise on screen", () => {
    expect(screen(1)[0]).toBeLessThan(screen(0)[0]);
    expect(screen(31)[0]).toBeGreaterThan(screen(0)[0]);
    // Shoelace sum over screen points: negative means clockwise with y up.
    let area = 0;
    for (let index = 0; index < BOARD_SIZE; index++) {
      const [x1, y1] = screen(index);
      const [x2, y2] = screen((index + 1) % BOARD_SIZE);
      area += x1 * y2 - x2 * y1;
    }
    expect(area).toBeLessThan(0);
  });

  it("tiles every lot inside the square without overlaps", () => {
    const rectangles = BOARD.map((tile) => {
      const [x, z] = tileCenter(tile.index);
      const [along, depth] = tileSize(tile.index);
      const [ax, az] = rotate(tileRotation(tile.index), along, depth);
      const halfX = Math.abs(ax) / 2;
      const halfZ = Math.abs(az) / 2;
      return {
        minX: x - halfX,
        maxX: x + halfX,
        minZ: z - halfZ,
        maxZ: z + halfZ,
      };
    });
    let area = 0;
    for (const [index, a] of rectangles.entries()) {
      expect(a.minX).toBeGreaterThanOrEqual(-BOARD_HALF - 1e-9);
      expect(a.maxX).toBeLessThanOrEqual(BOARD_HALF + 1e-9);
      expect(a.minZ).toBeGreaterThanOrEqual(-BOARD_HALF - 1e-9);
      expect(a.maxZ).toBeLessThanOrEqual(BOARD_HALF + 1e-9);
      area += (a.maxX - a.minX) * (a.maxZ - a.minZ);
      for (const b of rectangles.slice(index + 1)) {
        const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        expect(overlapX <= 1e-9 || overlapZ <= 1e-9).toBe(true);
      }
    }
    // Lots and corners exactly fill the ring around the inner square.
    expect(area).toBeCloseTo(4 * BOARD_HALF ** 2 - 4 * INNER_HALF ** 2, 9);
  });

  it("prints every face upright and left to right on screen", () => {
    for (const tile of BOARD) {
      const rotation = faceRotation(tile.index);
      // Canvas right is plane +x; canvas top is plane +y, laid flat as -z.
      const [rightX] = screenDirection(...rotate(rotation, 1, 0));
      const [, upY] = screenDirection(...rotate(rotation, 0, -1));
      expect(rightX).toBeGreaterThan(0);
      expect(upY).toBeGreaterThan(0);
    }
  });

  it("keeps the building plot at the top of each lot on screen", () => {
    for (const tile of BOARD) {
      if (tile.index % 8 === 0) continue;
      const band = tilePoint(tile.index, 0, buildingBandZ(tile.index));
      const print = tilePoint(
        tile.index,
        0,
        -screenTop(tile.index) * (LOT_DEPTH / 2 - BUILDING_BAND),
      );
      expect(screenPoint(band[0], LOT_TOP, band[1])[1]).toBeGreaterThan(
        screenPoint(print[0], LOT_TOP, print[1])[1],
      );
    }
  });

  it("turns facades toward the camera", () => {
    for (const tile of BOARD) {
      const [faceX, faceZ] = visibleFaces(tile.index);
      for (const [x, z] of [
        [faceX, 0],
        [0, faceZ],
      ] as const) {
        const [, depth] = screenDirection(
          ...rotate(tileRotation(tile.index), x, z),
        );
        // Moving toward a visible face moves toward the camera: down the screen.
        expect(depth).toBeLessThan(0);
      }
    }
  });

  it("stands lot pawns on the road in front of their own lot", () => {
    for (const tile of BOARD) {
      if (tile.index % 8 === 0) continue;
      for (const seat of SEATS) {
        const [x, z] = pawnSpot(seat, tile.index);
        const ring = Math.max(Math.abs(x), Math.abs(z));
        expect(ring).toBeGreaterThan(INNER_HALF - ROAD_WIDTH + 0.1);
        expect(ring).toBeLessThan(INNER_HALF - 0.1);
        // Measured along the side, the pawn stays within its own lot.
        const [cx, cz] = tileCenter(tile.index);
        const along = Math.min(Math.abs(x - cx), Math.abs(z - cz));
        expect(along).toBeLessThan(0.5);
      }
    }
  });

  it("stands corner pawns on the free inner quarter of the corner", () => {
    for (const index of [0, 8, 16, 24]) {
      const [cx, cz] = tileCenter(index);
      for (const seat of SEATS) {
        const [x, z] = pawnSpot(seat, index);
        // Closer to the board center than the corner's own center, on both axes.
        expect(Math.abs(x)).toBeLessThan(Math.abs(cx));
        expect(Math.abs(z)).toBeLessThan(Math.abs(cz));
        expect(Math.min(Math.abs(x), Math.abs(z))).toBeGreaterThan(INNER_HALF);
      }
    }
  });

  it("never lets two different players' pawns collide", () => {
    const spots = BOARD.flatMap((tile) =>
      SEATS.map((seat) => ({
        seat,
        tile: tile.index,
        at: pawnSpot(seat, tile.index),
      })),
    );
    for (const [index, a] of spots.entries())
      for (const b of spots.slice(index + 1)) {
        if (a.seat === b.seat) continue;
        const distance = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
        expect(
          distance,
          `${a.seat}@${a.tile} / ${b.seat}@${b.tile}`,
        ).toBeGreaterThan(0.3);
      }
  });

  it("turns passing pawns on the road, clear of every standing pawn", () => {
    const standing = BOARD.flatMap((tile) =>
      SEATS.map((seat) => pawnSpot(seat, tile.index)),
    );
    for (const index of [0, 8, 16, 24]) {
      const [cx, cz] = tileCenter(index);
      for (const seat of SEATS) {
        const [x, z] = passingSpot(seat, index);
        // On the road's corner square, beside its own corner, never on it.
        for (const at of [x, z]) {
          expect(Math.abs(at)).toBeGreaterThan(INNER_HALF - ROAD_WIDTH);
          expect(Math.abs(at)).toBeLessThan(INNER_HALF - 0.15);
        }
        expect(Math.sign(x)).toBe(Math.sign(cx));
        expect(Math.sign(z)).toBe(Math.sign(cz));
        for (const [sx, sz] of standing)
          expect(Math.hypot(x - sx, z - sz)).toBeGreaterThan(0.34);
      }
    }
  });

  it("passes lots on the spot where a pawn would stop", () => {
    for (const tile of BOARD) {
      if (tile.index % 8 === 0) continue;
      for (const seat of SEATS)
        expect(passingSpot(seat, tile.index)).toEqual(
          pawnSpot(seat, tile.index),
        );
    }
  });

  it("puts each cash reserve beside its corner HUD", () => {
    const [left, right, bottom, top] = [-1, 1, -1, 1];
    const expected: readonly (readonly [number, number])[] = [
      [left, bottom],
      [left, top],
      [right, top],
      [right, bottom],
    ];
    for (const seat of SEATS) {
      const [x, z] = reserveAnchor(seat).position;
      const [sx, sy] = screenPoint(x, 0, z);
      expect(Math.sign(sx)).toBe(expected[seat][0]);
      expect(Math.sign(sy)).toBe(expected[seat][1]);
    }
  });
});
