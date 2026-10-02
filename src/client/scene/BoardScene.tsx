import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BOARD, DECISION_TIMING, ECONOMY } from "../../shared/board/index.js";
import type {
  GameEvent,
  PublicState,
  Seat,
} from "../../shared/engine/index.js";
import { getProperty, propertyRent } from "../../shared/engine/index.js";
import type { AnimationContext } from "../director/director.js";
import { director } from "../director/director.js";
import { useLocale } from "../i18n.js";
import { PLAYER_COLORS, tileColor, tilePrice } from "../ui/board-display.js";
import {
  BOARD_BOTTOM,
  BOARD_HALF,
  BOARD_TOP,
  buildingBandZ,
  CAMERA_OFFSET,
  faceRotation,
  INNER_HALF,
  isCorner,
  LAWN_HALF,
  LAWN_TOP,
  LOT_DEPTH,
  LOT_GAP,
  LOT_TOP,
  LOT_WIDTH,
  passingSpot,
  pawnSpot,
  ROAD_TOP,
  reserveAnchor,
  screenTop,
  sideFrame,
  tileCenter,
  tilePoint,
  tileRotation,
  tileSize,
  visibleFaces,
} from "./board-layout.js";
import {
  cornerTexture,
  lawnTexture,
  lotTexture,
  markerTexture,
  noteTexture,
  roadTexture,
  scoreTexture,
  seatBadgeTexture,
} from "./board-textures.js";
import { BeachUmbrella, Landmarks } from "./Landmarks.js";

type BoardProps = {
  state: PublicState | null;
  selected: number | null;
  onSelect: (tile: number) => void;
  preview?: boolean;
  zoom?: number;
};

// THESIS: a printed property board seen from its Start corner, like the classic tabletop.
// OWN-WORLD: ivory lots with colored plots, big printed prices, a mown lawn, toy buildings.
// STORY: roll, travel left from Start, buy, build, collect; the server owns every rule.
// FIRST VIEWPORT: a diamond board between four corner players, the choice below it.
// FORM: large corners (a printed Start, three landmarks), seven deep lots per side, a road.

const PAWN_SCALE = 0.85;
// The pawn base sits this far below the pawn group's origin.
const PAWN_LIFT = 0.03 * PAWN_SCALE;
const DIE_SIZE = 0.6;
const DIE_SCALE = 1.25;
const DIE_REST_Y = LAWN_TOP + (DIE_SIZE * DIE_SCALE) / 2;
const DIE_REST: readonly [number, number, number][] = [
  [-0.56, DIE_REST_Y, 0.56],
  [0.56, DIE_REST_Y, -0.56],
];
const DICE_DEFAULT_COLOR = "#d9473a";
// The dice take the roller's color, brighter than the pawn so pips stay crisp.
const DICE_COLORS = ["#e0533b", "#3a87e2", "#9564d3", "#2f9b5f"] as const;
const [BANK_X, BANK_Z] = tileCenter(0);
const BANK_POSITION: readonly [number, number, number] = [BANK_X, 0.7, BANK_Z];

function pawnPosition(seat: Seat, tile: number): [number, number, number] {
  const [x, z] = pawnSpot(seat, tile);
  return [x, (isCorner(tile) ? LOT_TOP : ROAD_TOP) + PAWN_LIFT, z];
}

/** Where a walking pawn touches down on a tile it passes without stopping. */
function passingPosition(seat: Seat, tile: number): [number, number, number] {
  const [x, z] = passingSpot(seat, tile);
  return [x, ROAD_TOP + PAWN_LIFT, z];
}

function BoardBase({ onRendered }: { onRendered: () => void }) {
  const lawn = useMemo(lawnTexture, []);
  const road = useMemo(roadTexture, []);
  useEffect(
    () => () => {
      lawn.dispose();
      road.dispose();
    },
    [lawn, road],
  );
  // A two-tone edge: a darker base under a lighter rim that frames the lots.
  const lower = BOARD_HALF * 2 + 0.16;
  const upper = BOARD_HALF * 2 + 0.08;
  const seam = 0.1;
  return (
    <group>
      <mesh position={[0, BOARD_BOTTOM - 0.002, 0]} receiveShadow>
        <boxGeometry args={[200, 0.002, 200]} />
        <shadowMaterial opacity={0.13} />
      </mesh>
      <mesh
        position={[0, (BOARD_BOTTOM + seam) / 2, 0]}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[lower, seam - BOARD_BOTTOM, lower]} />
        <meshStandardMaterial color="#a597ad" roughness={1} />
      </mesh>
      <mesh
        position={[0, (seam + BOARD_TOP) / 2, 0]}
        receiveShadow
        castShadow
        onAfterRender={onRendered}
      >
        <boxGeometry args={[upper, BOARD_TOP - seam, upper]} />
        <meshStandardMaterial color="#e9e3ed" roughness={1} />
      </mesh>
      <mesh
        position={[0, ROAD_TOP, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[INNER_HALF * 2, INNER_HALF * 2]} />
        <meshStandardMaterial map={road} roughness={1} />
      </mesh>
      <mesh
        position={[0, LAWN_TOP, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[LAWN_HALF * 2, LAWN_HALF * 2]} />
        <meshStandardMaterial map={lawn} roughness={1} />
      </mesh>
    </group>
  );
}

function TileFace({
  index,
  amount,
  owner,
  salary,
  onSelect,
  preview,
}: {
  index: number;
  amount: number | null;
  owner: Seat | null;
  salary: number;
  onSelect: (tile: number) => void;
  preview?: boolean;
}) {
  const { locale } = useLocale();
  const texture = useMemo(
    () =>
      isCorner(index)
        ? cornerTexture(index, locale, salary)
        : lotTexture(index, { amount, owner, locale }),
    [index, amount, owner, locale, salary],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const [x, z] = tileCenter(index);
  const [along, depth] = tileSize(index);
  return (
    <mesh
      position={[x, LOT_TOP + 0.0015, z]}
      rotation={[-Math.PI / 2, 0, faceRotation(index)]}
      receiveShadow
      onPointerDown={(event) => {
        if (preview) return;
        event.stopPropagation();
        onSelect(index);
      }}
    >
      {/* Canvas width runs along play and its height toward the center. */}
      <planeGeometry args={[along - LOT_GAP, depth - LOT_GAP]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function BoardTiles({ state, selected, onSelect, preview }: BoardProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const transforms = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const neutral = useMemo(() => new THREE.Color("#ece6ef"), []);
  useEffect(() => {
    if (!mesh.current) return;
    for (const tile of BOARD) {
      const [x, z] = tileCenter(tile.index);
      const [along, depth] = tileSize(tile.index);
      transforms.position.set(x, (BOARD_TOP + LOT_TOP) / 2, z);
      transforms.rotation.set(0, tileRotation(tile.index), 0);
      transforms.scale.set(
        along - LOT_GAP,
        LOT_TOP - BOARD_TOP,
        depth - LOT_GAP,
      );
      transforms.updateMatrix();
      mesh.current.setMatrixAt(tile.index, transforms.matrix);
      const owner = state ? getProperty(state, tile.index)?.owner : null;
      if (tile.index === selected) color.set("#ffd45e");
      else if (owner != null)
        color.set(PLAYER_COLORS[owner]).lerp(neutral, 0.35);
      else color.copy(neutral);
      mesh.current.setColorAt(tile.index, color);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
  }, [state, selected, transforms, color, neutral]);
  const salary = state?.config.startSalary ?? ECONOMY.startSalary;
  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, BOARD.length]}
        receiveShadow
        castShadow
        onPointerDown={(event) => {
          if (preview || event.instanceId === undefined) return;
          event.stopPropagation();
          onSelect(event.instanceId);
        }}
      >
        <boxGeometry />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      {BOARD.map((tile) => {
        const property = state ? getProperty(state, tile.index) : null;
        const owner = property?.owner ?? null;
        return (
          <TileFace
            key={tile.index}
            index={tile.index}
            owner={owner}
            salary={salary}
            amount={
              owner != null && state
                ? propertyRent(state, tile.index)
                : tilePrice(tile.index)
            }
            onSelect={onSelect}
            preview={preview}
          />
        );
      })}
    </>
  );
}

function outlineGeometry(width: number, depth: number, border: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -depth / 2);
  shape.lineTo(width / 2, -depth / 2);
  shape.lineTo(width / 2, depth / 2);
  shape.lineTo(-width / 2, depth / 2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-width / 2 + border, -depth / 2 + border);
  hole.lineTo(-width / 2 + border, depth / 2 - border);
  hole.lineTo(width / 2 - border, depth / 2 - border);
  hole.lineTo(width / 2 - border, -depth / 2 + border);
  hole.closePath();
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape);
}

function TileFocus({ state, selected, preview }: BoardProps) {
  const outlines = useMemo(
    () => ({
      lot: outlineGeometry(LOT_WIDTH, LOT_DEPTH, 0.06),
      corner: outlineGeometry(LOT_DEPTH, LOT_DEPTH, 0.07),
    }),
    [],
  );
  useEffect(
    () => () => {
      outlines.lot.dispose();
      outlines.corner.dispose();
    },
    [outlines],
  );
  if (preview) return null;
  const pending = state?.pending;
  const decisionTile = pending && "tile" in pending ? pending.tile : null;
  return (
    <>
      {[decisionTile, selected].map((tile, index) => {
        if (tile == null || (index === 1 && tile === decisionTile)) return null;
        const [x, z] = tileCenter(tile);
        return (
          <mesh
            key={index === 0 ? "decision" : "inspection"}
            geometry={isCorner(tile) ? outlines.corner : outlines.lot}
            position={[x, LOT_TOP + 0.004, z]}
            rotation={[-Math.PI / 2, 0, tileRotation(tile)]}
            renderOrder={2}
          >
            <meshBasicMaterial
              color={
                index === 0 && pending ? PLAYER_COLORS[pending.seat] : "#e8a321"
              }
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </>
  );
}

/** A construction animating on one tile: its buildings rise with progress. */
type Growth = { tile: number; progress: number };
type TownsHandle = {
  draw: (state: PublicState | null, growth: Growth | null) => void;
};
// Each building starts slightly after the previous one, like a crew at work.
const GROWTH_STAGGER = 0.16;
const GROWTH_SPAN = 0.6;
const growthEase = gsap.parseEase("back.out(2.2)");

function Towns({
  state,
  preview,
  handle,
}: Pick<BoardProps, "state" | "preview"> & {
  handle: { current: TownsHandle | null };
}) {
  const walls = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);
  const windows = useRef<THREE.InstancedMesh>(null);
  const details = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const roofGeometry = useMemo(() => {
    const triangle = new THREE.Shape();
    triangle.moveTo(-0.5, 0);
    triangle.lineTo(0.5, 0);
    triangle.lineTo(0, 1);
    triangle.closePath();
    const geometry = new THREE.ExtrudeGeometry(triangle, {
      depth: 1,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.translate(0, 0, -0.5);
    return geometry;
  }, []);
  const draw = useCallback(
    (view: PublicState | null, growth: Growth | null) => {
      if (
        !walls.current ||
        !roofs.current ||
        !windows.current ||
        !details.current
      )
        return;
      let count = 0;
      let windowCount = 0;
      let detailCount = 0;
      for (const tile of BOARD) {
        if (tile.kind !== "city") continue;
        const growing = growth?.tile === tile.index ? growth : null;
        let order = 0;
        const property = view ? getProperty(view, tile.index) : null;
        const owner = property?.owner;
        const level =
          owner != null
            ? (property?.level ?? 0)
            : preview
              ? 1 + (tile.index % 5)
              : 0;
        if (level === 0) continue;
        const roofColor =
          owner != null ? PLAYER_COLORS[owner] : tileColor(tile.index);
        const angle = tileRotation(tile.index);
        const bandZ = buildingBandZ(tile.index);
        const [faceX, faceZ] = visibleFaces(tile.index);
        const building = (
          localX: number,
          fullWidth: number,
          fullHeight: number,
          depth = 0.28,
        ) => {
          let width = fullWidth;
          let height = fullHeight;
          const [x, z] = tilePoint(tile.index, localX, bandZ);
          const base = LOT_TOP;
          if (growing) {
            const start = order * GROWTH_STAGGER;
            const progress = THREE.MathUtils.clamp(
              (growing.progress - start) / GROWTH_SPAN,
              0,
              1,
            );
            order += 1;
            if (progress === 0) return;
            // Overshoots, then settles: the building pops out of its plot.
            height *= Math.max(0.02, growthEase(progress));
            width *= 0.7 + 0.3 * Math.min(1, progress * 1.6);
          }
          dummy.rotation.set(0, angle, 0);
          dummy.position.set(x, base + height / 2, z);
          dummy.scale.set(width, height, depth);
          dummy.updateMatrix();
          walls.current?.setMatrixAt(count, dummy.matrix);
          walls.current?.setColorAt(count, color.set("#fffaf4"));
          dummy.position.y = base + height;
          dummy.scale.set(width + 0.05, level >= 4 ? 0.13 : 0.12, depth + 0.05);
          dummy.updateMatrix();
          roofs.current?.setMatrixAt(count, dummy.matrix);
          roofs.current?.setColorAt(count, color.set(roofColor));
          count += 1;
          // An owner-colored footing and windows on the two faces the camera
          // sees: the roof identifies a house, the height a hotel or landmark.
          dummy.position.y = base + 0.018;
          dummy.scale.set(width + 0.03, 0.036, depth + 0.03);
          dummy.updateMatrix();
          details.current?.setMatrixAt(detailCount, dummy.matrix);
          details.current?.setColorAt(detailCount, color.set(roofColor));
          detailCount += 1;
          const rows = fullHeight > 0.35 ? 3 : 1;
          const paneHeight = Math.min(0.07, height * 0.3);
          for (let row = 0; row < rows; row++) {
            const y = base + (height * (row + 0.55)) / rows;
            for (const column of [-1, 1]) {
              const [windowX, windowZ] = tilePoint(
                tile.index,
                localX + column * width * 0.23,
                bandZ + faceZ * (depth / 2 + 0.004),
              );
              dummy.position.set(windowX, y, windowZ);
              dummy.scale.set(width * 0.2, paneHeight, 0.01);
              dummy.updateMatrix();
              windows.current?.setMatrixAt(windowCount++, dummy.matrix);
            }
            const [sideX, sideZ] = tilePoint(
              tile.index,
              localX + faceX * (width / 2 + 0.004),
              bandZ,
            );
            dummy.position.set(sideX, y, sideZ);
            dummy.scale.set(0.01, paneHeight, depth * 0.34);
            dummy.updateMatrix();
            windows.current?.setMatrixAt(windowCount++, dummy.matrix);
          }
        };
        if (level >= 1 && level <= 3) {
          const offsets =
            level === 1 ? [0] : level === 2 ? [-0.2, 0.2] : [-0.3, 0, 0.3];
          for (const x of offsets) building(x, level === 1 ? 0.3 : 0.24, 0.22);
        } else if (level === 4) {
          building(0, 0.44, 0.44, 0.32);
          building(-0.34, 0.14, 0.2);
          building(0.34, 0.14, 0.2);
        } else if (level === 5) {
          building(0, 0.52, 0.6, 0.34);
          building(-0.36, 0.12, 0.3);
          building(0.36, 0.12, 0.3);
        }
      }
      walls.current.count = roofs.current.count = count;
      windows.current.count = windowCount;
      details.current.count = detailCount;
      for (const object of [
        walls.current,
        roofs.current,
        windows.current,
        details.current,
      ]) {
        object.instanceMatrix.needsUpdate = true;
        if (object.instanceColor) object.instanceColor.needsUpdate = true;
        object.computeBoundingSphere();
      }
    },
    [preview, dummy, color],
  );
  useEffect(() => {
    handle.current = { draw };
    return () => {
      handle.current = null;
    };
  }, [handle, draw]);
  useEffect(() => draw(state, null), [state, draw]);
  useEffect(() => () => roofGeometry.dispose(), [roofGeometry]);
  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, 72]} castShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={0.95} />
      </instancedMesh>
      <instancedMesh
        ref={roofs}
        args={[roofGeometry, undefined, 72]}
        castShadow
      >
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={windows} args={[undefined, undefined, 640]}>
        <boxGeometry />
        <meshBasicMaterial color="#35546a" />
      </instancedMesh>
      <instancedMesh ref={details} args={[undefined, undefined, 72]} castShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
    </>
  );
}

function ResortProps() {
  return (
    <>
      {BOARD.filter((tile) => tile.kind === "resort").map((tile) => {
        const [x, z] = tilePoint(
          tile.index,
          -0.24,
          buildingBandZ(tile.index) + screenTop(tile.index) * 0.04,
        );
        return (
          <BeachUmbrella
            key={tile.index}
            position={[x, LOT_TOP, z]}
            scale={0.8}
          />
        );
      })}
    </>
  );
}

function FestivalFlags({ state }: { state: PublicState | null }) {
  const badges = useMemo(
    () =>
      Array.from({ length: 11 }, (_, multiplier) =>
        markerTexture(`×${multiplier}`, "#ffcf59", "#634711"),
      ),
    [],
  );
  const starGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    for (let point = 0; point < 10; point++) {
      const angle = Math.PI / 2 + (point * Math.PI) / 5;
      const radius = point % 2 === 0 ? 0.11 : 0.048;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (point === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);
  useEffect(
    () => () => {
      for (const texture of badges) texture.dispose();
      starGeometry.dispose();
    },
    [badges, starGeometry],
  );
  const festivals = state
    ? [
        ...new Set([
          ...state.festivalTiles,
          ...(state.championshipHost ? [state.championshipHost.tile] : []),
        ]),
      ]
    : [];
  return (
    <>
      {festivals.map((index) => {
        const [x, z] = tilePoint(
          index,
          0.4,
          buildingBandZ(index) + screenTop(index) * 0.17,
        );
        const multiplier = Math.max(
          state?.festivalTiles.includes(index) ? 2 : 1,
          state?.championshipHost?.tile === index
            ? state.championshipHost.multiplier
            : 1,
        );
        return (
          <group key={index} position={[x, LOT_TOP, z]}>
            <mesh position={[0, 0.2, 0]} castShadow>
              <cylinderGeometry args={[0.01, 0.01, 0.4, 6]} />
              <meshStandardMaterial color="#bc8b30" />
            </mesh>
            <mesh position={[0.12, 0.33, -0.12]} rotation={[0, Math.PI / 4, 0]}>
              <planeGeometry args={[0.3, 0.19]} />
              <meshBasicMaterial
                map={badges[Math.min(10, multiplier)]}
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            </mesh>
            <mesh
              geometry={starGeometry}
              position={[0, 0.46, 0]}
              rotation={[0, Math.PI / 4, 0]}
              scale={0.6}
            >
              <meshStandardMaterial
                color="#ffdc6e"
                emissive="#664a12"
                emissiveIntensity={0.12}
              />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

const PIP_COORDINATES: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};
const DIE_FACES: {
  value: number;
  position: [number, number, number];
  rotation: [number, number, number];
}[] = [
  { value: 1, position: [0, 0.302, 0], rotation: [-Math.PI / 2, 0, 0] },
  { value: 6, position: [0, -0.302, 0], rotation: [Math.PI / 2, 0, 0] },
  { value: 2, position: [0, 0, 0.302], rotation: [0, 0, 0] },
  { value: 5, position: [0, 0, -0.302], rotation: [0, Math.PI, 0] },
  { value: 3, position: [0.302, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { value: 4, position: [-0.302, 0, 0], rotation: [0, -Math.PI / 2, 0] },
];
function diceRotation(value: number) {
  if (value === 2) return [-Math.PI / 2, 0, 0];
  if (value === 3) return [0, 0, Math.PI / 2];
  if (value === 4) return [0, 0, -Math.PI / 2];
  if (value === 5) return [Math.PI / 2, 0, 0];
  if (value === 6) return [Math.PI, 0, 0];
  return [0, 0, 0];
}
function Die({
  groupRef,
  materialRef,
  geometry,
  position,
}: {
  groupRef: (group: THREE.Group | null) => void;
  materialRef: (material: THREE.MeshStandardMaterial | null) => void;
  geometry: THREE.BufferGeometry;
  position: readonly [number, number, number];
}) {
  const pips = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = pips.current;
    if (!mesh) return;
    // All 21 pips of a die share one draw call.
    const face = new THREE.Object3D();
    const pip = new THREE.Object3D();
    face.add(pip);
    let count = 0;
    for (const { value, position, rotation } of DIE_FACES) {
      face.position.set(...position);
      face.rotation.set(...rotation);
      for (const [x, y] of PIP_COORDINATES[value]) {
        pip.position.set(x * 0.15, y * 0.15, 0);
        face.updateMatrixWorld(true);
        mesh.setMatrixAt(count++, pip.matrixWorld);
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);
  return (
    <group ref={groupRef} position={[...position]} scale={DIE_SCALE}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial
          ref={materialRef}
          color={DICE_DEFAULT_COLOR}
          roughness={0.32}
        />
      </mesh>
      <instancedMesh ref={pips} args={[undefined, undefined, 21]}>
        <circleGeometry args={[0.05, 14]} />
        <meshBasicMaterial color="#fffaf0" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Pawn({
  seat,
  active,
  groupRef,
}: {
  seat: Seat;
  active: boolean;
  groupRef: (group: THREE.Group | null) => void;
}) {
  const color = PLAYER_COLORS[seat];
  return (
    <group ref={groupRef} position={pawnPosition(seat, 0)}>
      {active && (
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.2, 0.245, 24]} />
          <meshBasicMaterial color="#ffcf59" toneMapped={false} />
        </mesh>
      )}
      <group rotation={[0, Math.PI / 4, 0]} scale={PAWN_SCALE}>
        <mesh position={[0, 0.005, 0]} castShadow>
          <cylinderGeometry args={[0.19, 0.2, 0.07, 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
        <mesh position={[0, 0.046, 0]}>
          <cylinderGeometry args={[0.153, 0.153, 0.019, 16]} />
          <meshStandardMaterial color="#fffaf0" />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh position={[side * 0.065, 0.12, 0.025]} castShadow>
              <boxGeometry args={[0.085, 0.11, 0.12]} />
              <meshStandardMaterial color="#294758" />
            </mesh>
            <mesh
              position={[side * 0.17, 0.29, 0]}
              rotation={[0, 0, side * 0.27]}
              castShadow
            >
              <capsuleGeometry args={[0.05, 0.16, 3, 8]} />
              <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[side * 0.19, 0.19, 0.014]}>
              <sphereGeometry args={[0.053, 8, 6]} />
              <meshStandardMaterial color="#f7c88b" />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.28, 0]} castShadow>
          <capsuleGeometry args={[0.135, 0.13, 4, 10]} />
          <meshStandardMaterial color={color} roughness={0.75} />
        </mesh>
        <mesh position={[0, 0.48, 0]} castShadow>
          <sphereGeometry args={[0.155, 12, 9]} />
          <meshStandardMaterial color="#f7c88b" roughness={0.8} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.054, 0.495, 0.14]}>
            <sphereGeometry args={[0.018, 6, 5]} />
            <meshBasicMaterial color="#173b45" />
          </mesh>
        ))}
        <mesh position={[0, 0.443, 0.149]} rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[0.037, 0.007, 4, 8, Math.PI]} />
          <meshBasicMaterial color="#944f35" />
        </mesh>
        <mesh position={[0, 0.57, 0]} castShadow>
          {seat === 2 ? (
            <coneGeometry args={[0.18, 0.24, 4]} />
          ) : seat === 3 ? (
            <boxGeometry args={[0.26, 0.11, 0.24]} />
          ) : (
            <sphereGeometry
              args={[0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]}
            />
          )}
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        {seat === 0 && (
          <mesh position={[0, 0.582, 0.15]}>
            <boxGeometry args={[0.23, 0.024, 0.14]} />
            <meshStandardMaterial color={color} />
          </mesh>
        )}
        {seat === 1 && (
          <mesh position={[0, 0.564, 0.154]}>
            <boxGeometry args={[0.22, 0.045, 0.025]} />
            <meshStandardMaterial color="#fffaf0" />
          </mesh>
        )}
        <mesh
          position={[0, 0.3, 0.137]}
          rotation={[0, 0, seat === 1 ? Math.PI / 4 : 0]}
        >
          {seat === 0 ? (
            <circleGeometry args={[0.036, 10]} />
          ) : seat === 2 ? (
            <circleGeometry args={[0.049, 3]} />
          ) : (
            <planeGeometry args={[0.057, 0.057]} />
          )}
          <meshBasicMaterial color="#fffaf0" />
        </mesh>
      </group>
    </group>
  );
}

const CASH_BUNDLES_PER_SEAT = 6;
const CASH_TRANSFER_BUNDLES = 3;

function reserveSpot(
  seat: Seat,
  localX: number,
  localZ: number,
  y: number,
): [number, number, number] {
  const { position, rotation } = reserveAnchor(seat);
  return [
    position[0] + localX * Math.cos(rotation) + localZ * Math.sin(rotation),
    y,
    position[1] - localX * Math.sin(rotation) + localZ * Math.cos(rotation),
  ];
}

function cashBundleCount(cash: number) {
  // Visual denomination only; the authoritative amount is shown by the HUD.
  return Math.min(
    CASH_BUNDLES_PER_SEAT,
    Math.ceil(Math.max(0, cash) / 400_000),
  );
}

function CashReserveBadge({ seat, cash }: { seat: Seat; cash: number }) {
  const texture = useMemo(() => seatBadgeTexture(seat), [seat]);
  useEffect(() => () => texture.dispose(), [texture]);
  const bundle = cashBundleCount(cash) - 1;
  if (bundle < 0) return null;
  const across = ((bundle % 2) - 0.5) * 0.56;
  const top = BOARD_BOTTOM + 0.144 + Math.floor(bundle / 2) * 0.15;
  return (
    <mesh
      position={reserveSpot(seat, 0, across, top)}
      // Laid flat and turned so the symbol stands upright on screen.
      rotation={[-Math.PI / 2, 0, Math.PI / 4]}
    >
      <planeGeometry args={[0.155, 0.155]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

function CashReserves({ state }: { state: PublicState }) {
  const notes = useRef<THREE.InstancedMesh>(null);
  const faces = useRef<THREE.InstancedMesh>(null);
  const bands = useRef<THREE.InstancedMesh>(null);
  const pageEdges = useRef<THREE.InstancedMesh>(null);
  const coins = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const texture = useMemo(noteTexture, []);
  const { invalidate } = useThree();
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    const body = notes.current;
    const face = faces.current;
    const band = bands.current;
    const edges = pageEdges.current;
    const gold = coins.current;
    if (!body || !face || !band || !edges || !gold) return;
    let count = 0;
    let coinCount = 0;
    let edgeCount = 0;
    for (const player of state.players) {
      if (player.bankrupt || player.cash <= 0) continue;
      const { rotation } = reserveAnchor(player.seat);
      // This is a capped physical illustration, never an alternate cash counter.
      const bundles = cashBundleCount(player.cash);
      color.set(PLAYER_COLORS[player.seat]);
      for (let index = 0; index < bundles; index++) {
        const column = index % 2;
        const layer = Math.floor(index / 2);
        const y = BOARD_BOTTOM + 0.065 + layer * 0.15;
        transform.position.set(
          ...reserveSpot(player.seat, 0, (column - 0.5) * 0.56, y),
        );
        transform.rotation.set(0, rotation + (layer % 2 ? 0.05 : -0.02), 0);
        transform.scale.set(1, 1, 1);
        transform.updateMatrix();
        body.setMatrixAt(count, transform.matrix);
        band.setMatrixAt(count, transform.matrix);
        band.setColorAt(count, color);
        transform.position.y += 0.061;
        transform.updateMatrix();
        face.setMatrixAt(count, transform.matrix);
        for (const offset of [-0.029, 0.006]) {
          transform.position.y = y + offset;
          transform.updateMatrix();
          edges.setMatrixAt(edgeCount++, transform.matrix);
        }
        count += 1;
      }
      const goldCount = Math.min(6, Math.ceil(player.cash / 600_000));
      for (let index = 0; index < goldCount; index++) {
        transform.position.set(
          ...reserveSpot(
            player.seat,
            0.62,
            -0.15 + Math.floor(index / 3) * 0.25,
            BOARD_BOTTOM + 0.035 + (index % 3) * 0.048,
          ),
        );
        transform.rotation.set(0, 0, 0);
        transform.updateMatrix();
        gold.setMatrixAt(coinCount++, transform.matrix);
      }
    }
    body.count = face.count = band.count = count;
    edges.count = edgeCount;
    gold.count = coinCount;
    for (const mesh of [body, face, band, edges, gold]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    invalidate();
  }, [state, transform, color, invalidate]);
  return (
    <group>
      {state.players
        .filter((player) => !player.bankrupt)
        .map((player) => (
          <CashReserveBadge
            key={player.seat}
            seat={player.seat}
            cash={player.cash}
          />
        ))}
      <instancedMesh
        ref={notes}
        args={[undefined, undefined, CASH_BUNDLES_PER_SEAT * 4]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0.94, 0.12, 0.48]} />
        <meshStandardMaterial color="#dae4bd" roughness={0.85} />
      </instancedMesh>
      <instancedMesh
        ref={faces}
        args={[undefined, undefined, CASH_BUNDLES_PER_SEAT * 4]}
      >
        <boxGeometry args={[0.95, 0.012, 0.49]} />
        <meshStandardMaterial map={texture} roughness={0.9} />
      </instancedMesh>
      <instancedMesh
        ref={pageEdges}
        args={[undefined, undefined, CASH_BUNDLES_PER_SEAT * 8]}
      >
        <boxGeometry args={[0.948, 0.008, 0.488]} />
        <meshStandardMaterial color="#8da57d" roughness={0.9} />
      </instancedMesh>
      <instancedMesh
        ref={bands}
        args={[undefined, undefined, CASH_BUNDLES_PER_SEAT * 4]}
        castShadow
      >
        <boxGeometry args={[0.16, 0.145, 0.51]} />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={coins} args={[undefined, undefined, 24]} castShadow>
        <cylinderGeometry args={[0.115, 0.115, 0.04, 12]} />
        <meshStandardMaterial
          color="#ffcf59"
          metalness={0.3}
          roughness={0.45}
        />
      </instancedMesh>
    </group>
  );
}

function cashTransfer(event: GameEvent) {
  switch (event.type) {
    case "SalaryPaid":
    case "PropertySold":
      return { from: null, to: event.seat, amount: event.amount };
    case "RentPaid":
      return { from: event.seat, to: event.owner, amount: event.amount };
    case "MoneyTransferred":
      return { from: event.from, to: event.to, amount: event.amount };
    case "BoughtOut":
      return {
        from: event.seat,
        to: event.previousOwner,
        amount: event.amount,
      };
    case "PropertyBought":
    case "PropertyUpgraded":
      return { from: event.seat, to: null, amount: event.amount };
    default:
      return null;
  }
}

/** Fit the whole board between the HUD's reserved top and bottom bands. */
function frameBoard(
  camera: THREE.OrthographicCamera,
  width: number,
  height: number,
  preview: boolean,
  zoom: number,
) {
  const insets = preview
    ? { top: height * 0.03, bottom: height * 0.03, side: width * 0.03 }
    : {
        // The match title and tools above, the current choice below.
        top: THREE.MathUtils.clamp(height * 0.11, 78, 118),
        bottom: THREE.MathUtils.clamp(height * 0.125, 86, 134),
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
  // Landmarks and buildings rise above the far corner and the back lots.
  for (const tile of BOARD) {
    const [x, z] = tileCenter(tile.index);
    add(x, LOT_TOP + (isCorner(tile.index) ? 0.95 : 0.8), z);
  }
  const availableWidth = Math.max(1, width - insets.side * 2);
  const availableHeight = Math.max(1, height - insets.top - insets.bottom);
  const unitsPerPixel = Math.max(
    (bounds.max.x - bounds.min.x) / availableWidth,
    (bounds.max.y - bounds.min.y) / availableHeight,
  );
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  // Place the board's center at the center of the free band, in pixels.
  const pixelX = width / 2;
  const pixelY = insets.top + availableHeight / 2;
  camera.left = centerX - pixelX * unitsPerPixel;
  camera.right = camera.left + width * unitsPerPixel;
  camera.top = centerY + pixelY * unitsPerPixel;
  camera.bottom = camera.top - height * unitsPerPixel;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}

function SceneContent(props: BoardProps) {
  const { state, preview, zoom = 1 } = props;
  const { camera, invalidate, size, gl } = useThree();
  const pawns = useRef<(THREE.Group | null)[]>([]);
  const dice = useRef<(THREE.Group | null)[]>([]);
  const diceMaterials = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const score = useRef<THREE.Sprite>(null);
  const scoreTextures = useRef(new Map<string, THREE.Texture>());
  const timelines = useRef(new Map<gsap.core.Timeline, () => void>());
  const towns = useRef<TownsHandle | null>(null);
  const growth = useMemo(() => ({ tile: 0, progress: 0 }), []);
  const pulse = useRef<THREE.Mesh>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const sparkTransform = useMemo(() => new THREE.Object3D(), []);
  const sparkProgress = useMemo(() => ({ value: 0 }), []);
  const cashFlight = useRef<THREE.Group>(null);
  const cashNotes = useRef<THREE.InstancedMesh>(null);
  const cashFaces = useRef<THREE.InstancedMesh>(null);
  const cashBands = useRef<THREE.InstancedMesh>(null);
  const cashTransform = useMemo(() => new THREE.Object3D(), []);
  const cashProgress = useMemo(() => ({ value: 0 }), []);
  const cashColor = useMemo(() => new THREE.Color(), []);
  const cashTexture = useMemo(noteTexture, []);
  const dieGeometry = useMemo(
    () => new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, 0.085),
    [],
  );
  const rendered = useRef(false);
  useEffect(
    () => () => {
      cashTexture.dispose();
      dieGeometry.dispose();
      for (const texture of scoreTextures.current.values()) texture.dispose();
      scoreTextures.current.clear();
    },
    [cashTexture, dieGeometry],
  );

  useEffect(() => {
    camera.position.set(...CAMERA_OFFSET);
    camera.lookAt(0, LOT_TOP, 0);
    camera.updateMatrixWorld();
    if (camera instanceof THREE.OrthographicCamera)
      frameBoard(camera, size.width, size.height, Boolean(preview), zoom);
    invalidate();
  }, [camera, size.width, size.height, zoom, preview, invalidate]);

  useEffect(() => {
    if (preview) return;
    let propertyEffectGeneration = 0;
    let cashEffectGeneration = 0;
    function showScore(roll: PublicState["lastRoll"]) {
      const sprite = score.current;
      if (!sprite) return;
      if (!roll) {
        sprite.visible = false;
        return;
      }
      const total = roll.dice[0] + roll.dice[1];
      const double = roll.dice[0] === roll.dice[1];
      const key = `${total}:${double}`;
      let texture = scoreTextures.current.get(key);
      if (!texture) {
        texture = scoreTexture(total, double);
        scoreTextures.current.set(key, texture);
      }
      sprite.material.map = texture;
      sprite.material.needsUpdate = true;
      sprite.scale.set(0.7, 0.7, 1);
      sprite.visible = true;
    }
    function paintDice(seat: Seat | null) {
      const color = seat == null ? DICE_DEFAULT_COLOR : DICE_COLORS[seat];
      for (const material of diceMaterials.current) material?.color.set(color);
    }
    function snap(next: PublicState | null) {
      if (cashFlight.current) cashFlight.current.visible = false;
      for (const player of next?.players ?? []) {
        const pawn = pawns.current[player.seat];
        if (!pawn) continue;
        pawn.position.set(...pawnPosition(player.seat, player.position));
        pawn.scale.set(1, 1, 1);
        pawn.visible = !player.bankrupt;
      }
      for (let index = 0; index < 2; index++) {
        const die = dice.current[index];
        if (!die) continue;
        const rotation = diceRotation(next?.lastRoll?.dice[index] ?? index + 1);
        die.rotation.set(rotation[0], rotation[1], rotation[2]);
        die.position.set(...DIE_REST[index]);
      }
      paintDice(next?.lastRoll?.seat ?? null);
      showScore(next?.lastRoll ?? null);
      towns.current?.draw(next, null);
      invalidate();
    }
    function cancel() {
      propertyEffectGeneration += 1;
      cashEffectGeneration += 1;
      for (const [timeline, done] of timelines.current) {
        timeline.kill();
        done();
      }
      timelines.current.clear();
      if (pulse.current) pulse.current.visible = false;
      if (sparks.current) sparks.current.visible = false;
      if (cashFlight.current) cashFlight.current.visible = false;
      invalidate();
    }
    function play(
      build: (timeline: gsap.core.Timeline) => void,
      context: AnimationContext,
    ) {
      return new Promise<void>((resolve) => {
        const timeline = gsap.timeline({
          paused: true,
          onUpdate: invalidate,
          onComplete: () => {
            timelines.current.delete(timeline);
            resolve();
          },
        });
        timelines.current.set(timeline, resolve);
        build(timeline);
        timeline.timeScale(context.speed);
        timeline.play();
      });
    }
    async function animateCash(event: GameEvent, context: AnimationContext) {
      const transfer = cashTransfer(event);
      const flight = cashFlight.current;
      const notes = cashNotes.current;
      const faces = cashFaces.current;
      const bands = cashBands.current;
      if (
        !transfer ||
        transfer.amount <= 0 ||
        !flight ||
        !notes ||
        !faces ||
        !bands
      )
        return true;
      const generation = ++cashEffectGeneration;
      const reserve = (seat: Seat | null) =>
        seat === null
          ? BANK_POSITION
          : reserveSpot(seat, 0, 0, BOARD_BOTTOM + 0.2);
      const from = reserve(transfer.from);
      const to = reserve(transfer.to);
      const count = Math.min(
        CASH_TRANSFER_BUNDLES,
        1 + Math.floor(Math.log10(1 + transfer.amount / 10_000)),
      );
      const identity = transfer.to ?? transfer.from;
      cashColor.set(identity === null ? "#ffcf59" : PLAYER_COLORS[identity]);
      notes.count = faces.count = bands.count = count;
      for (let index = 0; index < count; index++)
        bands.setColorAt(index, cashColor);
      if (bands.instanceColor) bands.instanceColor.needsUpdate = true;
      const updateCash = () => {
        for (let index = 0; index < count; index++) {
          const progress = THREE.MathUtils.clamp(
            (cashProgress.value - index * 0.1) / (1 - (count - 1) * 0.1),
            0,
            1,
          );
          const arc = Math.sin(progress * Math.PI);
          cashTransform.position.set(
            from[0] + (to[0] - from[0]) * progress,
            from[1] + 0.42 + (to[1] - from[1]) * progress + arc * 1.35,
            from[2] + (to[2] - from[2]) * progress,
          );
          cashTransform.rotation.set(
            arc * 0.22,
            progress * Math.PI + index * 0.3,
            0,
          );
          cashTransform.scale.setScalar(0.72 + arc * 0.28);
          cashTransform.updateMatrix();
          notes.setMatrixAt(index, cashTransform.matrix);
          bands.setMatrixAt(index, cashTransform.matrix);
          cashTransform.position.y += 0.066 * cashTransform.scale.y;
          cashTransform.updateMatrix();
          faces.setMatrixAt(index, cashTransform.matrix);
        }
        notes.instanceMatrix.needsUpdate = true;
        faces.instanceMatrix.needsUpdate = true;
        bands.instanceMatrix.needsUpdate = true;
      };
      cashProgress.value = 0;
      updateCash();
      flight.visible = true;
      await play((timeline) => {
        timeline.to(cashProgress, {
          value: 1,
          duration: DECISION_TIMING.moneyAnimation / 1000,
          ease: "power1.inOut",
          onUpdate: updateCash,
        });
      }, context);
      // Reset/skip can resolve an older timeline after a newer one began.
      if (generation !== cashEffectGeneration) return false;
      flight.visible = false;
      invalidate();
      return true;
    }
    return director.register({
      snap,
      cancel,
      animate: async (event, context) => {
        if (context.reducedMotion) {
          snap(context.next);
          return;
        }
        if (
          (cashTransfer(event)?.amount ?? 0) > 0 &&
          !(await animateCash(event, context))
        )
          return;
        if (event.type === "DiceRolled") {
          // The roller shakes the dice on their side of the board, throws
          // them high across the lawn, lets them settle, then shows the total.
          const { inward } = sideFrame(event.seat);
          const budget = DECISION_TIMING.diceAnimation / 1000;
          const shake = 0.22;
          const throwTime = budget * 0.62;
          const reveal = shake + throwTime + 0.06;
          paintDice(event.seat);
          const sprite = score.current;
          if (sprite) sprite.visible = false;
          await play((timeline) => {
            for (let index = 0; index < 2; index++) {
              const die = dice.current[index];
              if (!die) continue;
              const rest = DIE_REST[index];
              const target = diceRotation(event.dice[index]);
              const start = shake + index * 0.07;
              const fromX = rest[0] - inward[0] * 2.6;
              const fromZ = rest[2] - inward[1] * 2.6;
              timeline.set(
                die.position,
                { x: fromX, y: DIE_REST_Y + 0.55, z: fromZ },
                0,
              );
              timeline.set(die.rotation, { x: 0.3, y: index, z: -0.2 }, 0);
              timeline.to(
                die.rotation,
                {
                  keyframes: [
                    { z: 0.25, duration: shake / 3 },
                    { z: -0.25, duration: shake / 3 },
                    { z: 0, duration: shake / 3 },
                  ],
                  ease: "sine.inOut",
                },
                0,
              );
              timeline.to(
                die.position,
                {
                  x: rest[0],
                  z: rest[2],
                  duration: throwTime,
                  ease: "power3.out",
                },
                start,
              );
              timeline.to(
                die.position,
                {
                  keyframes: [
                    {
                      y: DIE_REST_Y + 2.1,
                      duration: throwTime * 0.3,
                      ease: "power2.out",
                    },
                    {
                      y: DIE_REST_Y,
                      duration: throwTime * 0.7,
                      ease: "bounce.out",
                    },
                  ],
                },
                start,
              );
              timeline.to(
                die.rotation,
                {
                  x: target[0] + Math.PI * 6,
                  y: target[1] + Math.PI * 4,
                  z: target[2] + Math.PI * 4,
                  duration: throwTime,
                  ease: "power3.out",
                },
                start,
              );
            }
            if (sprite) {
              timeline.call(
                () => showScore({ seat: event.seat, dice: event.dice }),
                [],
                reveal,
              );
              timeline.fromTo(
                sprite.scale,
                { x: 0.2, y: 0.2 },
                {
                  x: 0.7,
                  y: 0.7,
                  duration: 0.3,
                  ease: "back.out(2.6)",
                  immediateRender: false,
                },
                reveal,
              );
            }
            // Hold the total long enough to read before the pawn sets off.
            timeline.set({}, {}, budget);
          }, context);
        } else if (event.type === "PlayerMoved") {
          const pawn = pawns.current[event.seat];
          if (!pawn) return;
          const before = context.previous?.players.find(
            (player) => player.seat === event.seat,
          );
          const from = event.from ?? before?.position ?? 0;
          const steps = event.steps ?? (event.position - from + 32) % 32;
          await play((timeline) => {
            if (Math.abs(steps) > 16 || steps === 0) {
              // Travel and card moves: one long leap to the destination.
              const [x, y, z] = pawnPosition(event.seat, event.position);
              const half = DECISION_TIMING.jumpAnimation / 2000;
              timeline.to(pawn.position, {
                x,
                z,
                duration: half * 2,
                ease: "power2.inOut",
              });
              timeline.to(
                pawn.position,
                { y: y + 1.6, duration: half, ease: "power2.out" },
                0,
              );
              timeline.to(
                pawn.position,
                { y, duration: half, ease: "bounce.out" },
                half,
              );
            } else {
              // A board-game walk: one hop per tile, a settle on the last.
              // Corners passed on the way are turned on the road.
              const duration = DECISION_TIMING.stepAnimation / 1000;
              const count = Math.abs(steps);
              for (let step = 1; step <= count; step++) {
                const tile =
                  (((from + step * Math.sign(steps)) % 32) + 32) % 32;
                const last = step === count;
                const [x, y, z] = last
                  ? pawnPosition(event.seat, tile)
                  : passingPosition(event.seat, tile);
                const at = (step - 1) * duration;
                timeline.to(
                  pawn.position,
                  { x, z, duration: duration * 0.9, ease: "sine.inOut" },
                  at,
                );
                timeline.to(
                  pawn.position,
                  {
                    y: y + 0.5,
                    duration: duration * 0.42,
                    ease: "power2.out",
                  },
                  at,
                );
                timeline.to(
                  pawn.position,
                  {
                    y,
                    duration: duration * 0.58,
                    ease: last ? "bounce.out" : "power2.in",
                  },
                  at + duration * 0.42,
                );
              }
            }
          }, context);
        } else if (
          event.type === "SentToIsland" ||
          event.type === "PlayerBankrupt"
        ) {
          const pawn = pawns.current[event.seat];
          if (!pawn) return;
          if (event.type === "PlayerBankrupt")
            await play((timeline) => {
              timeline.to(pawn.scale, {
                y: 0,
                x: 0.1,
                z: 0.1,
                duration: 0.45,
                ease: "power2.in",
              });
            }, context);
          else {
            snap(context.next);
            const landing = pawn.position.y;
            await play((timeline) => {
              timeline.fromTo(
                pawn.position,
                { y: landing + 1.6 },
                {
                  y: landing,
                  duration: DECISION_TIMING.islandAnimation / 1000,
                  ease: "bounce.out",
                },
              );
            }, context);
          }
        } else if (
          event.type === "PropertyBought" ||
          event.type === "PropertyUpgraded" ||
          event.type === "BoughtOut"
        ) {
          const ring = pulse.current;
          if (!ring) return;
          const effectGeneration = ++propertyEffectGeneration;
          const [x, z] = tileCenter(event.tile);
          ring.position.set(x, LOT_TOP + 0.03, z);
          const owner = getProperty(context.next, event.tile)?.owner;
          if (ring.material instanceof THREE.MeshBasicMaterial)
            ring.material.color.set(
              owner == null ? "#ffda72" : PLAYER_COLORS[owner],
            );
          ring.visible = true;
          const burst = sparks.current;
          if (burst) burst.visible = true;
          const updateSparks = () => {
            if (!burst) return;
            const progress = sparkProgress.value;
            for (let index = 0; index < 8; index++) {
              const angle = (index * Math.PI) / 4;
              const radius = 0.16 + progress * 0.45;
              sparkTransform.position.set(
                x + Math.cos(angle) * radius,
                LOT_TOP + 0.1 + Math.sin(progress * Math.PI) * 0.6,
                z + Math.sin(angle) * radius,
              );
              sparkTransform.rotation.set(
                progress * Math.PI,
                angle,
                Math.PI / 4,
              );
              sparkTransform.scale.setScalar(0.08 * (1 - progress));
              sparkTransform.updateMatrix();
              burst.setMatrixAt(index, sparkTransform.matrix);
            }
            burst.instanceMatrix.needsUpdate = true;
          };
          // New houses rise one after another on their plot; the view
          // shows the next state on this tile while it is being built.
          const builds =
            event.type !== "BoughtOut" &&
            BOARD[event.tile].kind === "city" &&
            (getProperty(context.next, event.tile)?.level ?? 0) >
              (context.previous
                ? (getProperty(context.previous, event.tile)?.level ?? 0)
                : 0);
          const drawGrowth = () => towns.current?.draw(context.next, growth);
          growth.tile = event.tile;
          growth.progress = 0;
          if (builds) drawGrowth();
          const budget = DECISION_TIMING.propertyAnimation / 1000;
          await play((timeline) => {
            timeline.fromTo(
              ring.scale,
              { x: 0.1, y: 0.1, z: 0.1 },
              { x: 1.3, y: 1.3, z: 1.3, duration: 0.55, ease: "power2.out" },
            );
            if (builds)
              timeline.to(
                growth,
                {
                  progress: 1,
                  duration: budget * 0.85,
                  ease: "none",
                  onUpdate: drawGrowth,
                },
                0.1,
              );
            timeline.fromTo(
              sparkProgress,
              { value: 0 },
              {
                value: 1,
                duration: 0.6,
                ease: "power2.out",
                onUpdate: updateSparks,
              },
              builds ? 0.35 : 0,
            );
            timeline.set({}, {}, budget);
          }, context);
          // A cancelled handler may resume after the next effect has started.
          if (effectGeneration === propertyEffectGeneration) {
            ring.visible = false;
            if (burst) burst.visible = false;
            invalidate();
          }
        }
      },
    });
  }, [
    preview,
    invalidate,
    growth,
    sparkProgress,
    sparkTransform,
    cashProgress,
    cashTransform,
    cashColor,
  ]);

  useEffect(() => {
    if (state || preview) invalidate();
  }, [state, preview, invalidate]);
  useEffect(() => {
    gl.setClearColor("#000000", 0);
  }, [gl]);
  return (
    <>
      <ambientLight intensity={0.95} />
      <hemisphereLight args={["#eef8ff", "#b3ad92", 0.75]} />
      <directionalLight
        position={[-6, 11, 4]}
        intensity={1.45}
        color="#fff4dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-normalBias={0.035}
        shadow-radius={3}
      />
      <BoardBase
        onRendered={() => {
          if (rendered.current) return;
          rendered.current = true;
          gl.domElement.dataset.sceneReady = "true";
          gl.domElement
            .closest(".canvas-layer")
            ?.setAttribute("data-scene-ready", "true");
        }}
      />
      {!preview && state && <CashReserves state={state} />}
      <BoardTiles {...props} />
      <TileFocus {...props} />
      <Towns state={state} preview={preview} handle={towns} />
      <ResortProps />
      <FestivalFlags state={state} />
      <Landmarks />
      {(state && !preview
        ? state.players.map((player) => player.seat)
        : ([0, 1, 2, 3] as const)
      ).map((seat) => (
        <Pawn
          key={seat}
          seat={seat}
          active={
            !preview &&
            state?.status === "active" &&
            (state.pending?.seat ?? state.activeSeat) === seat
          }
          groupRef={(group) => {
            pawns.current[seat] = group;
          }}
        />
      ))}
      {DIE_REST.map((position, index) => (
        <Die
          key={position.join(",")}
          position={position}
          geometry={dieGeometry}
          groupRef={(group) => {
            dice.current[index] = group;
          }}
          materialRef={(material) => {
            diceMaterials.current[index] = material;
          }}
        />
      ))}
      <sprite
        ref={score}
        visible={false}
        position={[0, DIE_REST_Y + 1.15, 0]}
        scale={[0.7, 0.7, 1]}
        renderOrder={5}
      >
        <spriteMaterial depthTest={false} transparent toneMapped={false} />
      </sprite>
      <mesh ref={pulse} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.5, 28]} />
        <meshBasicMaterial
          color="#ffda72"
          transparent
          opacity={0.85}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <instancedMesh
        ref={sparks}
        visible={false}
        args={[undefined, undefined, 8]}
        frustumCulled={false}
      >
        <boxGeometry />
        <meshBasicMaterial color="#ffcf59" toneMapped={false} />
      </instancedMesh>
      <group ref={cashFlight} visible={false}>
        <instancedMesh
          ref={cashNotes}
          args={[undefined, undefined, CASH_TRANSFER_BUNDLES]}
          frustumCulled={false}
          castShadow
        >
          <boxGeometry args={[0.94, 0.12, 0.48]} />
          <meshStandardMaterial color="#dae4bd" roughness={0.85} />
        </instancedMesh>
        <instancedMesh
          ref={cashFaces}
          args={[undefined, undefined, CASH_TRANSFER_BUNDLES]}
          frustumCulled={false}
        >
          <boxGeometry args={[0.95, 0.012, 0.49]} />
          <meshStandardMaterial map={cashTexture} roughness={0.9} />
        </instancedMesh>
        <instancedMesh
          ref={cashBands}
          args={[undefined, undefined, CASH_TRANSFER_BUNDLES]}
          frustumCulled={false}
        >
          <boxGeometry args={[0.16, 0.145, 0.51]} />
          <meshStandardMaterial roughness={0.7} />
        </instancedMesh>
      </group>
      <FrameMonitor />
    </>
  );
}

function FrameMonitor() {
  const counters = useRef({ frames: 0, started: 0 });
  useFrame(({ clock, gl }) => {
    counters.current.frames += 1;
    const elapsed = clock.elapsedTime - counters.current.started;
    if (elapsed < 0.5) return;
    const target = document.getElementById("frame-monitor");
    if (target)
      target.textContent = `${Math.round(counters.current.frames / elapsed)} FPS · ${gl.info.render.calls} appels`;
    counters.current.frames = 0;
    counters.current.started = clock.elapsedTime;
  });
  return null;
}

export default function BoardScene(props: BoardProps) {
  return (
    <div className="canvas-layer" data-scene-ready="false">
      <Canvas
        orthographic
        shadows={{ type: THREE.PCFShadowMap }}
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [...CAMERA_OFFSET], near: 0.1, far: 100, zoom: 1 }}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.NeutralToneMapping,
        }}
      >
        <SceneContent {...props} />
      </Canvas>
    </div>
  );
}
