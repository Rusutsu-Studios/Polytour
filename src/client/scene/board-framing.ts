import * as THREE from "three";
import { BOARD_SIZE } from "../../shared/board/index.js";
import { BOARD_ZOOM } from "../board-view.js";
import {
  BOARD_BOTTOM,
  BOARD_HALF,
  CAMERA_OFFSET,
  isCorner,
  LOT_TOP,
  tileCenter,
} from "./board-layout.js";
import { LANDMARK_PEAKS } from "./Landmarks.js";

export type BoardOrientation = { yaw: number; pitch: number };
export const DEFAULT_BOARD_ORIENTATION: BoardOrientation = { yaw: 0, pitch: 0 };
export const BOARD_DRAG_THRESHOLD = 8;
const YAW_PER_PIXEL = 0.0025;
const PITCH_PER_PIXEL = 0.0015;
export const BOARD_ELEVATION = {
  min: Math.PI / 12,
  max: (85 * Math.PI) / 180,
  default: Math.atan2(
    CAMERA_OFFSET[1] - LOT_TOP,
    Math.hypot(CAMERA_OFFSET[0], CAMERA_OFFSET[2]),
  ),
} as const;
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();

/** A downward drag climbs the viewing dome; yaw allows a full turn. */
export function rotateBoardOrientation(
  orientation: BoardOrientation,
  dx: number,
  dy: number,
): BoardOrientation {
  const fullTurn = Math.PI * 2;
  return {
    yaw:
      ((((orientation.yaw + dx * YAW_PER_PIXEL + Math.PI) % fullTurn) +
        fullTurn) %
        fullTurn) -
      Math.PI,
    pitch: THREE.MathUtils.clamp(
      orientation.pitch + dy * PITCH_PER_PIXEL,
      BOARD_ELEVATION.min - BOARD_ELEVATION.default,
      BOARD_ELEVATION.max - BOARD_ELEVATION.default,
    ),
  };
}

/** Local board rotation composes with, and never replaces, the camera pose. */
export function boardViewRotation(
  orientation: BoardOrientation,
): THREE.Quaternion {
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    orientation.yaw,
  );
  return new THREE.Quaternion()
    .setFromAxisAngle(SCREEN_RIGHT, orientation.pitch)
    .multiply(yaw);
}

export function boardScreenHit(
  camera: THREE.Camera,
  width: number,
  height: number,
  x: number,
  y: number,
  rotation: THREE.Quaternion,
): boolean {
  if (!width || !height) return false;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2((x / width) * 2 - 1, 1 - (y / height) * 2),
    camera,
  );
  const inverse = new THREE.Matrix4()
    .makeRotationFromQuaternion(rotation)
    .invert();
  const localRay = raycaster.ray.clone().applyMatrix4(inverse);
  const edge = BOARD_HALF + 0.08;
  const box = new THREE.Box3(
    new THREE.Vector3(-edge, BOARD_BOTTOM, -edge),
    new THREE.Vector3(edge, LOT_TOP, edge),
  );
  return localRay.intersectBox(box, new THREE.Vector3()) !== null;
}
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
  rotation = new THREE.Quaternion(),
) {
  const zoom = Number.isFinite(requestedZoom)
    ? THREE.MathUtils.clamp(requestedZoom, BOARD_ZOOM.min, BOARD_ZOOM.max)
    : BOARD_ZOOM.default;
  camera.updateMatrixWorld();
  const insets = preview
    ? { top: height * 0.03, bottom: height * 0.03, side: width * 0.03 }
    : {
        top: THREE.MathUtils.clamp(height * 0.11, 78 * ui, 118 * ui),
        bottom: THREE.MathUtils.clamp(height * 0.125, 86 * ui, 134 * ui),
        side: width * 0.04,
      };
  const bounds = new THREE.Box3();
  const referenceBounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const add = (x: number, y: number, z: number) => {
    referenceBounds.expandByPoint(
      point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse),
    );
    bounds.expandByPoint(
      point
        .set(x, y, z)
        .applyQuaternion(rotation)
        .applyMatrix4(camera.matrixWorldInverse),
    );
  };
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
  // Orbit changes foreshortening, never the player's projection scale.
  const unitsPerPixel = Math.max(
    (referenceBounds.max.x - referenceBounds.min.x) / availableWidth,
    (referenceBounds.max.y - referenceBounds.min.y) / availableHeight,
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
