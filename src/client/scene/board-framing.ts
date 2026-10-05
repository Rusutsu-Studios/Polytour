import * as THREE from "three";
import { BOARD_SIZE } from "../../shared/board/index.js";
import { clampBoardZoom } from "../board-view.js";
import {
  BOARD_BOTTOM,
  BOARD_HALF,
  CAMERA_OFFSET,
  isCorner,
  LOT_TOP,
  tileCenter,
} from "./board-layout.js";
import { LANDMARK_PEAKS } from "./Landmarks.js";

export type BoardPan = { x: number; y: number };
export const CENTERED_BOARD: BoardPan = { x: 0, y: 0 };

export function clampBoardPan(pan: BoardPan, limits: BoardPan): BoardPan {
  return {
    x: THREE.MathUtils.clamp(pan.x, -limits.x, limits.x),
    y: THREE.MathUtils.clamp(pan.y, -limits.y, limits.y),
  };
}

/** Initial pose only; later framing leaves the Director's camera pose intact. */
export function initializeBoardCamera<T extends THREE.Camera>(camera: T): T {
  camera.position.set(...CAMERA_OFFSET);
  camera.lookAt(0, LOT_TOP, 0);
  camera.updateMatrixWorld();
  return camera;
}
/** The scene and its DOM lot labels use exactly the same projection. */
export function frameBoard(
  camera: THREE.OrthographicCamera,
  width: number,
  height: number,
  preview: boolean,
  requestedZoom: number,
  requestedPan: BoardPan = CENTERED_BOARD,
  ui = 1,
) {
  const zoom = clampBoardZoom(requestedZoom);
  camera.updateMatrixWorld();
  const insets = preview
    ? { top: height * 0.03, bottom: height * 0.03, side: width * 0.03 }
    : {
        top: THREE.MathUtils.clamp(height * 0.11, 78 * ui, 118 * ui),
        bottom: THREE.MathUtils.clamp(height * 0.125, 86 * ui, 134 * ui),
        side: width * 0.04,
      };
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const add = (x: number, y: number, z: number) =>
    bounds.expandByPoint(
      point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse),
    );
  const edge = BOARD_HALF + 0.08;
  for (const x of [-edge, edge])
    for (const z of [-edge, edge]) {
      add(x, BOARD_BOTTOM, z);
      add(x, LOT_TOP, z);
    }
  for (let tile = 0; tile < BOARD_SIZE; tile++) {
    const [x, z] = tileCenter(tile);
    add(x, LOT_TOP + (isCorner(tile) ? 0.95 : 0.8), z);
  }
  for (const [x, y, z] of LANDMARK_PEAKS) add(x, y, z);
  const availableWidth = Math.max(1, width - insets.side * 2);
  const availableHeight = Math.max(1, height - insets.top - insets.bottom);
  const unitsPerPixel = Math.max(
    (bounds.max.x - bounds.min.x) / availableWidth,
    (bounds.max.y - bounds.min.y) / availableHeight,
  );
  // At a close view, either edge can be brought into the HUD's free band.
  const limits = {
    x: Math.max(
      0,
      (bounds.max.x - bounds.min.x - (availableWidth * unitsPerPixel) / zoom) /
        2,
    ),
    y: Math.max(
      0,
      (bounds.max.y - bounds.min.y - (availableHeight * unitsPerPixel) / zoom) /
        2,
    ),
  };
  const pan = clampBoardPan(requestedPan, limits);
  const centerX = (bounds.min.x + bounds.max.x) / 2 - pan.x;
  const pixelY = insets.top + availableHeight / 2;
  const centerY =
    (bounds.min.y + bounds.max.y) / 2 +
    ((pixelY - height / 2) * unitsPerPixel) / zoom -
    pan.y;
  camera.left = centerX - (width * unitsPerPixel) / 2;
  camera.right = centerX + (width * unitsPerPixel) / 2;
  camera.top = centerY + (height * unitsPerPixel) / 2;
  camera.bottom = centerY - (height * unitsPerPixel) / 2;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  return { unitsPerPixel: unitsPerPixel / zoom, limits, pan, bounds, insets };
}
