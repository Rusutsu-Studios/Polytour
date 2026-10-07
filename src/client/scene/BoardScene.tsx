import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  BOARD_SIZE,
  type BoardRule,
  DECISION_TIMING,
  ECONOMY,
  getBoard,
} from "../../shared/board/index.js";
import type {
  GameConfig,
  GameEvent,
  KeepCard,
  PublicState,
  Seat,
} from "../../shared/engine/index.js";
import {
  boardRule,
  economyRule,
  getProperty,
  legalActions,
  powerCutActive,
  propertyRefund,
  propertyRent,
} from "../../shared/engine/index.js";
import { clampBoardZoom } from "../board-view.js";
import type { AnimationContext } from "../director/director.js";
import { director, useDirector } from "../director/director.js";
import { useLocale } from "../i18n.js";
import type { ClientSettings } from "../settings/store.js";
import {
  money,
  PLAYER_COLORS,
  tileColor,
  tileName,
  tilePrice,
} from "../ui/board-display.js";
import "./BoardScene.css";
import { useAmbientMotion } from "./ambient.js";
import {
  type BoardOrientation,
  type BoardPan,
  boardScreenHit,
  boardViewRotation,
  DEFAULT_BOARD_ORIENTATION,
  frameBoard,
  initializeBoardCamera,
} from "./board-framing.js";
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
  startBankPoint,
  tileCenter,
  tilePoint,
  tileRotation,
  tileSize,
  visibleFaces,
} from "./board-layout.js";
import {
  boardAmount,
  cornerTexture,
  FESTIVAL_COLORS,
  gainTexture,
  heldCardTexture,
  lawnTexture,
  lotTexture,
  noteTexture,
  roadTexture,
  scoreTexture,
  shieldTexture,
} from "./board-textures.js";
import { Downtown, type DowntownHandle } from "./Downtown.js";
import { BeachUmbrella, Landmarks } from "./Landmarks.js";
import { useBoardView } from "./use-board-view.js";

const DEFAULT_BOARD_ROTATION = new THREE.Quaternion();
type BoardHitTest = (x: number, y: number) => boolean;
type BoardProps = {
  state: PublicState | null;
  /** Frozen room rules for a lobby preview before the first game snapshot. */
  config?: GameConfig;
  selected: number | null;
  onSelect: (tile: number) => void;
  /** Legal spaces while the player answers a decision by clicking the board. */
  targets?: readonly number[] | null;
  picked?: number | null;
  pickKey?: string;
  pickSeat?: Seat;
  preview?: boolean;
  zoom?: number;
  onZoom?: (zoom: number) => void;
  viewResetKey?: number;
  interactiveZoom?: boolean;
  viewLocked?: boolean;
  rotation?: THREE.Quaternion;
  onBoardHitTest?: (test: BoardHitTest) => void;
  onWebGlAvailableChange?: (available: boolean) => void;
  pan?: BoardPan;
  graphics?: ClientSettings["graphics"];
  /** Where the roll button sits on screen, in canvas pixels. */
  onRollAnchor?: (point: { x: number; y: number }) => void;
  saleSeat?: Seat;
  saleBlocked?: boolean;
};

function saleTargets(state: PublicState | null, seat?: Seat): number[] {
  if (seat === undefined || state?.pending?.kind !== "sell") return [];
  return legalActions(state, seat).flatMap((action) =>
    action.type === "Sell" ? [action.tile] : [],
  );
}

/** Null is inspection mode; even an empty array keeps a decision in choice mode. */
function choiceTargets(props: BoardProps): readonly number[] | null {
  if (props.preview) return null;
  if (props.targets != null) return props.targets;
  if (props.saleSeat !== undefined && props.state?.pending?.kind === "sell")
    return saleTargets(props.state, props.saleSeat);
  return null;
}

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
// The roll button lies on the lawn between the resting dice and Start.
const ROLL_SPOT: readonly [number, number, number] = [1.05, LAWN_TOP, 1.05];
const DICE_DEFAULT_COLOR = "#d9473a";
// The dice take the roller's color, brighter than the pawn so pips stay crisp.
const DICE_COLORS = ["#e0533b", "#3a87e2", "#9564d3", "#2f9b5f"] as const;
const [BANK_X, BANK_Z] = startBankPoint();
// Bank money leaves and lands just above the bank printed on Start.
const BANK_POSITION: readonly [number, number, number] = [
  BANK_X,
  LOT_TOP + 0.12,
  BANK_Z,
];

function pawnPosition(seat: Seat, tile: number): [number, number, number] {
  const [x, z] = pawnSpot(seat, tile);
  return [x, (isCorner(tile) ? LOT_TOP : ROAD_TOP) + PAWN_LIFT, z];
}

/** Where a walking pawn touches down on a tile it passes without stopping. */
function passingPosition(seat: Seat, tile: number): [number, number, number] {
  const [x, z] = passingSpot(seat, tile);
  return [x, ROAD_TOP + PAWN_LIFT, z];
}

function BoardBase({
  onRendered,
  boardRule,
}: {
  onRendered: () => void;
  boardRule: BoardRule;
}) {
  const lawn = useMemo(() => lawnTexture(boardRule), [boardRule]);
  const road = useMemo(roadTexture, []);
  useEffect(() => () => lawn.dispose(), [lawn]);
  useEffect(() => () => road.dispose(), [road]);
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
  dimmed,
  pickable,
  forSale,
  boardRule,
  unpowered,
}: {
  index: number;
  amount: number | null;
  owner: Seat | null;
  salary: number;
  onSelect: (tile: number) => void;
  preview?: boolean;
  dimmed: boolean;
  /** A Power Cut darkens the lot until its owner's power returns. */
  unpowered: boolean;
  pickable: boolean;
  forSale: boolean;
  boardRule: BoardRule;
}) {
  const { locale } = useLocale();
  const texture = useMemo(
    () =>
      isCorner(index)
        ? cornerTexture(index, locale, salary, boardRule)
        : lotTexture(index, {
            amount,
            owner,
            locale,
            forSale,
            boardRule,
          }),
    [index, amount, owner, locale, salary, forSale, boardRule],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const [x, z] = tileCenter(index);
  const [along, depth] = tileSize(index);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: R3F meshes are inspected with the accessible board controls.
    <mesh
      position={[x, LOT_TOP + 0.0015, z]}
      rotation={[-Math.PI / 2, 0, faceRotation(index)]}
      receiveShadow
      onClick={(event) => {
        if (preview || !pickable) return;
        event.stopPropagation();
        onSelect(index);
      }}
      onPointerOver={(event) => {
        if (!pickable) return;
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        if (pickable) document.body.style.cursor = "";
      }}
    >
      {/* Canvas width runs along play and its height toward the center. */}
      <planeGeometry args={[along - LOT_GAP, depth - LOT_GAP]} />
      {/* Multiplying the print keeps one texture per tile while choices dim others. */}
      <meshBasicMaterial
        map={texture}
        color={dimmed ? "#9d98a4" : unpowered ? "#7f8bab" : "#ffffff"}
        toneMapped={false}
      />
    </mesh>
  );
}

function BoardTiles({
  state,
  config,
  selected,
  onSelect,
  targets,
  preview,
  saleSeat,
  saleBlocked,
}: BoardProps) {
  const boardConfig = state?.config ?? config;
  const rule = boardConfig ? boardRule(boardConfig) : "country";
  const board = getBoard(rule);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const transforms = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const neutral = useMemo(() => new THREE.Color("#ece6ef"), []);
  useEffect(() => {
    if (targets == null || saleBlocked) document.body.style.cursor = "";
  }, [targets, saleBlocked]);
  useEffect(
    () => () => {
      document.body.style.cursor = "";
    },
    [],
  );
  useEffect(() => {
    if (!mesh.current) return;
    for (const tile of board) {
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
      if (targets != null)
        color.set(targets.includes(tile.index) ? "#ffffff" : "#747983");
      else if (tile.index === selected) color.set("#ffd45e");
      else if (owner != null)
        color.set(PLAYER_COLORS[owner]).lerp(neutral, 0.35);
      else color.copy(neutral);
      mesh.current.setColorAt(tile.index, color);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
  }, [state, selected, targets, transforms, color, neutral, board]);
  const salary = boardConfig?.startSalary ?? ECONOMY.startSalary;
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: R3F meshes are inspected with the accessible board controls. */}
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, board.length]}
        receiveShadow
        castShadow
        onClick={(event) => {
          if (
            preview ||
            event.instanceId === undefined ||
            (targets != null &&
              (saleBlocked || !targets.includes(event.instanceId)))
          )
            return;
          event.stopPropagation();
          onSelect(event.instanceId);
        }}
      >
        <boxGeometry />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      {board.map((tile) => {
        const property = state ? getProperty(state, tile.index) : null;
        const owner = property?.owner ?? null;
        return (
          <TileFace
            key={tile.index}
            index={tile.index}
            owner={owner}
            salary={salary}
            dimmed={Boolean(targets && !targets.includes(tile.index))}
            unpowered={Boolean(
              state && property && powerCutActive(state, property),
            )}
            pickable={
              !preview &&
              (targets == null ||
                (!saleBlocked && targets.includes(tile.index)))
            }
            forSale={
              saleSeat !== undefined && Boolean(targets?.includes(tile.index))
            }
            boardRule={rule}
            amount={
              owner != null && state
                ? propertyRent(state, tile.index)
                : tilePrice(tile.index, state ?? (config ? { config } : null))
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

function TileFocus({ state, selected, preview, targets }: BoardProps) {
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
  const focused = targets != null ? [] : [decisionTile, selected];
  return (
    <>
      {focused.map((tile, index) => {
        if (tile == null || (index === 1 && tile === decisionTile)) return null;
        const [x, z] = tileCenter(tile);
        return (
          <mesh
            key={tile}
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

/**
 * A construction animating on one tile: its buildings rise with progress.
 * An earthquake also shakes them sideways along the lot.
 */
type Growth = { tile: number; progress: number; shake?: number };
type TownsHandle = {
  draw: (state: PublicState | null, growth: Growth | null) => void;
};
// Each building starts slightly after the previous one, like a crew at work.
const GROWTH_STAGGER = 0.16;
const GROWTH_SPAN = 0.6;
const growthEase = gsap.parseEase("back.out(2.2)");

function Towns({
  state,
  config,
  preview,
  handle,
}: Pick<BoardProps, "state" | "preview" | "config"> & {
  handle: { current: TownsHandle | null };
}) {
  const boardConfig = state?.config ?? config;
  const rule = boardConfig ? boardRule(boardConfig) : "country";
  const board = getBoard(rule);
  const maxLevel =
    boardConfig && economyRule(boardConfig) === "prototype" ? 5 : 4;
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
      for (const tile of board) {
        const resort = tile.kind === "resort";
        if (tile.kind !== "city" && !resort) continue;
        const growing = growth?.tile === tile.index ? growth : null;
        let order = 0;
        const property = view ? getProperty(view, tile.index) : null;
        const owner = property?.owner;
        // A beach never builds: it either stands empty or carries the one
        // bungalow that says it has been bought.
        const level = resort
          ? owner != null || preview
            ? 1
            : 0
          : owner != null
            ? (property?.level ?? 0)
            : preview
              ? 1 + (tile.index % maxLevel)
              : 0;
        if (level === 0) {
          if (owner == null || resort) continue;
          // Bare land carries a little flag on a stand, so a purchase shows
          // before any house rises.
          const rise = growing
            ? growthEase(
                THREE.MathUtils.clamp(growing.progress / GROWTH_SPAN, 0, 1),
              )
            : 1;
          if (rise <= 0) continue;
          const bandZ = buildingBandZ(tile.index);
          const part = (
            localX: number,
            bottom: number,
            size: [number, number, number],
            hex: string,
          ) => {
            const [x, z] = tilePoint(tile.index, localX, bandZ);
            dummy.rotation.set(0, tileRotation(tile.index), 0);
            dummy.position.set(x, LOT_TOP + bottom + size[1] / 2, z);
            dummy.scale.set(...size);
            dummy.updateMatrix();
            details.current?.setMatrixAt(detailCount, dummy.matrix);
            details.current?.setColorAt(detailCount++, color.set(hex));
          };
          const grown = Math.max(0.02, rise);
          const pole = 0.32 * grown;
          part(0, 0, [0.24, 0.05, 0.24], "#fffaf4");
          part(0, 0.05, [0.022, pole, 0.022], "#6d5b4b");
          part(
            0.085,
            0.04 + pole - 0.1 * grown,
            [0.15, 0.1 * grown, 0.014],
            PLAYER_COLORS[owner],
          );
          continue;
        }
        const roofColor =
          owner != null
            ? PLAYER_COLORS[owner]
            : tileColor(tile.index, { boardRule: rule });
        const angle = tileRotation(tile.index);
        const bandZ = buildingBandZ(tile.index);
        const [faceX, faceZ] = visibleFaces(tile.index);
        const building = (
          plotX: number,
          fullWidth: number,
          fullHeight: number,
          depth = 0.28,
          overhang = 0.05,
          roofHeight = level >= 4 ? 0.13 : 0.12,
        ) => {
          let width = fullWidth;
          let height = fullHeight;
          const localX = plotX + (growing?.shake ?? 0);
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
          dummy.scale.set(width + overhang, roofHeight, depth + overhang);
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
        if (resort) {
          // A low bungalow under a wide thatch roof, beside the parasol.
          building(0.2, 0.36, 0.14, 0.26, 0.1, 0.14);
        } else if (level >= 1 && level <= 3) {
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
    [preview, dummy, color, board, rule, maxLevel],
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

// The parasol keeps its coral canvas on every beach: it says "beach", and the
// bungalow beside it says who bought it.
function ResortProps({ boardRule }: { boardRule: BoardRule }) {
  return (
    <>
      {getBoard(boardRule)
        .filter((tile) => tile.kind === "resort")
        .map((tile) => {
          const [x, z] = tilePoint(
            tile.index,
            -0.28,
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

function unitFrameGeometry(inset: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0.5, 0.5);
  shape.lineTo(-0.5, 0.5);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-inset, -inset);
  hole.lineTo(-inset, inset);
  hole.lineTo(inset, inset);
  hole.lineTo(inset, -inset);
  hole.closePath();
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape);
}

/** Legal spaces glow in the chooser's colour; the clicked one carries a pin. */
function PickHighlights({
  targets,
  picked,
  color,
  lowGraphics = false,
}: {
  targets: readonly number[];
  picked: number | null;
  color: string;
  lowGraphics?: boolean;
}) {
  const { reducedMotion } = useDirector();
  const staticHighlights = reducedMotion || lowGraphics;
  const { invalidate } = useThree();
  const frames = useRef<THREE.InstancedMesh>(null);
  const fills = useRef<THREE.InstancedMesh>(null);
  const pin = useRef<THREE.Group>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const frame = useMemo(() => unitFrameGeometry(0.47), []);
  const fillMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      frame.dispose();
      fillMaterial.dispose();
    },
    [frame, fillMaterial],
  );
  useEffect(() => {
    fillMaterial.color.set(color);
    const outlines = frames.current;
    const glow = fills.current;
    if (!outlines || !glow) return;
    targets.forEach((tile, index) => {
      const [x, z] = tileCenter(tile);
      const [along, depth] = tileSize(tile);
      transform.position.set(x, LOT_TOP + 0.0045, z);
      transform.rotation.set(-Math.PI / 2, 0, tileRotation(tile));
      transform.scale.set(along - LOT_GAP, depth - LOT_GAP, 1);
      transform.updateMatrix();
      outlines.setMatrixAt(index, transform.matrix);
      transform.position.y = LOT_TOP + 0.003;
      transform.updateMatrix();
      glow.setMatrixAt(index, transform.matrix);
    });
    outlines.count = glow.count = targets.length;
    outlines.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    outlines.computeBoundingSphere();
    glow.computeBoundingSphere();
    invalidate();
  }, [targets, color, transform, fillMaterial, invalidate]);
  useFrame((frameState) => {
    const time = frameState.clock.elapsedTime;
    fillMaterial.opacity = staticHighlights
      ? 0.14
      : 0.06 + 0.13 * (0.5 + 0.5 * Math.sin(time * 4));
    if (pin.current) {
      pin.current.position.y = staticHighlights ? 0 : Math.sin(time * 3) * 0.06;
      pin.current.rotation.y = staticHighlights ? 0 : time * 1.4;
    }
    // The board renders on demand; keep frames coming only while choosing.
    if (!staticHighlights) frameState.invalidate();
  });
  const [pinX, pinZ] = picked === null ? [0, 0] : tileCenter(picked);
  return (
    <>
      <instancedMesh
        ref={fills}
        args={[undefined, fillMaterial, BOARD_SIZE]}
        frustumCulled={false}
        renderOrder={1}
      >
        <planeGeometry />
      </instancedMesh>
      <instancedMesh
        ref={frames}
        args={[frame, undefined, BOARD_SIZE]}
        frustumCulled={false}
        renderOrder={2}
      >
        <meshBasicMaterial color={color} toneMapped={false} />
      </instancedMesh>
      {picked !== null && (
        <group position={[pinX, LOT_TOP, pinZ]}>
          <group ref={pin}>
            <group position={[0, 0.82, 0]}>
              <mesh
                position={[0, -0.17, 0]}
                rotation={[Math.PI, 0, 0]}
                castShadow
              >
                <coneGeometry args={[0.105, 0.32, 16]} />
                <meshStandardMaterial color={color} roughness={0.55} />
              </mesh>
              <mesh castShadow>
                <sphereGeometry args={[0.15, 18, 14]} />
                <meshStandardMaterial color={color} roughness={0.55} />
              </mesh>
              <mesh>
                <torusGeometry args={[0.152, 0.026, 8, 24]} />
                <meshStandardMaterial color="#fffaf0" roughness={0.6} />
              </mesh>
            </group>
          </group>
        </group>
      )}
    </>
  );
}

function pennantGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, -1);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

const BUNTING_FLAGS = 7;
const BUNTING_HEIGHT = 0.62;
const BUNTING_SAG = 0.08;
const BUNTING_HALF = 0.46;

/** Tile-local z of a festival garland: the screen-top edge of the plot. */
function buntingZ(index: number) {
  return screenTop(index) * (LOT_DEPTH / 2 - 0.05);
}

/**
 * Festival cities keep their country colour; a garland of vivid pennants between
 * two masts marks the fête, and the championship host adds its searchlights.
 * The rent multiplier lives in the inspector.
 */
/** A small shield floats over each shielded property until an attack breaks it. */
function ShieldMarkers({ state }: { state: PublicState | null }) {
  const texture = useMemo(shieldTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <>
      {state?.properties
        .filter((property) => property.shielded)
        .map((property) => {
          const [x, z] = tileCenter(property.tile);
          return (
            <sprite
              key={property.tile}
              position={[x, LOT_TOP + 0.8, z]}
              scale={[0.46, 0.52, 1]}
              renderOrder={4}
            >
              <spriteMaterial
                map={texture}
                transparent
                depthTest={false}
                toneMapped={false}
              />
            </sprite>
          );
        })}
    </>
  );
}

function FestivalMarkers({ state }: { state: PublicState | null }) {
  const masts = useRef<THREE.InstancedMesh>(null);
  const cords = useRef<THREE.InstancedMesh>(null);
  const flags = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const pennant = useMemo(pennantGeometry, []);
  const festivalKey = state
    ? [
        ...new Set([
          ...state.festivalTiles,
          ...(state.championshipHost ? [state.championshipHost.tile] : []),
        ]),
      ].join(",")
    : "";
  const festivals = useMemo(
    () => (festivalKey ? festivalKey.split(",").map(Number) : []),
    [festivalKey],
  );
  const hostTile = state?.championshipHost?.tile ?? null;
  const hostSpot =
    hostTile === null ? null : tilePoint(hostTile, 0, buntingZ(hostTile));
  useEffect(() => () => pennant.dispose(), [pennant]);
  useEffect(() => {
    const mastMesh = masts.current;
    const cordMesh = cords.current;
    const flagMesh = flags.current;
    if (!mastMesh || !cordMesh || !flagMesh) return;
    let mastCount = 0;
    let cordCount = 0;
    let flagCount = 0;
    for (const tile of festivals) {
      const angle = tileRotation(tile);
      const z = buntingZ(tile);
      for (const side of [-1, 1]) {
        const [x, worldZ] = tilePoint(tile, side * BUNTING_HALF, z);
        transform.position.set(x, LOT_TOP + BUNTING_HEIGHT / 2, worldZ);
        transform.rotation.set(0, 0, 0);
        transform.scale.set(1, BUNTING_HEIGHT, 1);
        transform.updateMatrix();
        mastMesh.setMatrixAt(mastCount++, transform.matrix);
      }
      // Two straight cord halves meet at the sagging middle of the garland.
      for (const side of [-1, 1]) {
        const [x, worldZ] = tilePoint(tile, (side * BUNTING_HALF) / 2, z);
        transform.position.set(
          x,
          LOT_TOP + BUNTING_HEIGHT - BUNTING_SAG / 2,
          worldZ,
        );
        transform.rotation.set(
          0,
          angle,
          side * Math.atan2(BUNTING_SAG, BUNTING_HALF),
        );
        transform.scale.set(Math.hypot(BUNTING_HALF, BUNTING_SAG), 1, 1);
        transform.updateMatrix();
        cordMesh.setMatrixAt(cordCount++, transform.matrix);
      }
      for (let flag = 0; flag < BUNTING_FLAGS; flag++) {
        const along =
          -BUNTING_HALF * 0.86 +
          (flag * BUNTING_HALF * 1.72) / (BUNTING_FLAGS - 1);
        const [x, worldZ] = tilePoint(tile, along, z);
        const drop = BUNTING_SAG * (1 - Math.abs(along) / BUNTING_HALF);
        transform.position.set(x, LOT_TOP + BUNTING_HEIGHT - drop, worldZ);
        transform.rotation.set(0, angle, 0);
        transform.scale.set(0.085, 0.11, 1);
        transform.updateMatrix();
        flagMesh.setMatrixAt(flagCount, transform.matrix);
        flagMesh.setColorAt(
          flagCount++,
          color.set(FESTIVAL_COLORS[(flag + tile) % FESTIVAL_COLORS.length]),
        );
      }
    }
    mastMesh.count = mastCount;
    cordMesh.count = cordCount;
    flagMesh.count = flagCount;
    for (const mesh of [mastMesh, cordMesh, flagMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [festivals, transform, color]);
  return (
    <>
      <instancedMesh ref={masts} args={[undefined, undefined, 48]} castShadow>
        <cylinderGeometry args={[0.012, 0.014, 1, 6]} />
        <meshStandardMaterial color="#b98a3e" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={cords} args={[undefined, undefined, 48]}>
        <boxGeometry args={[1, 0.006, 0.006]} />
        <meshBasicMaterial color="#6d5a3c" />
      </instancedMesh>
      <instancedMesh
        ref={flags}
        args={[pennant, undefined, 24 * BUNTING_FLAGS]}
        castShadow
      >
        <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
      </instancedMesh>
      {hostSpot && (
        <group position={[hostSpot[0], LOT_TOP, hostSpot[1]]}>
          <FestivalBeams />
        </group>
      )}
    </>
  );
}

/** Two crossed searchlights mark the city that a player chose to host. */
function FestivalBeams() {
  return (
    <>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * 0.16, 0.95, 0]}
          rotation={[0, Math.PI / 4, side * -0.32]}
        >
          <cylinderGeometry args={[0.2, 0.025, 1.9, 14, 1, true]} />
          <meshBasicMaterial
            color="#fff1b0"
            transparent
            opacity={0.2}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
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
      </group>
    </group>
  );
}

const CASH_BUNDLES_PER_SEAT = 6;
const KEEP_CARDS: readonly KeepCard[] = ["Guardian Angel", "Coupon", "Escape"];
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

/** Kept Chance cards lie face up beside their holder's cash, one per card. */
function HeldCards({ state, card }: { state: PublicState; card: KeepCard }) {
  const cards = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const texture = useMemo(() => heldCardTexture(card), [card]);
  const { invalidate } = useThree();
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    const mesh = cards.current;
    if (!mesh) return;
    let count = 0;
    for (const player of state.players) {
      const slot = player.heldCards.indexOf(card);
      if (player.bankrupt || slot < 0) continue;
      const { rotation } = reserveAnchor(player.seat);
      transform.position.set(
        ...reserveSpot(
          player.seat,
          -0.86 - slot * 0.14,
          (slot - 0.3) * 0.44,
          BOARD_BOTTOM + 0.008 + slot * 0.006,
        ),
      );
      transform.rotation.set(0, rotation + (slot ? -0.16 : 0.07), 0);
      transform.updateMatrix();
      mesh.setMatrixAt(count++, transform.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [state, card, transform, invalidate]);
  return (
    <instancedMesh ref={cards} args={[undefined, undefined, 4]} castShadow>
      <boxGeometry args={[0.36, 0.012, 0.5]} />
      <meshStandardMaterial map={texture} roughness={0.55} />
    </instancedMesh>
  );
}

/**
 * Who pays whom. `null` is the bank, unless `tile` is set: property money
 * moves between a player and that lot, not through the bank.
 */
type CashTransfer = {
  from: Seat | null;
  to: Seat | null;
  amount: number;
  tile?: number;
};

function cashTransfer(event: GameEvent): CashTransfer | null {
  switch (event.type) {
    case "SalaryPaid":
      return { from: null, to: event.seat, amount: event.amount };
    case "PropertySold":
      return {
        from: null,
        to: event.seat,
        amount: event.amount,
        tile: event.tile,
      };
    case "RentPaid":
      return {
        from: event.seat,
        to: event.owner,
        tile: event.tile,
        amount: event.amount,
      };
    case "MoneyTransferred":
      return { from: event.from, to: event.to, amount: event.amount };
    case "BoughtOut":
      return {
        from: event.seat,
        to: event.previousOwner,
        tile: event.tile,
        amount: event.amount,
      };
    case "PropertyBought":
    case "PropertyUpgraded":
      return {
        from: event.seat,
        to: null,
        amount: event.amount,
        tile: event.tile,
      };
    default:
      return null;
  }
}

/** The DOM interface zoom set by CSS media steps on large screens. */
function interfaceZoom() {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom"),
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function SceneContent(props: BoardProps) {
  const { state, preview, zoom = 1, pan, onRollAnchor, onBoardHitTest } = props;
  const potato = props.graphics === "potato";
  const lowGraphics = (props.graphics ?? "high") !== "high";
  const rotation = props.rotation ?? DEFAULT_BOARD_ROTATION;
  const boardConfig = state?.config ?? props.config;
  const rule = boardConfig ? boardRule(boardConfig) : "country";
  const chosen =
    props.saleSeat !== undefined ? props.selected : (props.picked ?? null);
  const { camera, invalidate, size, gl, viewport } = useThree();
  const ambient = useAmbientMotion({
    state,
    preview,
    lowGraphics,
  });
  const pawns = useRef<(THREE.Group | null)[]>([]);
  const dice = useRef<(THREE.Group | null)[]>([]);
  const diceMaterials = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const score = useRef<THREE.Sprite>(null);
  const scoreTextures = useRef(new Map<string, THREE.Texture>());
  const timelines = useRef(new Map<gsap.core.Timeline, () => void>());
  const towns = useRef<TownsHandle | null>(null);
  const downtown = useRef<DowntownHandle | null>(null);
  const growth = useMemo(() => ({ tile: 0, progress: 0 }), []);
  const pulse = useRef<THREE.Mesh>(null);
  const destination = useRef<THREE.Mesh>(null);
  const destinationOutlines = useMemo(
    () => ({
      lot: outlineGeometry(LOT_WIDTH, LOT_DEPTH, 0.06),
      corner: outlineGeometry(LOT_DEPTH, LOT_DEPTH, 0.07),
    }),
    [],
  );
  useEffect(
    () => () => {
      destinationOutlines.lot.dispose();
      destinationOutlines.corner.dispose();
    },
    [destinationOutlines],
  );
  const sparks = useRef<THREE.InstancedMesh>(null);
  const sparkTransform = useMemo(() => new THREE.Object3D(), []);
  const sparkProgress = useMemo(() => ({ value: 0 }), []);
  const { locale } = useLocale();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const gain = useRef<THREE.Sprite>(null);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: R3F resets the orthographic frustum on DPR changes; restore the board framing.
  useEffect(() => {
    if (camera instanceof THREE.OrthographicCamera)
      frameBoard(
        camera,
        size.width,
        size.height,
        Boolean(preview),
        zoom,
        pan,
        interfaceZoom(),
        rotation,
      );
    if (onRollAnchor) {
      const spot = new THREE.Vector3(...ROLL_SPOT)
        .applyQuaternion(rotation)
        .project(camera);
      onRollAnchor({
        x: ((spot.x + 1) / 2) * size.width,
        y: ((1 - spot.y) / 2) * size.height,
      });
    }
    invalidate();
  }, [
    camera,
    size.width,
    size.height,
    viewport.dpr,
    zoom,
    pan,
    rotation,
    preview,
    invalidate,
    onRollAnchor,
  ]);

  useEffect(() => {
    if (!onBoardHitTest) return;
    onBoardHitTest((x, y) => {
      const bounds = gl.domElement.getBoundingClientRect();
      return boardScreenHit(
        camera,
        bounds.width,
        bounds.height,
        x - bounds.left,
        y - bounds.top,
        rotation,
      );
    });
    return () => onBoardHitTest(() => false);
  }, [camera, gl, onBoardHitTest, rotation]);
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
    /** Outlines the space a thrown pawn is about to reach, in the roller's colour. */
    function markDestination(tile: number | null, seat: Seat) {
      const mark = destination.current;
      if (!mark) return;
      mark.visible = tile !== null;
      if (tile !== null) {
        const [x, z] = tileCenter(tile);
        mark.geometry = isCorner(tile)
          ? destinationOutlines.corner
          : destinationOutlines.lot;
        mark.position.set(x, LOT_TOP + 0.004, z);
        mark.rotation.set(-Math.PI / 2, 0, tileRotation(tile));
        if (mark.material instanceof THREE.MeshBasicMaterial)
          mark.material.color.set(PLAYER_COLORS[seat]);
      }
      invalidate();
    }
    function snap(next: PublicState | null) {
      if (destination.current) destination.current.visible = false;
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
      downtown.current?.draw(next, null);
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
      if (destination.current) destination.current.visible = false;
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
        timeline.timeScale(context.playbackRate);
        timeline.play();
      });
    }
    /** A "+400K" that floats up from a tile and fades when money is gained there. */
    async function showGain(
      tile: number,
      amount: number,
      context: AnimationContext,
    ) {
      const sprite = gain.current;
      if (!sprite) return;
      const text = `+${boardAmount(amount, localeRef.current)}`;
      const key = `gain:${text}`;
      let texture = scoreTextures.current.get(key);
      if (!texture) {
        texture = gainTexture(text);
        scoreTextures.current.set(key, texture);
      }
      const [x, z] = tileCenter(tile);
      sprite.material.map = texture;
      sprite.material.opacity = 0;
      sprite.material.needsUpdate = true;
      sprite.position.set(x, LOT_TOP + 0.9, z);
      sprite.scale.set(1.4, 0.47, 1);
      sprite.visible = true;
      await play((timeline) => {
        timeline.to(sprite.material, { opacity: 1, duration: 0.12 }, 0);
        timeline.to(
          sprite.position,
          { y: LOT_TOP + 2.3, duration: 1.4, ease: "power1.out" },
          0,
        );
        timeline.to(
          sprite.material,
          { opacity: 0, duration: 0.7, ease: "power1.in" },
          0.7,
        );
      }, context);
      sprite.visible = false;
      invalidate();
    }
    /** Eight sparks fly out of a lot as `sparkProgress` runs from 0 to 1. */
    function drawSparks(x: number, z: number, spread = 0.45, lift = 0.6) {
      const burst = sparks.current;
      if (!burst) return;
      const progress = sparkProgress.value;
      for (let index = 0; index < 8; index++) {
        const angle = (index * Math.PI) / 4;
        const radius = 0.16 + progress * spread;
        sparkTransform.position.set(
          x + Math.cos(angle) * radius,
          LOT_TOP + 0.1 + Math.sin(progress * Math.PI) * lift,
          z + Math.sin(angle) * radius,
        );
        sparkTransform.rotation.set(progress * Math.PI, angle, Math.PI / 4);
        sparkTransform.scale.setScalar(0.08 * (1 - progress));
        sparkTransform.updateMatrix();
        burst.setMatrixAt(index, sparkTransform.matrix);
      }
      burst.instanceMatrix.needsUpdate = true;
    }
    function paintEffect(ringColor: string, sparkColor: string) {
      const ring = pulse.current;
      const burst = sparks.current;
      if (ring?.material instanceof THREE.MeshBasicMaterial)
        ring.material.color.set(ringColor);
      if (burst?.material instanceof THREE.MeshBasicMaterial)
        burst.material.color.set(sparkColor);
    }
    /** A ring and a spark burst on one lot, where a card's effect lands. */
    async function flash(
      tile: number,
      ringColor: string,
      sparkColor: string,
      hold: number,
      context: AnimationContext,
    ) {
      const ring = pulse.current;
      const burst = sparks.current;
      if (!ring || !burst) return;
      const effectGeneration = ++propertyEffectGeneration;
      const [x, z] = tileCenter(tile);
      ring.position.set(x, LOT_TOP + 0.03, z);
      paintEffect(ringColor, sparkColor);
      ring.visible = burst.visible = true;
      await play((timeline) => {
        timeline.fromTo(
          ring.scale,
          { x: 0.1, y: 0.1, z: 0.1 },
          { x: 1.3, y: 1.3, z: 1.3, duration: 0.5, ease: "power2.out" },
        );
        timeline.fromTo(
          sparkProgress,
          { value: 0 },
          {
            value: 1,
            duration: 0.5,
            ease: "power2.out",
            onUpdate: () => drawSparks(x, z),
          },
          0,
        );
        timeline.set({}, {}, hold);
      }, context);
      if (effectGeneration === propertyEffectGeneration) {
        ring.visible = burst.visible = false;
        invalidate();
      }
    }
    async function animateCash(
      transfer: CashTransfer | null,
      context: AnimationContext,
    ) {
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
      const lot = transfer.tile;
      const reserve = (
        seat: Seat | null,
      ): readonly [number, number, number] => {
        if (seat !== null) return reserveSpot(seat, 0, 0, BOARD_BOTTOM + 0.2);
        if (lot === undefined) return BANK_POSITION;
        const [x, z] = tileCenter(lot);
        return [x, LOT_TOP + 0.12, z];
      };
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
      // State recovery can resolve an older timeline after a newer one began.
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
        if (!(await animateCash(cashTransfer(event), context))) return;
        // The outline of the space ahead stays through the walk and the
        // decision that opens there; any later event clears it.
        if (
          event.type !== "DiceRolled" &&
          event.type !== "PlayerMoved" &&
          event.type !== "SalaryPaid" &&
          event.type !== "TurnPhaseChanged" &&
          event.type !== "DecisionOpened"
        )
          markDestination(null, 0);
        if (event.type === "DiceRolled") {
          markDestination(null, event.seat);
          const arrival = context.upcoming.find(
            (upcoming) =>
              upcoming.type === "PlayerMoved" && upcoming.seat === event.seat,
          );
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
            if (arrival?.type === "PlayerMoved")
              timeline.call(
                () => markDestination(arrival.position, event.seat),
                [],
                reveal,
              );
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
          // The salary is paid the moment the pawn reaches Start, not when
          // the walk ends.
          const pending: Promise<unknown>[] = [];
          let paid = false;
          const paySalary = () => {
            const salary = context.salary;
            if (!salary || paid) return;
            paid = true;
            salary.settle();
            pending.push(
              animateCash(cashTransfer(salary.event), context),
              showGain(0, salary.event.amount, context),
            );
          };
          await play((timeline) => {
            if (steps === 0) {
              // A move without a route: one long leap to the destination.
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
              timeline.call(paySalary, [], half * 2);
            } else {
              // A board-game walk: one hop per tile, a settle on the last.
              // Corners passed on the way are turned on the road. World Tour
              // and card moves follow the same road past Start, hopping
              // faster and lower to fit the longest dice walk.
              const count = Math.abs(steps);
              const pace =
                Math.min(
                  DECISION_TIMING.stepAnimation,
                  DECISION_TIMING.walkAnimation / count,
                ) / DECISION_TIMING.stepAnimation;
              const duration = (DECISION_TIMING.stepAnimation / 1000) * pace;
              const lift = 0.5 * pace;
              for (let step = 1; step <= count; step++) {
                const tile =
                  (((from + step * Math.sign(steps)) % 32) + 32) % 32;
                const last = step === count;
                const [x, y, z] = last
                  ? pawnPosition(event.seat, tile)
                  : passingPosition(event.seat, tile);
                const at = (step - 1) * duration;
                if (tile === 0)
                  timeline.call(paySalary, [], at + duration * 0.9);
                timeline.to(
                  pawn.position,
                  { x, z, duration: duration * 0.9, ease: "sine.inOut" },
                  at,
                );
                timeline.to(
                  pawn.position,
                  {
                    y: y + lift,
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
          paySalary();
          await Promise.all(pending);
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
          paintEffect(
            owner == null ? "#ffda72" : PLAYER_COLORS[owner],
            "#ffcf59",
          );
          ring.visible = true;
          const burst = sparks.current;
          if (burst) burst.visible = true;
          const updateSparks = () => drawSparks(x, z);
          const before = context.previous
            ? getProperty(context.previous, event.tile)
            : null;
          const after = getProperty(context.next, event.tile);
          // New houses rise one after another on their plot, a beach raises
          // its bungalow the moment it is taken, and bare land its flag; the
          // view shows the next state on this tile while it is being built.
          const builds =
            getBoard(context.next.config)[event.tile].kind === "resort"
              ? after?.owner != null
              : event.type !== "BoughtOut" &&
                getBoard(context.next.config)[event.tile].kind === "city" &&
                ((after?.level ?? 0) > (before?.level ?? 0) ||
                  (before?.owner == null && after?.owner != null));
          // The town plot answers every change of owner or level.
          const rebuilds =
            before?.owner !== after?.owner || before?.level !== after?.level;
          const drawGrowth = () => {
            if (builds) towns.current?.draw(context.next, growth);
            if (rebuilds) downtown.current?.draw(context.next, growth);
          };
          growth.tile = event.tile;
          growth.progress = 0;
          drawGrowth();
          const budget = DECISION_TIMING.propertyAnimation / 1000;
          await play((timeline) => {
            timeline.fromTo(
              ring.scale,
              { x: 0.1, y: 0.1, z: 0.1 },
              { x: 1.3, y: 1.3, z: 1.3, duration: 0.55, ease: "power2.out" },
            );
            if (builds || rebuilds)
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
        } else if (event.type === "PropertyDowngraded") {
          // Earthquake: the city shakes on its lot, sinks into a cloud of
          // dust, then whatever still stands rises again. The roofs keep the
          // owner's colour, so everyone sees whose city was hit.
          const ring = pulse.current;
          const burst = sparks.current;
          if (!ring || !burst) return;
          const effectGeneration = ++propertyEffectGeneration;
          const [x, z] = tileCenter(event.tile);
          const wreck = { tile: event.tile, progress: 1, shake: 0, time: 0 };
          const drawWreck = () =>
            towns.current?.draw(context.previous ?? context.next, wreck);
          const drawRemains = () => towns.current?.draw(context.next, growth);
          ring.position.set(x, LOT_TOP + 0.03, z);
          paintEffect("#e5533d", "#b9a58b");
          ring.visible = true;
          drawWreck();
          await play((timeline) => {
            timeline.fromTo(
              ring.scale,
              { x: 0.1, y: 0.1, z: 0.1 },
              { x: 1.4, y: 1.4, z: 1.4, duration: 0.7, ease: "power2.out" },
            );
            timeline.to(
              wreck,
              {
                time: 1,
                duration: 0.8,
                ease: "none",
                onUpdate: () => {
                  wreck.shake =
                    Math.sin(wreck.time * Math.PI * 12) *
                    0.06 *
                    (1 - wreck.time);
                  drawWreck();
                },
              },
              0,
            );
            timeline.call(
              () => {
                burst.visible = true;
              },
              [],
              0.8,
            );
            timeline.to(
              wreck,
              {
                progress: 0,
                duration: 0.6,
                ease: "power2.in",
                onUpdate: drawWreck,
              },
              0.8,
            );
            timeline.fromTo(
              sparkProgress,
              { value: 0 },
              {
                value: 1,
                duration: 0.9,
                ease: "power2.out",
                onUpdate: () => drawSparks(x, z, 0.6, 0.3),
              },
              0.8,
            );
            timeline.call(
              () => {
                growth.tile = event.tile;
                growth.progress = 0;
                drawRemains();
              },
              [],
              1.45,
            );
            timeline.to(
              growth,
              {
                progress: 1,
                duration: 0.5,
                ease: "none",
                onUpdate: drawRemains,
              },
              1.45,
            );
            timeline.set({}, {}, DECISION_TIMING.wreckAnimation / 1000);
          }, context);
          if (effectGeneration === propertyEffectGeneration) {
            ring.visible = burst.visible = false;
            invalidate();
          }
        } else if (
          event.type === "ShieldRaised" ||
          event.type === "ShieldBroken"
        ) {
          await flash(
            event.tile,
            "#5cb4e6",
            event.type === "ShieldRaised" ? "#ffffff" : "#bfe3f7",
            DECISION_TIMING.propertyAnimation / 1000,
            context,
          );
        } else if (event.type === "PropertyGiven") {
          towns.current?.draw(context.next, null);
          await flash(
            event.tile,
            PLAYER_COLORS[event.to],
            "#ffcf59",
            DECISION_TIMING.propertyAnimation / 1000,
            context,
          );
        } else if (event.type === "PowerCut") {
          await flash(
            event.tile,
            "#24435a",
            "#ffd35c",
            DECISION_TIMING.propertyAnimation / 1000,
            context,
          );
        } else if (event.type === "PropertiesSwapped") {
          // Both cities change roofs at once; a ring in each new owner's
          // colour marks one lot after the other.
          towns.current?.draw(context.next, null);
          const half = DECISION_TIMING.propertyAnimation / 2000;
          await flash(
            event.tile,
            PLAYER_COLORS[event.otherSeat],
            "#ffcf59",
            half,
            context,
          );
          await flash(
            event.otherTile,
            PLAYER_COLORS[event.seat],
            "#ffcf59",
            half,
            context,
          );
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
    destinationOutlines,
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
        castShadow={!lowGraphics}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-normalBias={0.035}
        shadow-radius={3}
      />
      <group name="board-user-view" quaternion={rotation}>
        <BoardBase
          boardRule={rule}
          onRendered={() => {
            if (rendered.current) return;
            rendered.current = true;
            gl.domElement.dataset.sceneReady = "true";
            gl.domElement
              .closest(".canvas-layer")
              ?.setAttribute("data-scene-ready", "true");
          }}
        />
        {!potato && !preview && state && <CashReserves state={state} />}
        {!preview &&
          state &&
          KEEP_CARDS.map((card) => (
            <HeldCards key={card} state={state} card={card} />
          ))}
        <BoardTiles {...props} />
        <TileFocus {...props} />
        {!preview && props.targets && (
          <PickHighlights
            key={props.pickKey}
            targets={props.targets}
            picked={
              chosen != null && props.targets.includes(chosen) ? chosen : null
            }
            color={PLAYER_COLORS[props.pickSeat ?? state?.pending?.seat ?? 0]}
            lowGraphics={lowGraphics}
          />
        )}
        <Towns
          state={state}
          config={boardConfig}
          preview={preview}
          handle={towns}
        />
        {!potato && (
          <>
            <Downtown
              state={state}
              config={boardConfig}
              preview={preview}
              animated={ambient}
              handle={downtown}
            />
            <ResortProps boardRule={rule} />
          </>
        )}
        <FestivalMarkers state={state} />
        {!preview && <ShieldMarkers state={state} />}
        <Landmarks
          boardRule={rule}
          state={state}
          animated={ambient}
          lowGraphics={lowGraphics}
          potato={potato}
        />
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
        <mesh
          ref={destination}
          visible={false}
          geometry={destinationOutlines.lot}
          renderOrder={2}
        >
          <meshBasicMaterial color="#e8a321" toneMapped={false} />
        </mesh>
        <sprite ref={gain} visible={false} renderOrder={6}>
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
      </group>
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

// Quotes live on the actual lots, so mouse and keyboard choose the same city.
// The projection uses the scene's fixed camera and framing, including user zoom.
function SaleLabels({
  state,
  selected,
  onSelect,
  saleSeat,
  saleBlocked,
  zoom = 1,
  pan,
  rotation = DEFAULT_BOARD_ROTATION,
  width,
  height,
}: BoardProps & { width: number; height: number }) {
  const { t } = useLocale();
  const targets = saleTargets(state, saleSeat);
  const camera = useMemo(() => {
    const value = initializeBoardCamera(new THREE.OrthographicCamera());
    frameBoard(
      value,
      width,
      height,
      false,
      zoom,
      pan,
      interfaceZoom(),
      rotation,
    );
    return value;
  }, [width, height, zoom, pan, rotation]);
  if (!state || !targets.length || !width || !height) return null;
  return (
    <fieldset
      className="sale-labels"
      aria-label={t(
        "Villes à vendre sur le plateau",
        "Cities for sale on the board",
      )}
    >
      {targets.map((tile) => {
        const [x, z] = tilePoint(tile, 0, 0.3);
        const point = new THREE.Vector3(x, LOT_TOP + 0.08, z)
          .applyQuaternion(rotation)
          .project(camera);
        const amount = money(propertyRefund(state, tile));
        const chosen = tile === selected;
        return (
          <button
            key={tile}
            type="button"
            className="sale-tile-quote"
            data-tile={tile}
            aria-label={t(
              `Choisir ${tileName(tile, state.config)} à vendre · ${amount}`,
              `Choose ${tileName(tile, state.config)} to sell · ${amount}`,
            )}
            aria-pressed={chosen}
            disabled={saleBlocked}
            style={{
              left: ((point.x + 1) * width) / 2,
              top: ((1 - point.y) * height) / 2,
            }}
            onClick={() => onSelect(tile)}
          >
            <span className="sale-tile-check" aria-hidden="true">
              {chosen ? "✓" : ""}
            </span>
            <span>+{amount}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

export default function BoardScene(props: BoardProps) {
  const graphics = props.graphics ?? "high";
  const lowGraphics = graphics !== "high";
  const { t } = useLocale();
  const config = props.state?.config ?? props.config;
  const layer = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [orientation, setOrientation] = useState<BoardOrientation>(
    DEFAULT_BOARD_ORIENTATION,
  );
  const rotation = useMemo(() => boardViewRotation(orientation), [orientation]);
  const hitTest = useRef<BoardHitTest>(() => false);
  const setHitTest = useCallback((test: BoardHitTest) => {
    hitTest.current = test;
  }, []);
  const canStartGesture = useCallback(
    (x: number, y: number) => hitTest.current(x, y),
    [],
  );
  const zoom = clampBoardZoom(props.zoom ?? 1);
  const framing = useMemo(
    () =>
      frameBoard(
        initializeBoardCamera(new THREE.OrthographicCamera()),
        size.width,
        size.height,
        Boolean(props.preview),
        zoom,
        undefined,
        interfaceZoom(),
        rotation,
      ),
    [size.width, size.height, props.preview, zoom, rotation],
  );
  const pan = useBoardView({
    layer,
    enabled: Boolean(
      props.interactiveZoom && !props.preview && size.width && size.height,
    ),
    locked: Boolean(props.viewLocked),
    zoom,
    onZoom: props.onZoom,
    resetKey: props.viewResetKey,
    limits: framing.limits,
    unitsPerPixel: framing.unitsPerPixel,
    orientation,
    onOrientation: setOrientation,
    canStartGesture,
  });
  const resolvedProps = {
    ...props,
    zoom,
    pan,
    rotation,
    onBoardHitTest: setHitTest,
    targets: choiceTargets(props),
  };
  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <section
      ref={layer}
      className="canvas-layer"
      aria-label={t("Plateau de jeu", "Game board")}
      tabIndex={props.interactiveZoom ? 0 : undefined}
      data-board-zoom={zoom}
      data-board-yaw={orientation.yaw}
      data-board-pitch={orientation.pitch}
      data-board-view-locked={Boolean(props.viewLocked)}
      data-board-pan-x={pan.x}
      data-board-pan-y={pan.y}
      data-interactive-zoom={Boolean(
        props.interactiveZoom && !props.preview && !props.viewLocked,
      )}
      data-board-rule={config ? boardRule(config) : "country"}
      data-scene-ready="false"
      data-low-graphics={lowGraphics}
      data-graphics-quality={graphics}
      data-sale-active={
        !props.preview && saleTargets(props.state, props.saleSeat).length > 0
      }
    >
      <Canvas
        orthographic
        shadows={lowGraphics ? false : { type: THREE.PCFShadowMap }}
        frameloop="demand"
        dpr={graphics === "potato" ? 0.75 : lowGraphics ? 1 : [1, 1.5]}
        camera={{ position: [...CAMERA_OFFSET], near: 0.1, far: 100, zoom: 1 }}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.NeutralToneMapping,
        }}
        onCreated={({ camera }) => {
          initializeBoardCamera(camera);
          props.onWebGlAvailableChange?.(true);
        }}
      >
        <SceneContent {...resolvedProps} />
      </Canvas>
      {!props.preview && <SaleLabels {...resolvedProps} {...size} />}
    </section>
  );
}
