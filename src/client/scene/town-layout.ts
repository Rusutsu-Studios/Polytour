import { type BoardRule, getBoard } from "../../shared/board/index.js";
import {
  LAWN_HALF,
  sideFrame,
  tileCenter,
  tileRotation,
  tileSide,
  type Vec2,
} from "./board-layout.js";

// The town that fills the middle of the board, in world units.
//
// A paved plaza stays free for the dice. A roundabout circles it and four
// avenues run from it to the corners, each ending in a turning circle. Facing
// every side of the board, one street holds a plot for each city or
// resort of that side, in play order. A plot shows what its owner has built,
// so the middle of the board grows with the game.
//
// Readability comes first: nothing in the town may hide the board road, a lot
// or the dice. Anything standing at a point may be at most `visibilityCap`
// tall there; the layout tests check every envelope below against the camera.

export const PLAZA_RADIUS = 1.34;
/** Center line of the one-way roundabout around the plaza. */
export const RING_RADIUS = 1.48;
export const RING_HALF_WIDTH = 0.14;
export const AVENUE_START = RING_RADIUS + RING_HALF_WIDTH;
export const AVENUE_HALF_WIDTH = 0.15;
export const LANE_OFFSET = 0.07;
/** Distance from the board center to each avenue's turning circle. */
export const TURNING_CIRCLE = 3.3;
export const TURNING_RADIUS = 0.15;
export const TURNING_CIRCLE_PAVED = 0.25;

export const PLOT_WIDTH = 0.36;
export const PLOT_DEPTH = 0.4;
/** Distance from the lawn edge to the middle of each street of plots. */
export const PLOT_INSET = 0.94;
/** The tallest building of the town: a landmark with its spire. */
export const TOWN_MAX_HEIGHT = 0.68;
/** Clearance kept between a shadowed strip of ground and the board road. */
const ROAD_CLEARANCE = 0.03;

/** Ground point `inset` in from a side's lawn edge, `along` its play axis. */
export function lawnPoint(side: number, along: number, inset: number): Vec2 {
  const frame = sideFrame(side);
  const out = LAWN_HALF - inset;
  return [
    frame.along[0] * along - frame.inward[0] * out,
    frame.along[1] * along - frame.inward[1] * out,
  ];
}

/** Unit direction from the board center toward corner `corner` (0–3). */
export function cornerDirection(corner: number): Vec2 {
  const [x, z] = tileCenter(corner * 8);
  const length = Math.hypot(x, z);
  return [x / length, z / length];
}

/** A point `distance` out along a corner's avenue, `across` to its left. */
export function avenuePoint(
  corner: number,
  distance: number,
  across: number,
): Vec2 {
  const [x, z] = cornerDirection(corner);
  // Left of the outward direction when seen from above: (-z, x) turned back.
  return [x * distance + z * across, z * distance - x * across];
}

export type TownPlot = {
  readonly tile: number;
  readonly side: 0 | 1 | 2 | 3;
  readonly position: Vec2;
  /** Same frame as the tile: local x along play, local z toward the center. */
  readonly rotation: number;
};

const PLOT_CACHE = new Map<BoardRule, readonly TownPlot[]>();

/** Each board gets a finite, evenly spaced street, including seven-property sides. */
export function townPlots(rule: BoardRule = "country"): readonly TownPlot[] {
  const cached = PLOT_CACHE.get(rule);
  if (cached) return cached;
  const board = getBoard(rule);
  const plots = [0, 1, 2, 3].flatMap((side) => {
    const properties = board.filter(
      (tile) =>
        (tile.kind === "city" || tile.kind === "resort") &&
        tileSide(tile.index) === side,
    );
    // A 0.41 pitch leaves room for the printed plot and its building envelope.
    // Six-plot legacy streets keep the gap around the central footpath.
    const along =
      properties.length === 6
        ? [-1.11, -0.69, -0.27, 0.27, 0.69, 1.11]
        : properties.map(
            (_, order) => (order - (properties.length - 1) / 2) * 0.41,
          );
    return properties.map((tile, order) => ({
      tile: tile.index,
      side: side as TownPlot["side"],
      position: lawnPoint(side, along[order], PLOT_INSET),
      rotation: tileRotation(tile.index),
    }));
  });
  PLOT_CACHE.set(rule, plots);
  return plots;
}

export const TOWN_PLOTS = townPlots();

export function townPlot(tile: number, rule: BoardRule = "country") {
  return townPlots(rule).find((plot) => plot.tile === tile);
}

/**
 * How tall something may stand on a square footprint without hiding the
 * board road behind it. Seen from the camera, a height h hides √2·h of
 * ground behind it, so h may not exceed the distance to the lawn edge
 * measured along both back axes.
 */
export function visibilityCap(x: number, z: number, radius: number) {
  return Math.min(x, z) - radius + LAWN_HALF - ROAD_CLEARANCE;
}

export type TownFeature = {
  readonly position: Vec2;
  /** Half extent of the square that holds the whole feature. */
  readonly radius: number;
  readonly height: number;
};

// Positive `across` is screen right on the avenue to Start. The fairground
// flanks that avenue: a big wheel on the right, a carousel on the left. A
// sailing pond near the island and a helipad near the world tour sit on the
// front side of their avenues, where nothing behind them needs to be seen.
// Every turning circle holds a fountain.
// The wheel turns square to the camera, so its rim runs along the screen
// diagonal and its square envelope is narrower than the wheel.
export const FERRIS_WHEEL_RADIUS = 0.36;
export const FERRIS_WHEEL: TownFeature = {
  position: avenuePoint(0, 2.86, 0.62),
  radius: FERRIS_WHEEL_RADIUS * Math.SQRT1_2 + 0.04,
  height: 0.88,
};
export const CAROUSEL: TownFeature = {
  position: avenuePoint(0, 2.84, -0.62),
  radius: 0.22,
  height: 0.42,
};
export const POND: TownFeature = {
  position: avenuePoint(1, 2.86, 0.66),
  radius: 0.3,
  height: 0.2,
};
export const HELIPAD: TownFeature = {
  position: avenuePoint(3, 2.86, -0.66),
  radius: 0.24,
  height: 0.2,
};
export const FOUNTAINS: readonly TownFeature[] = [0, 1, 2, 3].map((corner) => ({
  position: avenuePoint(corner, TURNING_CIRCLE, 0),
  radius: 0.07,
  height: 0.2,
}));

/** A tree, sized to stay under the visibility cap where it grows. */
export type TownTree = { readonly position: Vec2; readonly height: number };
export const TREE_RADIUS = 0.11;
const TREE_HEIGHT = 0.36;

function tree(position: Vec2): TownTree {
  const [x, z] = position;
  return {
    position,
    height: Math.min(TREE_HEIGHT, visibilityCap(x, z, TREE_RADIUS)),
  };
}

export const TOWN_TREES: readonly TownTree[] = [
  // Avenue rows: one pair before the plots, one pair beyond them.
  ...[0, 1, 2, 3].flatMap((corner) =>
    [1.86, 2.72].flatMap((distance) =>
      [-1, 1].map((left) => tree(avenuePoint(corner, distance, left * 0.32))),
    ),
  ),
  // Park strips between each street of plots and the board road.
  ...[0, 1, 2, 3].flatMap((side) =>
    [-0.92, -0.48, 0.48, 0.92].map((along) =>
      tree(lawnPoint(side, along, 0.4)),
    ),
  ),
].filter(
  (candidate) =>
    candidate.height >= 0.16 &&
    [FERRIS_WHEEL, CAROUSEL, POND, HELIPAD].every(
      (feature) =>
        Math.max(
          Math.abs(feature.position[0] - candidate.position[0]),
          Math.abs(feature.position[1] - candidate.position[1]),
        ) >
        feature.radius + TREE_RADIUS + 0.02,
    ),
);

/**
 * The cars' closed circuit, sampled every `spacing` units: in along an
 * avenue, a quarter of the roundabout, out along the next avenue, around its
 * turning circle and back in. One lap visits all four avenues.
 */
export function townCircuit(spacing = 0.02): readonly Vec2[] {
  const polyline: Vec2[] = [];
  const steps = 18;
  const [startX, startZ] = cornerDirection(0);
  let angle = Math.atan2(startZ, startX);
  for (let leg = 0; leg < 4; leg++) {
    const corner = cornerAt(angle);
    const next = cornerAt(angle - Math.PI / 2);
    // Traffic keeps right: inbound cars drive left of the outward axis.
    polyline.push(
      avenuePoint(corner, TURNING_CIRCLE - 0.12, LANE_OFFSET),
      avenuePoint(corner, AVENUE_START + 0.06, LANE_OFFSET),
    );
    // Counter-clockwise from above: the angle decreases.
    const offset = LANE_OFFSET / RING_RADIUS;
    for (let step = 0; step <= steps; step++) {
      const a = angle - offset - ((Math.PI / 2 - offset * 2) * step) / steps;
      polyline.push([Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS]);
    }
    polyline.push(
      avenuePoint(next, AVENUE_START + 0.06, -LANE_OFFSET),
      avenuePoint(next, TURNING_CIRCLE - 0.12, -LANE_OFFSET),
    );
    // Half way around the fountain, from the outbound lane to the inbound one.
    for (let step = 0; step <= steps; step++) {
      const turn = -Math.PI / 2 + (Math.PI * step) / steps;
      polyline.push(
        avenuePoint(
          next,
          TURNING_CIRCLE + Math.cos(turn) * TURNING_RADIUS,
          Math.sin(turn) * TURNING_RADIUS,
        ),
      );
    }
    angle -= Math.PI / 2;
  }
  return resample(smooth(polyline, 3), spacing);
}

function cornerAt(angle: number) {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let corner = 0; corner < 4; corner++) {
    const [x, z] = cornerDirection(corner);
    const d = Math.hypot(x - Math.cos(angle), z - Math.sin(angle));
    if (d < distance) {
      best = corner;
      distance = d;
    }
  }
  return best;
}

/** Chaikin corner cutting on a closed polyline. */
function smooth(points: readonly Vec2[], passes: number): Vec2[] {
  let current = [...points];
  for (let pass = 0; pass < passes; pass++) {
    const next: Vec2[] = [];
    for (let index = 0; index < current.length; index++) {
      const [ax, az] = current[index];
      const [bx, bz] = current[(index + 1) % current.length];
      next.push(
        [ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25],
        [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75],
      );
    }
    current = next;
  }
  return current;
}

/** Evenly spaced points along a closed polyline. */
function resample(points: readonly Vec2[], spacing: number): Vec2[] {
  const lengths = [0];
  for (let index = 0; index < points.length; index++) {
    const [ax, az] = points[index];
    const [bx, bz] = points[(index + 1) % points.length];
    lengths.push(lengths[index] + Math.hypot(bx - ax, bz - az));
  }
  const total = lengths[points.length];
  const count = Math.round(total / spacing);
  const result: Vec2[] = [];
  let segment = 0;
  for (let sample = 0; sample < count; sample++) {
    const distance = (sample * total) / count;
    while (lengths[segment + 1] < distance) segment += 1;
    const [ax, az] = points[segment];
    const [bx, bz] = points[(segment + 1) % points.length];
    const span = lengths[segment + 1] - lengths[segment];
    const t = span > 0 ? (distance - lengths[segment]) / span : 0;
    result.push([ax + (bx - ax) * t, az + (bz - az) * t]);
  }
  return result;
}
