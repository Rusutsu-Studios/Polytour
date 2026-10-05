import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BOARD_ZOOM, clampBoardZoom } from "../board-view.js";
import { frameBoard, initializeBoardCamera } from "./board-framing.js";
import { LOT_TOP, tilePoint } from "./board-layout.js";

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
