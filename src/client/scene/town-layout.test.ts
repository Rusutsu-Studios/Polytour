import { describe, expect, it } from "vitest";
import { BOARD, getBoard } from "../../shared/board/index.js";
import type { Seat } from "../../shared/engine/index.js";
import {
  CAMERA_OFFSET,
  isCorner,
  LAWN_HALF,
  LAWN_TOP,
  LOT_TOP,
  passingSpot,
  pawnSpot,
  ROAD_TOP,
  ROAD_WIDTH,
  screenPoint,
  sideFrame,
  tilePoint,
  tileSide,
  tileSize,
  type Vec2,
} from "./board-layout.js";
import {
  AVENUE_HALF_WIDTH,
  AVENUE_START,
  CAROUSEL,
  cornerDirection,
  FERRIS_WHEEL,
  FOUNTAINS,
  HELIPAD,
  LANE_OFFSET,
  PLAZA_RADIUS,
  PLOT_DEPTH,
  PLOT_WIDTH,
  POND,
  plotTree,
  RING_HALF_WIDTH,
  RING_RADIUS,
  TOWN_MAX_HEIGHT,
  type TOWN_PLOTS,
  TOWN_TREES,
  TREE_RADIUS,
  TURNING_CIRCLE,
  TURNING_CIRCLE_PAVED,
  townCircuit,
  townPlots,
} from "./town-layout.js";

const SEATS: readonly Seat[] = [0, 1, 2, 3];
// Where the dice rest on the plaza. A die at rest sits square to the world
// axes, 0.75 wide; a small margin covers its rounded edges and shadow.
const DICE: readonly Vec2[] = [
  [-0.56, 0.56],
  [0.56, -0.56],
];
const DIE_HALF = 0.4;

type Box = {
  center: Vec2;
  halfX: number;
  halfZ: number;
  height: number;
  name: string;
};

function plotBox(plot: (typeof TOWN_PLOTS)[number]): Box {
  // Lots on sides 1 and 3 run along z, so their plots turn with them.
  const alongX = plot.side % 2 === 0;
  const halfAlong = PLOT_WIDTH / 2 + 0.02;
  const halfDepth = PLOT_DEPTH / 2 + 0.02;
  return {
    center: plot.position,
    halfX: alongX ? halfAlong : halfDepth,
    halfZ: alongX ? halfDepth : halfAlong,
    height: TOWN_MAX_HEIGHT,
    name: `plot ${plot.tile}`,
  };
}

function squareBox(
  center: Vec2,
  radius: number,
  height: number,
  name: string,
): Box {
  return { center, halfX: radius, halfZ: radius, height, name };
}

const FEATURES = {
  "ferris wheel": FERRIS_WHEEL,
  carousel: CAROUSEL,
  pond: POND,
  helipad: HELIPAD,
};

function envelopes(plots: typeof TOWN_PLOTS): readonly Box[] {
  return [
    ...plots.map(plotBox),
    ...plots.map((plot) => {
      const tree = plotTree(plot);
      return squareBox(tree.position, TREE_RADIUS, tree.height, "plot tree");
    }),
    ...TOWN_TREES.map((tree) =>
      squareBox(tree.position, TREE_RADIUS, tree.height, "tree"),
    ),
    ...Object.entries(FEATURES).map(([name, feature]) =>
      squareBox(feature.position, feature.radius, feature.height, name),
    ),
    ...FOUNTAINS.map((fountain) =>
      squareBox(
        fountain.position,
        fountain.radius,
        fountain.height,
        "fountain",
      ),
    ),
  ];
}

function corners(box: Box) {
  const points: [number, number, number][] = [];
  for (const dx of [-1, 1])
    for (const dz of [-1, 1])
      for (const y of [LAWN_TOP, LAWN_TOP + box.height])
        points.push([
          box.center[0] + dx * box.halfX,
          y,
          box.center[1] + dz * box.halfZ,
        ]);
  return points;
}

/** Larger means nearer the camera. */
function nearness([x, y, z]: readonly [number, number, number]) {
  return x * CAMERA_OFFSET[0] + y * CAMERA_OFFSET[1] + z * CAMERA_OFFSET[2];
}

function hull(points: readonly Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    )
      lower.pop();
    lower.push(point);
  }
  const upper: Vec2[] = [];
  for (const point of [...sorted].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    )
      upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function inside(polygon: readonly Vec2[], [x, y]: Vec2) {
  for (let index = 0; index < polygon.length; index++) {
    const [ax, ay] = polygon[index];
    const [bx, by] = polygon[(index + 1) % polygon.length];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 1e-9) return false;
  }
  return true;
}

/**
 * Conservative: a point inside the box's screen silhouette counts as hidden
 * as soon as it lies farther from the camera than the middle of the box.
 */
function hides(box: Box, point: readonly [number, number, number]) {
  const projected = corners(box).map(([x, y, z]) => screenPoint(x, y, z));
  if (!inside(hull(projected), screenPoint(...point))) return false;
  const middle: [number, number, number] = [
    box.center[0],
    LAWN_TOP + box.height / 2,
    box.center[1],
  ];
  return nearness(point) < nearness(middle);
}

function protectedPoints() {
  const points: { at: [number, number, number]; name: string }[] = [];
  for (const tile of BOARD) {
    for (const seat of SEATS) {
      const [x, z] = pawnSpot(seat, tile.index);
      points.push({
        at: [x, isCorner(tile.index) ? LOT_TOP : ROAD_TOP, z],
        name: `pawn ${seat} on ${tile.index}`,
      });
      // Walking pawns turn corners on the road's corner square.
      const [px, pz] = passingSpot(seat, tile.index);
      points.push({
        at: [px, ROAD_TOP, pz],
        name: `pawn ${seat} passing ${tile.index}`,
      });
    }
    // The whole printed lot: name, price, plot and buildings.
    const [along, depth] = tileSize(tile.index);
    for (let i = -2; i <= 2; i++)
      for (let j = -3; j <= 3; j++) {
        const [x, z] = tilePoint(
          tile.index,
          (i / 2) * (along / 2 - 0.04),
          (j / 3) * (depth / 2 - 0.04),
        );
        points.push({ at: [x, LOT_TOP, z], name: `lot ${tile.index}` });
      }
  }
  // The board road from just outside the lawn to the lots.
  for (let side = 0; side < 4; side++) {
    const { along, inward } = sideFrame(side);
    for (let step = -34; step <= 34; step++)
      for (const out of [0.06, ROAD_WIDTH / 2, ROAD_WIDTH - 0.02]) {
        const distance = LAWN_HALF + out;
        points.push({
          at: [
            along[0] * step * 0.1 - inward[0] * distance,
            ROAD_TOP,
            along[1] * step * 0.1 - inward[1] * distance,
          ],
          name: `road of side ${side}`,
        });
      }
  }
  for (const [index, [dx, dz]] of DICE.entries())
    for (let i = -4; i <= 4; i++)
      for (let j = -4; j <= 4; j++)
        points.push({
          at: [dx + (i / 4) * DIE_HALF, LAWN_TOP, dz + (j / 4) * DIE_HALF],
          name: `die ${index}`,
        });
  return points;
}

function overlap(a: Box, b: Box) {
  return (
    Math.abs(a.center[0] - b.center[0]) < a.halfX + b.halfX &&
    Math.abs(a.center[1] - b.center[1]) < a.halfZ + b.halfZ
  );
}

/** Distance from a point to the nearest avenue axis, and along it. */
function avenueDistance([x, z]: Vec2) {
  let best = { across: Number.POSITIVE_INFINITY, along: 0 };
  for (let corner = 0; corner < 4; corner++) {
    const [cx, cz] = cornerDirection(corner);
    const along = x * cx + z * cz;
    const across = Math.abs(x * cz - z * cx);
    if (along > 0 && across < best.across) best = { across, along };
  }
  return best;
}

function onAvenue(box: Box) {
  for (const dx of [-1, 0, 1])
    for (const dz of [-1, 0, 1]) {
      const point: Vec2 = [
        box.center[0] + dx * box.halfX,
        box.center[1] + dz * box.halfZ,
      ];
      const { across, along } = avenueDistance(point);
      if (
        across < AVENUE_HALF_WIDTH &&
        along < TURNING_CIRCLE + TURNING_CIRCLE_PAVED
      )
        return true;
    }
  return false;
}

describe.each(["country", "legacy"] as const)("%s town layout", (rule) => {
  const board = getBoard(rule);
  const plots = townPlots(rule);
  const boxes = envelopes(plots);
  it("gives every city and resort one plot facing its own side", () => {
    const owned = board.filter(
      (tile) => tile.kind === "city" || tile.kind === "resort",
    );
    expect(plots.map((plot) => plot.tile)).toEqual(
      owned.map((tile) => tile.index),
    );
    for (let side = 0; side < 4; side++) {
      const sidePlots = plots.filter((plot) => plot.side === side);
      expect(sidePlots).toHaveLength(
        owned.filter((tile) => tileSide(tile.index) === side).length,
      );
      for (const plot of sidePlots) {
        expect(tileSide(plot.tile)).toBe(side);
        expect(plot.position.every(Number.isFinite)).toBe(true);
      }
      // Plots follow the lots' play order across the screen.
      const lots = sidePlots.map((plot) => {
        const [x, z] = tilePoint(plot.tile, 0, 0);
        return screenPoint(x, LOT_TOP, z)[0];
      });
      const screen = sidePlots.map(
        (plot) => screenPoint(plot.position[0], LAWN_TOP, plot.position[1])[0],
      );
      const direction = Math.sign(lots[lots.length - 1] - lots[0]);
      for (let index = 1; index < sidePlots.length; index++)
        expect(Math.sign(screen[index] - screen[index - 1])).toBe(direction);
    }
  });

  it("keeps plots, trees and attractions apart, on the lawn, off the roads", () => {
    const solids = boxes.filter((box) => box.name !== "plot tree");
    for (const [index, box] of solids.entries()) {
      for (const [x, z] of [
        [box.center[0] - box.halfX, box.center[1] - box.halfZ],
        [box.center[0] + box.halfX, box.center[1] + box.halfZ],
      ])
        expect(Math.max(Math.abs(x), Math.abs(z)), box.name).toBeLessThan(
          LAWN_HALF,
        );
      if (box.name !== "fountain") {
        expect(onAvenue(box), box.name).toBe(false);
        const nearest = Math.hypot(
          Math.max(0, Math.abs(box.center[0]) - box.halfX),
          Math.max(0, Math.abs(box.center[1]) - box.halfZ),
        );
        expect(nearest, box.name).toBeGreaterThan(AVENUE_START);
      }
      for (const other of solids.slice(index + 1))
        expect(overlap(box, other), `${box.name} / ${other.name}`).toBe(false);
    }
  });

  it("never hides a pawn, a lot, the board road or the dice", () => {
    const points = protectedPoints();
    for (const box of boxes)
      for (const point of points)
        expect(hides(box, point.at), `${box.name} hides ${point.name}`).toBe(
          false,
        );
  });

  it("drives the cars on a closed circuit of paved roads", () => {
    const circuit = townCircuit();
    expect(circuit.length).toBeGreaterThan(500);
    for (const [index, [x, z]] of circuit.entries()) {
      const [nx, nz] = circuit[(index + 1) % circuit.length];
      expect(Math.hypot(nx - x, nz - z)).toBeCloseTo(0.02, 2);
      const radius = Math.hypot(x, z);
      expect(radius).toBeGreaterThan(PLAZA_RADIUS + 0.05);
      const onRing = Math.abs(radius - RING_RADIUS) < RING_HALF_WIDTH;
      const { across, along } = avenueDistance([x, z]);
      const onAvenueLane =
        across <= LANE_OFFSET + 0.02 && along <= TURNING_CIRCLE;
      const onTurningCircle =
        Math.hypot(along - TURNING_CIRCLE, across) < TURNING_CIRCLE_PAVED;
      expect(onRing || onAvenueLane || onTurningCircle, `${x}, ${z}`).toBe(
        true,
      );
    }
  });
});
