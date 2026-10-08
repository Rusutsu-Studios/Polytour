import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BOARD_ZOOM, clampBoardZoom } from "../board-view.js";
import {
  BOARD_ELEVATION,
  boardScreenHit,
  boardViewRotation,
  DEFAULT_BOARD_ORIENTATION,
  frameBoard,
  initializeBoardCamera,
  rotateBoardOrientation,
} from "./board-framing.js";
import {
  BOARD_HALF,
  CAMERA_OFFSET,
  LAWN_TOP,
  LOT_TOP,
  tilePoint,
} from "./board-layout.js";

const SIZES = [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
] as const;

function screen(
  camera: THREE.OrthographicCamera,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const point = new THREE.Vector3(x, y, 0).applyMatrix4(
    camera.projectionMatrix,
  );
  return { x: ((point.x + 1) * width) / 2, y: ((1 - point.y) * height) / 2 };
}

describe("player board framing", () => {
  it("accepts the supported steps and replaces invalid saved preferences", () => {
    expect(clampBoardZoom(Number.NaN)).toBe(1);
    expect(clampBoardZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampBoardZoom(-2)).toBe(BOARD_ZOOM.min);
    expect(clampBoardZoom(8)).toBe(BOARD_ZOOM.max);
    expect(clampBoardZoom(1.2000000000000002)).toBe(1.2);
  });

  it("preserves the Director's camera pose while applying user zoom and pan", () => {
    const camera = initializeBoardCamera(new THREE.OrthographicCamera());
    camera.position.set(12, 18, 9);
    camera.lookAt(1, LOT_TOP, -1);
    const position = camera.position.clone();
    const quaternion = camera.quaternion.clone();
    frameBoard(camera, 1440, 900, false, 1.8, { x: 0.6, y: -0.4 });
    expect(camera.position.equals(position)).toBe(true);
    expect(camera.quaternion.equals(quaternion)).toBe(true);
    expect(camera.zoom).toBe(1.8);
  });
  it("keeps intermediate reset zoom continuous instead of rounding to preference steps", () => {
    const camera = initializeBoardCamera(new THREE.OrthographicCamera());
    frameBoard(camera, 1440, 900, false, 1.347);
    expect(camera.zoom).toBe(1.347);
    frameBoard(camera, 1440, 900, false, 1.346);
    expect(camera.zoom).toBe(1.346);
  });
  it("turns gently and bounds pitch without accumulating full turns", () => {
    const gentle = rotateBoardOrientation(DEFAULT_BOARD_ORIENTATION, 120, 60);
    expect(gentle.yaw).toBeGreaterThan(0);
    expect(gentle.yaw).toBeLessThan(Math.PI / 9);
    expect(gentle.pitch).toBeCloseTo(0.09);
    const far = rotateBoardOrientation(gentle, 100_000, 100_000);
    expect(Math.abs(far.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(far.pitch).toBe(BOARD_ELEVATION.max - BOARD_ELEVATION.default);
    expect(rotateBoardOrientation(far, -100_000, -100_000).pitch).toBe(
      BOARD_ELEVATION.min - BOARD_ELEVATION.default,
    );
  });

  it("maps downward drag toward overhead and upward drag toward a low viewing dome", () => {
    const sight = new THREE.Vector3(...CAMERA_OFFSET)
      .sub(new THREE.Vector3(0, LOT_TOP, 0))
      .normalize();
    for (const [dy, elevation] of [
      [100_000, BOARD_ELEVATION.max],
      [-100_000, BOARD_ELEVATION.min],
    ] as const) {
      const orientation = rotateBoardOrientation(
        DEFAULT_BOARD_ORIENTATION,
        0,
        dy,
      );
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(
        boardViewRotation(orientation),
      );
      expect(Math.asin(normal.dot(sight))).toBeCloseTo(elevation, 12);
    }
  });
  it("raycasts the actual rotated board center, tiles and edges, excluding empty backdrop", () => {
    const width = 1440;
    const height = 900;
    const camera = initializeBoardCamera(new THREE.OrthographicCamera());
    for (const orientation of [
      DEFAULT_BOARD_ORIENTATION,
      { yaw: 0.6, pitch: 0.12 },
    ]) {
      const rotation = boardViewRotation(orientation);
      frameBoard(camera, width, height, false, 1, undefined, 1, rotation);
      const [tileX, tileZ] = tilePoint(1, 0, 0.3);
      for (const local of [
        new THREE.Vector3(0, LOT_TOP, 0),
        new THREE.Vector3(tileX, LOT_TOP, tileZ),
        new THREE.Vector3(BOARD_HALF - 0.01, LOT_TOP, 0),
      ]) {
        const point = local.applyQuaternion(rotation).project(camera);
        expect(
          boardScreenHit(
            camera,
            width,
            height,
            ((point.x + 1) * width) / 2,
            ((1 - point.y) * height) / 2,
            rotation,
          ),
        ).toBe(true);
      }
      expect(boardScreenHit(camera, width, height, 10, 10, rotation)).toBe(
        false,
      );
      expect(
        boardScreenHit(
          camera,
          width,
          height,
          width - 10,
          height - 10,
          rotation,
        ),
      ).toBe(false);
    }
  });
  for (const [width, height] of SIZES) {
    for (const zoom of [BOARD_ZOOM.min, BOARD_ZOOM.default]) {
      it(`fits every board envelope at ${width}x${height}, zoom ${zoom}`, () => {
        const camera = initializeBoardCamera(new THREE.OrthographicCamera());
        const { bounds, insets, pan } = frameBoard(
          camera,
          width,
          height,
          false,
          zoom,
          { x: 100, y: -100 },
        );
        expect(pan.x).toBeCloseTo(0, 12);
        expect(pan.y).toBeCloseTo(0, 12);
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y]) {
            const point = screen(camera, x, y, width, height);
            expect(point.x).toBeGreaterThanOrEqual(insets.side - 0.001);
            expect(point.x).toBeLessThanOrEqual(width - insets.side + 0.001);
            expect(point.y).toBeGreaterThanOrEqual(insets.top - 0.001);
            expect(point.y).toBeLessThanOrEqual(height - insets.bottom + 0.001);
          }
      });
    }

    it(`keeps projection scale fixed and every lot reachable across dome orbit at ${width}x${height}`, () => {
      const camera = initializeBoardCamera(new THREE.OrthographicCamera());
      for (const zoom of [BOARD_ZOOM.min, BOARD_ZOOM.default, BOARD_ZOOM.max]) {
        const baseline = frameBoard(camera, width, height, false, zoom);
        const baselineWidth = camera.right - camera.left;
        const baselineHeight = camera.top - camera.bottom;
        for (const orientation of [
          DEFAULT_BOARD_ORIENTATION,
          { yaw: 0.7, pitch: BOARD_ELEVATION.max - BOARD_ELEVATION.default },
          { yaw: -1.4, pitch: BOARD_ELEVATION.min - BOARD_ELEVATION.default },
        ]) {
          const rotation = boardViewRotation(orientation);
          const frame = frameBoard(
            camera,
            width,
            height,
            false,
            zoom,
            undefined,
            1,
            rotation,
          );
          expect(frame.unitsPerPixel).toBe(baseline.unitsPerPixel);
          expect(camera.right - camera.left).toBeCloseTo(baselineWidth, 12);
          expect(camera.top - camera.bottom).toBeCloseTo(baselineHeight, 12);
          expect(camera.zoom).toBe(zoom);
          if (orientation.pitch > 0) expect(frame.limits.y).toBeGreaterThan(0);
          for (let tile = 0; tile < 32; tile++) {
            const [x, z] = tilePoint(tile, 0, 0.3);
            const cameraPoint = new THREE.Vector3(x, LOT_TOP + 0.08, z)
              .applyQuaternion(rotation)
              .applyMatrix4(camera.matrixWorldInverse);
            const pan = {
              x: (frame.bounds.min.x + frame.bounds.max.x) / 2 - cameraPoint.x,
              y: (frame.bounds.min.y + frame.bounds.max.y) / 2 - cameraPoint.y,
            };
            frameBoard(camera, width, height, false, zoom, pan, 1, rotation);
            const point = screen(
              camera,
              cameraPoint.x,
              cameraPoint.y,
              width,
              height,
            );
            expect(point.x).toBeGreaterThanOrEqual(frame.insets.side - 0.001);
            expect(point.x).toBeLessThanOrEqual(
              width - frame.insets.side + 0.001,
            );
            expect(point.y).toBeGreaterThanOrEqual(frame.insets.top - 0.001);
            expect(point.y).toBeLessThanOrEqual(
              height - frame.insets.bottom + 0.001,
            );
          }
        }
      }
    });

    it(`keeps the default home preview fully framed at ${width}x${height}`, () => {
      const camera = initializeBoardCamera(new THREE.OrthographicCamera());
      const { bounds } = frameBoard(camera, width, height, true, 1);
      const lower = screen(camera, bounds.min.x, bounds.min.y, width, height);
      const upper = screen(camera, bounds.max.x, bounds.max.y, width, height);
      expect(
        Math.max((upper.x - lower.x) / width, (lower.y - upper.y) / height),
      ).toBeGreaterThan(0.9);
    });
    it(`bounds maximum-zoom pan and reaches every property at ${width}x${height}`, () => {
      const camera = initializeBoardCamera(new THREE.OrthographicCamera());
      const initial = frameBoard(camera, width, height, false, BOARD_ZOOM.max);
      for (const sign of [-1, 1]) {
        const frame = frameBoard(camera, width, height, false, BOARD_ZOOM.max, {
          x: sign * 100,
          y: sign * 100,
        });
        expect(frame.pan.x).toBe(sign * initial.limits.x);
        expect(frame.pan.y).toBe(sign * initial.limits.y);
        const y = sign > 0 ? initial.bounds.min.y : initial.bounds.max.y;
        const point = screen(camera, initial.bounds.min.x, y, width, height);
        expect(point.y).toBeCloseTo(
          sign > 0 ? height - frame.insets.bottom : frame.insets.top,
          6,
        );
      }
      for (let tile = 0; tile < 32; tile++) {
        const [x, z] = tilePoint(tile, 0, 0.3);
        const cameraPoint = new THREE.Vector3(
          x,
          LOT_TOP + 0.08,
          z,
        ).applyMatrix4(camera.matrixWorldInverse);
        const requested = {
          x: (initial.bounds.min.x + initial.bounds.max.x) / 2 - cameraPoint.x,
          y: (initial.bounds.min.y + initial.bounds.max.y) / 2 - cameraPoint.y,
        };
        const frame = frameBoard(
          camera,
          width,
          height,
          false,
          BOARD_ZOOM.max,
          requested,
        );
        const point = screen(
          camera,
          cameraPoint.x,
          cameraPoint.y,
          width,
          height,
        );
        expect(point.x).toBeGreaterThanOrEqual(frame.insets.side - 0.001);
        expect(point.x).toBeLessThanOrEqual(width - frame.insets.side + 0.001);
        expect(point.y).toBeGreaterThanOrEqual(frame.insets.top - 0.001);
        expect(point.y).toBeLessThanOrEqual(
          height - frame.insets.bottom + 0.001,
        );
      }
    });

    it(`aligns sale quotes and the Roll anchor throughout dome orbit at ${width}x${height}`, () => {
      for (const orientation of [
        { yaw: 0.7, pitch: BOARD_ELEVATION.max - BOARD_ELEVATION.default },
        { yaw: -1.4, pitch: BOARD_ELEVATION.min - BOARD_ELEVATION.default },
      ]) {
        const rotation = boardViewRotation(orientation);
        const group = new THREE.Group();
        group.quaternion.copy(rotation);
        group.updateMatrixWorld();
        for (const zoom of [BOARD_ZOOM.min, BOARD_ZOOM.max]) {
          const sceneCamera = initializeBoardCamera(
            new THREE.OrthographicCamera(),
          );
          const labelCamera = initializeBoardCamera(
            new THREE.OrthographicCamera(),
          );
          const pan = { x: -1.5, y: 1.2 };
          frameBoard(sceneCamera, width, height, false, zoom, pan, 1, rotation);
          frameBoard(labelCamera, width, height, false, zoom, pan, 1, rotation);
          const points = Array.from({ length: 32 }, (_, tile) => {
            const [x, z] = tilePoint(tile, 0, 0.3);
            return new THREE.Vector3(x, LOT_TOP + 0.08, z);
          });
          points.push(new THREE.Vector3(1.05, LAWN_TOP, 1.05));
          for (const point of points) {
            const scene = point
              .clone()
              .applyMatrix4(group.matrixWorld)
              .project(sceneCamera);
            const overlay = point
              .clone()
              .applyQuaternion(rotation)
              .project(labelCamera);
            expect(overlay.x).toBeCloseTo(scene.x, 12);
            expect(overlay.y).toBeCloseTo(scene.y, 12);
          }
        }
      }
    });
    it(`keeps forced-sale quotes on their scene lots through zoom and pan at ${width}x${height}`, () => {
      for (const zoom of [BOARD_ZOOM.min, BOARD_ZOOM.max]) {
        const sceneCamera = new THREE.OrthographicCamera(
          -1,
          1,
          1,
          -1,
          0.1,
          100,
        );
        const labelCamera = initializeBoardCamera(
          new THREE.OrthographicCamera(),
        );
        initializeBoardCamera(sceneCamera);
        const requestedPan = { x: -1.5, y: 1.2 };
        frameBoard(sceneCamera, width, height, false, zoom, requestedPan);
        frameBoard(labelCamera, width, height, false, zoom, requestedPan);
        for (let tile = 0; tile < 32; tile++) {
          const [x, z] = tilePoint(tile, 0, 0.3);
          const point = new THREE.Vector3(x, LOT_TOP + 0.08, z);
          const scene = point.clone().project(sceneCamera);
          const label = point.clone().project(labelCamera);
          expect(label.x).toBeCloseTo(scene.x, 12);
          expect(label.y).toBeCloseTo(scene.y, 12);
        }
      }
    });
  }
});
