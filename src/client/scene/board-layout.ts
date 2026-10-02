import type { Seat } from "../../shared/engine/index.js";

// Board geometry in world units, shared by the scene and its tests.
//
// The board keeps the classic property-game proportions: four large corner
// squares and seven narrower lots on each side. Start is the corner nearest
// the camera and play runs clockwise on screen, so a pawn leaving Start walks
// to the left, exactly like a printed board whose start square is bottom-right.
// Rendering never changes a tile index; it only decides where that index sits.

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export const LOT_WIDTH = 1;
export const LOT_DEPTH = 1.55;
export const LOTS_PER_SIDE = 7;
/** Half the side of the whole board square. */
export const BOARD_HALF = LOT_DEPTH + (LOTS_PER_SIDE / 2) * LOT_WIDTH;
/** Half the side of the square enclosed by the lots. */
export const INNER_HALF = BOARD_HALF - LOT_DEPTH;
export const ROAD_WIDTH = 0.62;
export const LAWN_HALF = INNER_HALF - ROAD_WIDTH;
/** The colored plot printed at the screen-top end of each lot, for buildings. */
export const BUILDING_BAND = 0.56;
export const LOT_GAP = 0.045;

export const BOARD_BOTTOM = -0.14;
export const BOARD_TOP = 0.24;
export const ROAD_TOP = 0.252;
export const LAWN_TOP = 0.258;
export const LOT_TOP = 0.3;
export const GROUND_Y = -0.3;

/** Direction from the board center to the orthographic camera. */
export const CAMERA_OFFSET: Vec3 = [16, 16, 16];

type SideFrame = {
  /** Direction of play along this side. */
  readonly along: Vec2;
  /** Unit vector from this side toward the board center. */
  readonly inward: Vec2;
  /** Y rotation mapping lot-local +x to `along` and +z to `inward`. */
  readonly rotation: number;
  /** The two sides nearest the camera. Their screen-top end faces the center. */
  readonly front: boolean;
};

// Side 0 runs from Start (front corner) to the island (left corner), side 1 up
// to the championship (back corner), side 2 to the world tour (right corner)
// and side 3 back down to Start.
const SIDES: readonly SideFrame[] = [
  { along: [-1, 0], inward: [0, -1], rotation: Math.PI, front: true },
  { along: [0, -1], inward: [1, 0], rotation: Math.PI / 2, front: false },
  { along: [1, 0], inward: [0, 1], rotation: 0, front: false },
  { along: [0, 1], inward: [-1, 0], rotation: -Math.PI / 2, front: true },
];

export function tileSide(index: number): 0 | 1 | 2 | 3 {
  return (Math.floor(index / 8) % 4) as 0 | 1 | 2 | 3;
}

export function sideFrame(side: number): SideFrame {
  return SIDES[side];
}

export function isCorner(index: number) {
  return index % 8 === 0;
}

/** [extent along play, extent toward the center] of a tile. */
export function tileSize(index: number): Vec2 {
  return isCorner(index) ? [LOT_DEPTH, LOT_DEPTH] : [LOT_WIDTH, LOT_DEPTH];
}

function fromSide(side: number, u: number, v: number): Vec2 {
  // u runs along play from the middle of the side; v is the distance outward
  // from the board center.
  const { along, inward } = SIDES[side];
  return [along[0] * u - inward[0] * v, along[1] * u - inward[1] * v];
}

export function tileCenter(index: number): Vec2 {
  const step = index % 8;
  const outward = BOARD_HALF - LOT_DEPTH / 2;
  return fromSide(
    tileSide(index),
    step === 0 ? -outward : (step - 4) * LOT_WIDTH,
    outward,
  );
}

/** Tile-local coordinates (x along play, z toward the center) to world x/z. */
export function tilePoint(index: number, localX: number, localZ: number): Vec2 {
  const [x, z] = tileCenter(index);
  const { along, inward } = SIDES[tileSide(index)];
  return [
    x + along[0] * localX + inward[0] * localZ,
    z + along[1] * localX + inward[1] * localZ,
  ];
}

export function tileRotation(index: number) {
  return SIDES[tileSide(index)].rotation;
}

/**
 * Y rotation of a tile's printed face. Text reads left to right and stays
 * upright on screen on every side, as on the reference boards.
 */
export function faceRotation(index: number) {
  const { rotation, front } = SIDES[tileSide(index)];
  return front ? rotation + Math.PI : rotation;
}

/**
 * Sign of the tile-local z axis that points up the screen. Buildings stand at
 * that end of a lot, so they never hide its printed name and price.
 */
export function screenTop(index: number): 1 | -1 {
  return SIDES[tileSide(index)].front ? 1 : -1;
}

/** Tile-local z of the center of the building plot. */
export function buildingBandZ(index: number) {
  return screenTop(index) * (LOT_DEPTH / 2 - BUILDING_BAND / 2);
}

/**
 * Signs of the tile-local x and z faces turned toward the camera. Windows and
 * doors go on these faces so every building shows its facade.
 */
export function visibleFaces(index: number): Vec2 {
  const { along, inward } = SIDES[tileSide(index)];
  const along2 = CAMERA_OFFSET[0] * along[0] + CAMERA_OFFSET[2] * along[1];
  const inward2 = CAMERA_OFFSET[0] * inward[0] + CAMERA_OFFSET[2] * inward[1];
  return [along2 > 0 ? 1 : -1, inward2 > 0 ? 1 : -1];
}

const PAWN_SLOTS: readonly Vec2[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * Where a seat's pawn stands for a tile. Pawns walk on the road just inside
 * the lots, side by side, never on a printed amount or inside a building.
 */
export function pawnSpot(seat: Seat, index: number): Vec2 {
  const side = tileSide(index);
  const step = index % 8;
  const [slotAlong, slotAcross] = PAWN_SLOTS[seat];
  if (isCorner(index)) {
    // The inner quarter of a corner square stays free of its landmark.
    const reach = INNER_HALF + LOT_DEPTH / 4;
    return fromSide(side, -reach - slotAlong * 0.19, reach + slotAcross * 0.19);
  }
  // The lots beside a corner share the road's corner square. Their pawns step
  // away from it, and slots mirror around each corner, so the only slots that
  // come close there always belong to the same seat.
  const towardCorner = step < 4 ? -1 : 1;
  const clearance = step === 1 || step === 7 ? 0.22 : 0;
  return fromSide(
    side,
    (step - 4) * LOT_WIDTH -
      towardCorner * clearance +
      towardCorner * slotAlong * 0.17,
    INNER_HALF - ROAD_WIDTH / 2 + slotAcross * 0.155,
  );
}

/**
 * Distance from the board center, on both axes, of the point where a walking
 * pawn turns a corner: on the road's corner square, a pawn's width inside its
 * outer edge, clear of the pawns standing on the lots beside it.
 */
const CORNER_TURN = INNER_HALF - 0.2;

/**
 * Where a walking pawn touches down on a tile it only passes. A corner is
 * counted like any tile, but the pawn keeps to the road and turns on the road's
 * corner square instead of climbing onto the corner and back down.
 */
export function passingSpot(seat: Seat, index: number): Vec2 {
  if (!isCorner(index)) return pawnSpot(seat, index);
  return fromSide(tileSide(index), -CORNER_TURN, CORNER_TURN);
}

/** Each seat keeps its reserve beside the board edge nearest its corner HUD. */
export function reserveAnchor(seat: Seat): {
  position: Vec2;
  rotation: number;
} {
  return {
    position: fromSide(seat, 0, BOARD_HALF + 1.2),
    rotation: SIDES[seat].rotation,
  };
}

/** Orthographic screen coordinates (x right, y up) of a world point. */
export function screenPoint(x: number, y: number, z: number): Vec2 {
  const [cx, cy, cz] = CAMERA_OFFSET;
  const length = Math.hypot(cx, cy, cz);
  const forward = [-cx / length, -cy / length, -cz / length];
  // right = forward × up(0, 1, 0)
  const right = [-forward[2], 0, forward[0]];
  const rightLength = Math.hypot(right[0], right[2]);
  const rx = right[0] / rightLength;
  const rz = right[2] / rightLength;
  // up = right × forward
  const ux = -rz * forward[1];
  const uy = rz * forward[0] - rx * forward[2];
  const uz = rx * forward[1];
  return [x * rx + z * rz, x * ux + y * uy + z * uz];
}
