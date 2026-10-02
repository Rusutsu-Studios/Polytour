import { useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BOARD } from "../../shared/board/index.js";
import type { PublicState } from "../../shared/engine/index.js";
import { getProperty } from "../../shared/engine/index.js";
import { useDirector } from "../director/director.js";
import { PLAYER_COLORS, tileColor } from "../ui/board-display.js";
import { LAWN_TOP, visibleFaces } from "./board-layout.js";
import { mix } from "./board-textures.js";
import {
  CAROUSEL,
  FERRIS_WHEEL,
  FERRIS_WHEEL_RADIUS,
  FOUNTAINS,
  HELIPAD,
  PLOT_DEPTH,
  POND,
  plotTree,
  TOWN_PLOTS,
  TOWN_TREES,
  type TownPlot,
  type TownTree,
  townCircuit,
} from "./town-layout.js";

// The living town in the middle of the board. Its plots mirror the board:
// each city or resort has one, empty and wooded until someone buys it, then
// built to the same level as the lot, under the owner's color. Construction
// is played by the Director like the lot's own buildings. Cars, the big
// wheel, the carousel, a sailing boat, a helicopter and the fountains only
// add ambient life; reduced motion keeps them still.

export type TownGrowth = { tile: number; progress: number };
export type DowntownHandle = {
  draw: (state: PublicState | null, growth: TownGrowth | null) => void;
};

/** Ambient life renders at this rate between game animations. */
const AMBIENT_FRAME_MS = 1000 / 30;
const CAR_SPEED = 0.42;
const CAR_COLORS = [
  "#fffaf0",
  "#ffcb55",
  "#8fd8c8",
  "#f6a97a",
  "#c9d3da",
  "#f3e27a",
  "#a8d4f0",
] as const;
const CABIN_COLORS = [
  "#ff8f7a",
  "#ffd166",
  "#7fd1ae",
  "#82c4f2",
  "#c7a6ee",
  "#ffb26b",
  "#9fe08a",
  "#f59fc1",
] as const;
const TREE_GREENS = ["#5fa84b", "#73b84f", "#4f9a4d", "#86c45a"] as const;
const WINDOW_COLOR = "#35546a";
const WATER_COLOR = "#68cbe2";
const GOLD = "#f4c24f";
const growthEase = gsap.parseEase("back.out(2.2)");

// One building per plot and level, in plot-local units: x along play, z
// toward the board center, y up from the lawn. Owner parts take the owner's
// color; facades take a light tint of the city's country.
type Part = {
  readonly shape: "plinth" | "wall" | "gable" | "crown" | "spire" | "pole";
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly paint: "owner" | "facade" | "gold" | "water" | "pole";
};

function part(
  shape: Part["shape"],
  paint: Part["paint"],
  [x, y, z]: readonly [number, number, number],
  [width, height, depth]: readonly [number, number, number],
): Part {
  return { shape, paint, x, y, z, width, height, depth };
}

const PLINTH = part("plinth", "owner", [0, 0, 0], [0.34, 0.03, 0.38]);
const CITY_LEVELS: readonly (readonly Part[])[] = [
  // Land: a staked plot with a flag.
  [
    PLINTH,
    part("pole", "pole", [-0.12, 0.03, 0.12], [0.014, 0.24, 0.014]),
    part("crown", "owner", [-0.065, 0.2, 0.12], [0.1, 0.065, 0.01]),
  ],
  // One house.
  [
    PLINTH,
    part("wall", "facade", [0, 0.03, 0], [0.22, 0.15, 0.22]),
    part("gable", "owner", [0, 0.18, 0], [0.26, 0.1, 0.26]),
  ],
  // A town house.
  [
    PLINTH,
    part("wall", "facade", [0, 0.03, 0], [0.27, 0.25, 0.28]),
    part("gable", "owner", [0, 0.28, 0], [0.31, 0.11, 0.32]),
  ],
  // An apartment block with a flat roof.
  [
    PLINTH,
    part("wall", "facade", [0, 0.03, 0], [0.3, 0.36, 0.32]),
    part("crown", "owner", [0, 0.39, 0], [0.32, 0.04, 0.34]),
  ],
  // A hotel tower on its podium.
  [
    PLINTH,
    part("wall", "facade", [0, 0.03, 0], [0.32, 0.1, 0.34]),
    part("wall", "facade", [0, 0.13, 0], [0.24, 0.4, 0.26]),
    part("crown", "owner", [0, 0.53, 0], [0.27, 0.045, 0.29]),
  ],
  // A landmark tower with a golden spire.
  [
    PLINTH,
    part("wall", "facade", [0, 0.03, 0], [0.32, 0.08, 0.34]),
    part("wall", "facade", [0, 0.11, 0], [0.22, 0.42, 0.22]),
    part("crown", "owner", [0, 0.53, 0], [0.26, 0.035, 0.26]),
    part("spire", "gold", [0, 0.565, 0], [0.05, 0.115, 0.05]),
  ],
];
const RESORT: readonly Part[] = [
  PLINTH,
  part("crown", "water", [0.02, 0.03, 0.02], [0.24, 0.018, 0.26]),
  part("pole", "pole", [-0.11, 0.03, -0.12], [0.012, 0.19, 0.012]),
  part("spire", "owner", [-0.11, 0.2, -0.12], [0.11, 0.045, 0.11]),
];

const SHAPES = ["plinth", "wall", "gable", "crown", "spire", "pole"] as const;
const CAPACITY = {
  plinth: 24,
  wall: 48,
  gable: 24,
  crown: 24,
  spire: 24,
  pole: 24,
};
const WINDOWS = 640;
const TREES = 96;

function owned(view: PublicState | null, plot: TownPlot, preview: boolean) {
  const property = view ? getProperty(view, plot.tile) : null;
  if (property?.owner != null)
    return { level: property.level, color: PLAYER_COLORS[property.owner] };
  // The lobby echoes the preview lots: a busy town in the board's colors.
  if (preview && BOARD[plot.tile].kind === "city")
    return { level: 1 + (plot.tile % 5), color: tileColor(plot.tile) };
  return null;
}

function TownBuildings({
  state,
  preview,
  handle,
}: {
  state: PublicState | null;
  preview: boolean;
  handle: { current: DowntownHandle | null };
}) {
  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const windows = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const crane = useRef<THREE.Group>(null);
  const jib = useRef<THREE.Group>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const gableGeometry = useMemo(() => {
    const triangle = new THREE.Shape();
    triangle.moveTo(-0.5, 0);
    triangle.lineTo(0.5, 0);
    triangle.lineTo(0, 1);
    triangle.closePath();
    const geometry = new THREE.ExtrudeGeometry(triangle, {
      depth: 1,
      bevelEnabled: false,
    });
    geometry.translate(0, 0, -0.5);
    return geometry;
  }, []);
  const spireGeometry = useMemo(() => {
    const geometry = new THREE.ConeGeometry(0.5, 1, 8);
    geometry.translate(0, 0.5, 0);
    return geometry;
  }, []);
  const facades = useMemo(
    () =>
      new Map(
        TOWN_PLOTS.map((plot) => [
          plot.tile,
          mix(tileColor(plot.tile), "#fffaf0", 0.78),
        ]),
      ),
    [],
  );
  const draw = useCallback(
    (view: PublicState | null, growth: TownGrowth | null) => {
      const instanced = meshes.current;
      const glass = windows.current;
      const trunk = trunks.current;
      const crown = crowns.current;
      if (!glass || !trunk || !crown) return;
      const counts: Record<string, number> = {};
      for (const shape of SHAPES) counts[shape] = 0;
      let windowCount = 0;
      let treeCount = 0;
      const plantTree = (tree: TownTree, index: number) => {
        const radius = Math.min(0.11, tree.height * 0.36);
        const [x, z] = tree.position;
        dummy.rotation.set(0, index, 0);
        dummy.position.set(x, LAWN_TOP + (tree.height - radius * 1.5) / 2, z);
        dummy.scale.set(0.028, tree.height - radius * 1.5, 0.028);
        dummy.updateMatrix();
        trunk.setMatrixAt(treeCount, dummy.matrix);
        dummy.position.set(x, LAWN_TOP + tree.height - radius * 1.15, z);
        dummy.scale.set(radius, radius * 1.15, radius);
        dummy.updateMatrix();
        crown.setMatrixAt(treeCount, dummy.matrix);
        crown.setColorAt(
          treeCount,
          color.set(TREE_GREENS[index % TREE_GREENS.length]),
        );
        treeCount += 1;
      };
      for (const [index, tree] of TOWN_TREES.entries()) plantTree(tree, index);
      let craneAt: TownPlot | null = null;
      for (const plot of TOWN_PLOTS) {
        const building = owned(view, plot, preview);
        if (!building) {
          plantTree(plotTree(plot), plot.tile);
          continue;
        }
        const growing = growth?.tile === plot.tile ? growth.progress : null;
        let rise = 1;
        let spread = 1;
        if (growing !== null) {
          // The town answers just after the lot: a short delay, then the
          // building pops out of its plot with the lot's own overshoot.
          const progress = THREE.MathUtils.clamp((growing - 0.12) / 0.7, 0, 1);
          rise = Math.max(0.02, growthEase(progress));
          spread = 0.75 + 0.25 * Math.min(1, progress * 1.6);
          if (BOARD[plot.tile].kind === "city") craneAt = plot;
        }
        const parts =
          BOARD[plot.tile].kind === "resort"
            ? RESORT
            : CITY_LEVELS[building.level];
        const [faceX, faceZ] = visibleFaces(plot.tile);
        const [px, pz] = plot.position;
        const cos = Math.cos(plot.rotation);
        const sin = Math.sin(plot.rotation);
        for (const piece of parts) {
          const mesh = instanced[piece.shape];
          if (!mesh) continue;
          const plinth = piece.shape === "plinth";
          const height = piece.height * (plinth ? 1 : rise);
          const width = piece.width * (plinth ? 1 : spread);
          const depth = piece.depth * (plinth ? 1 : spread);
          const base = LAWN_TOP + piece.y * (plinth ? 1 : rise);
          const x = px + piece.x * cos + piece.z * sin;
          const z = pz - piece.x * sin + piece.z * cos;
          dummy.rotation.set(0, plot.rotation, 0);
          const centered = piece.shape === "plinth" || piece.shape === "wall";
          dummy.position.set(
            x,
            centered || piece.shape === "pole" || piece.shape === "crown"
              ? base + height / 2
              : base,
            z,
          );
          dummy.scale.set(width, height, depth);
          dummy.updateMatrix();
          const slot = counts[piece.shape]++;
          mesh.setMatrixAt(slot, dummy.matrix);
          mesh.setColorAt(
            slot,
            color.set(
              piece.paint === "owner"
                ? building.color
                : piece.paint === "facade"
                  ? (facades.get(plot.tile) ?? "#fffaf0")
                  : piece.paint === "gold"
                    ? GOLD
                    : piece.paint === "water"
                      ? WATER_COLOR
                      : "#e7e3dc",
            ),
          );
          if (piece.shape !== "wall" || piece.height < 0.09) continue;
          // Windows on the two faces the camera sees, a row per storey.
          const rows = Math.max(1, Math.round(piece.height / 0.1));
          const pane = Math.min(0.05, (height / rows) * 0.45);
          for (let row = 0; row < rows; row++) {
            const y = base + (height * (row + 0.55)) / rows;
            for (const column of [-1, 1]) {
              const lx = piece.x + column * width * 0.24;
              const lz = piece.z + faceZ * (depth / 2 + 0.004);
              dummy.position.set(
                px + lx * cos + lz * sin,
                y,
                pz - lx * sin + lz * cos,
              );
              dummy.scale.set(width * 0.2, pane, 0.01);
              dummy.updateMatrix();
              if (windowCount < WINDOWS)
                glass.setMatrixAt(windowCount++, dummy.matrix);
              const sx = piece.x + faceX * (width / 2 + 0.004);
              const sz = piece.z + column * depth * 0.24;
              dummy.position.set(
                px + sx * cos + sz * sin,
                y,
                pz - sx * sin + sz * cos,
              );
              dummy.scale.set(0.01, pane, depth * 0.2);
              dummy.updateMatrix();
              if (windowCount < WINDOWS)
                glass.setMatrixAt(windowCount++, dummy.matrix);
            }
          }
        }
      }
      for (const shape of SHAPES) {
        const mesh = instanced[shape];
        if (!mesh) continue;
        mesh.count = counts[shape];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      glass.count = windowCount;
      trunk.count = crown.count = treeCount;
      for (const mesh of [glass, trunk, crown]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      // A crane works beside a city while it is being built, on the side of
      // the plot that faces the camera so it never stands behind the town.
      const rig = crane.current;
      if (rig) {
        rig.visible = craneAt !== null && growth !== null;
        if (craneAt && growth) {
          const [faceX, faceZ] = visibleFaces(craneAt.tile);
          const lx = -faceX * 0.13;
          const lz = faceZ * (PLOT_DEPTH / 2 + 0.07);
          const cos = Math.cos(craneAt.rotation);
          const sin = Math.sin(craneAt.rotation);
          rig.position.set(
            craneAt.position[0] + lx * cos + lz * sin,
            LAWN_TOP,
            craneAt.position[1] - lx * sin + lz * cos,
          );
          rig.scale.set(1, Math.min(1, growth.progress * 5), 1);
          if (jib.current)
            jib.current.rotation.y =
              craneAt.rotation + Math.PI / 2 + growth.progress * Math.PI * 0.8;
        }
      }
    },
    [preview, dummy, color, facades],
  );
  useEffect(() => {
    handle.current = { draw };
    return () => {
      handle.current = null;
    };
  }, [handle, draw]);
  useEffect(() => draw(state, null), [state, draw]);
  useEffect(
    () => () => {
      gableGeometry.dispose();
      spireGeometry.dispose();
    },
    [gableGeometry, spireGeometry],
  );
  const register = (shape: string) => (mesh: THREE.InstancedMesh | null) => {
    meshes.current[shape] = mesh;
  };
  return (
    <>
      {SHAPES.map((shape) => (
        <instancedMesh
          key={shape}
          ref={register(shape)}
          args={[
            shape === "gable"
              ? gableGeometry
              : shape === "spire"
                ? spireGeometry
                : undefined,
            undefined,
            CAPACITY[shape],
          ]}
          castShadow={shape !== "plinth"}
          receiveShadow
        >
          {shape === "gable" || shape === "spire" ? null : <boxGeometry />}
          <meshStandardMaterial
            roughness={shape === "spire" ? 0.35 : 0.85}
            metalness={shape === "spire" ? 0.25 : 0}
          />
        </instancedMesh>
      ))}
      <instancedMesh ref={windows} args={[undefined, undefined, WINDOWS]}>
        <boxGeometry />
        <meshBasicMaterial color={WINDOW_COLOR} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, TREES]}>
        <cylinderGeometry args={[0.5, 0.7, 1, 5]} />
        <meshStandardMaterial color="#9a6a3e" roughness={1} />
      </instancedMesh>
      <instancedMesh
        ref={crowns}
        args={[undefined, undefined, TREES]}
        castShadow
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={0.95} flatShading />
      </instancedMesh>
      <group ref={crane} visible={false}>
        <mesh position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[0.035, 0.84, 0.035]} />
          <meshStandardMaterial color="#f2b632" />
        </mesh>
        <group ref={jib} position={[0, 0.84, 0]}>
          <mesh position={[0.17, 0, 0]} castShadow>
            <boxGeometry args={[0.46, 0.028, 0.028]} />
            <meshStandardMaterial color="#f2b632" />
          </mesh>
          <mesh position={[-0.09, -0.02, 0]}>
            <boxGeometry args={[0.07, 0.05, 0.05]} />
            <meshStandardMaterial color="#5c6b74" />
          </mesh>
          <mesh position={[0.3, -0.16, 0]}>
            <boxGeometry args={[0.006, 0.3, 0.006]} />
            <meshBasicMaterial color="#3f4b52" />
          </mesh>
        </group>
      </group>
    </>
  );
}

/** Pre-computed circuit as a flat array for allocation-free lookups. */
function circuitBuffer() {
  const points = townCircuit();
  const buffer = new Float32Array(points.length * 2);
  for (const [index, [x, z]] of points.entries()) {
    buffer[index * 2] = x;
    buffer[index * 2 + 1] = z;
  }
  return buffer;
}

function AmbientLife({ animated }: { animated: boolean }) {
  const { invalidate } = useThree();
  const circuit = useMemo(circuitBuffer, []);
  const bodies = useRef<THREE.InstancedMesh>(null);
  const cabins = useRef<THREE.InstancedMesh>(null);
  const wheel = useRef<THREE.Group>(null);
  const gondolas = useRef<THREE.InstancedMesh>(null);
  const carousel = useRef<THREE.Group>(null);
  const horses = useRef<THREE.InstancedMesh>(null);
  const boat = useRef<THREE.Group>(null);
  const helicopter = useRef<THREE.Group>(null);
  const rotor = useRef<THREE.Group>(null);
  const jets = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const hub = FERRIS_WHEEL.height - FERRIS_WHEEL_RADIUS - 0.06;

  useEffect(() => {
    const body = bodies.current;
    const gondola = gondolas.current;
    const color = new THREE.Color();
    if (body)
      for (let car = 0; car < CAR_COLORS.length; car++)
        body.setColorAt(car, color.set(CAR_COLORS[car]));
    if (gondola)
      for (let cabin = 0; cabin < CABIN_COLORS.length; cabin++)
        gondola.setColorAt(cabin, color.set(CABIN_COLORS[cabin]));
    for (const mesh of [body, gondola])
      if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useEffect(() => {
    if (!animated) {
      invalidate();
      return;
    }
    const timer = window.setInterval(() => invalidate(), AMBIENT_FRAME_MS);
    return () => window.clearInterval(timer);
  }, [animated, invalidate]);

  useFrame(({ clock }) => {
    // Reduced motion freezes the town at a tidy moment.
    const time = animated ? clock.elapsedTime : 0;
    const body = bodies.current;
    const cabin = cabins.current;
    if (body && cabin) {
      const samples = circuit.length / 2;
      for (let car = 0; car < CAR_COLORS.length; car++) {
        const travel =
          (time * CAR_SPEED) / 0.02 + (car * samples) / CAR_COLORS.length;
        const index = Math.floor(travel) % samples;
        const fraction = travel - Math.floor(travel);
        const next = (index + 1) % samples;
        const ahead = (index + 5) % samples;
        const behind = (index - 5 + samples) % samples;
        const x =
          circuit[index * 2] +
          (circuit[next * 2] - circuit[index * 2]) * fraction;
        const z =
          circuit[index * 2 + 1] +
          (circuit[next * 2 + 1] - circuit[index * 2 + 1]) * fraction;
        const heading = Math.atan2(
          -(circuit[ahead * 2 + 1] - circuit[behind * 2 + 1]),
          circuit[ahead * 2] - circuit[behind * 2],
        );
        dummy.rotation.set(0, heading, 0);
        dummy.position.set(x, LAWN_TOP + 0.035, z);
        dummy.scale.set(0.17, 0.05, 0.085);
        dummy.updateMatrix();
        body.setMatrixAt(car, dummy.matrix);
        dummy.position.set(
          x - Math.cos(heading) * 0.015,
          LAWN_TOP + 0.077,
          z + Math.sin(heading) * 0.015,
        );
        dummy.scale.set(0.09, 0.04, 0.075);
        dummy.updateMatrix();
        cabin.setMatrixAt(car, dummy.matrix);
      }
      body.instanceMatrix.needsUpdate = true;
      cabin.instanceMatrix.needsUpdate = true;
    }
    // One turn of the big wheel every 40 s; its gondolas hang upright.
    const turn = (time / 40) * Math.PI * 2;
    if (wheel.current) wheel.current.rotation.z = turn;
    const gondola = gondolas.current;
    if (gondola) {
      for (let seat = 0; seat < CABIN_COLORS.length; seat++) {
        const angle = turn + (seat * Math.PI * 2) / CABIN_COLORS.length;
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(
          Math.cos(angle) * FERRIS_WHEEL_RADIUS,
          hub + Math.sin(angle) * FERRIS_WHEEL_RADIUS - 0.035,
          0,
        );
        dummy.scale.set(0.07, 0.06, 0.06);
        dummy.updateMatrix();
        gondola.setMatrixAt(seat, dummy.matrix);
      }
      gondola.instanceMatrix.needsUpdate = true;
    }
    if (carousel.current) carousel.current.rotation.y = -time * 0.8;
    const horse = horses.current;
    if (horse) {
      for (let index = 0; index < 6; index++) {
        const angle = (index * Math.PI) / 3;
        dummy.rotation.set(0, -angle, 0);
        dummy.position.set(
          Math.cos(angle) * 0.14,
          0.15 + Math.sin(time * 3 + index * 2) * 0.03,
          Math.sin(angle) * 0.14,
        );
        dummy.scale.set(0.025, 0.05, 0.075);
        dummy.updateMatrix();
        horse.setMatrixAt(index, dummy.matrix);
      }
      horse.instanceMatrix.needsUpdate = true;
    }
    if (boat.current) {
      const sail = time * 0.25;
      boat.current.position.set(
        POND.position[0] + Math.cos(sail) * 0.13,
        LAWN_TOP + 0.012 + Math.sin(time * 2.1) * 0.006,
        POND.position[1] + Math.sin(sail) * 0.13,
      );
      boat.current.rotation.set(
        Math.sin(time * 1.7) * 0.06,
        -sail - Math.PI / 2,
        0,
      );
    }
    // The helicopter idles on its pad, then lifts off for a short hop.
    if (helicopter.current) {
      const cycle = time % 18;
      const flight = cycle > 12 ? Math.sin(((cycle - 12) / 6) * Math.PI) : 0;
      helicopter.current.position.y = LAWN_TOP + 0.02 + flight * 0.32;
      helicopter.current.rotation.y = -Math.PI / 4 + flight * 0.9;
    }
    if (rotor.current) rotor.current.rotation.y = time * 18;
    const jet = jets.current;
    if (jet) {
      for (const [index, fountain] of FOUNTAINS.entries()) {
        const pulse = 0.75 + Math.sin(time * 2.6 + index * 1.7) * 0.25;
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(
          fountain.position[0],
          LAWN_TOP + 0.03 + 0.08 * pulse,
          fountain.position[1],
        );
        dummy.scale.set(1, pulse, 1);
        dummy.updateMatrix();
        jet.setMatrixAt(index, dummy.matrix);
      }
      jet.instanceMatrix.needsUpdate = true;
    }
  });

  const spokes = useMemo(() => {
    const transforms: THREE.Matrix4[] = [];
    const object = new THREE.Object3D();
    for (let spoke = 0; spoke < 8; spoke++) {
      const angle = (spoke * Math.PI) / 4;
      object.position.set(
        (Math.cos(angle) * FERRIS_WHEEL_RADIUS) / 2,
        (Math.sin(angle) * FERRIS_WHEEL_RADIUS) / 2,
        0,
      );
      object.rotation.set(0, 0, angle);
      object.scale.set(FERRIS_WHEEL_RADIUS, 0.012, 0.012);
      object.updateMatrix();
      transforms.push(object.matrix.clone());
    }
    return transforms;
  }, []);
  const spokeMesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = spokeMesh.current;
    if (!mesh) return;
    for (const [index, matrix] of spokes.entries())
      mesh.setMatrixAt(index, matrix);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [spokes]);
  const legSpread = 0.17;
  const legLength = Math.hypot(legSpread, hub);
  const legTilt = Math.atan2(legSpread, hub);
  const fountainBasins = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const basins = fountainBasins.current;
    if (!basins) return;
    const object = new THREE.Object3D();
    for (const [index, fountain] of FOUNTAINS.entries()) {
      object.position.set(
        fountain.position[0],
        LAWN_TOP + 0.015,
        fountain.position[1],
      );
      object.updateMatrix();
      basins.setMatrixAt(index, object.matrix);
    }
    basins.instanceMatrix.needsUpdate = true;
    basins.computeBoundingSphere();
  }, []);

  return (
    <>
      <instancedMesh
        ref={bodies}
        args={[undefined, undefined, CAR_COLORS.length]}
        frustumCulled={false}
        castShadow
      >
        <boxGeometry />
        <meshStandardMaterial roughness={0.45} />
      </instancedMesh>
      <instancedMesh
        ref={cabins}
        args={[undefined, undefined, CAR_COLORS.length]}
        frustumCulled={false}
      >
        <boxGeometry />
        <meshStandardMaterial color="#3d6277" roughness={0.3} />
      </instancedMesh>
      {/* The big wheel turns square to the camera. */}
      <group
        position={[
          FERRIS_WHEEL.position[0],
          LAWN_TOP,
          FERRIS_WHEEL.position[1],
        ]}
        rotation={[0, Math.PI / 4, 0]}
      >
        {[-1, 1].map((front) =>
          [-1, 1].map((side) => (
            <mesh
              key={`${front}${side}`}
              position={[(side * legSpread) / 2, hub / 2, front * 0.045]}
              rotation={[0, 0, side * legTilt]}
              castShadow
            >
              <boxGeometry args={[0.022, legLength, 0.022]} />
              <meshStandardMaterial color="#fffaf0" />
            </mesh>
          )),
        )}
        <group ref={wheel} position={[0, hub, 0]}>
          <mesh castShadow>
            <torusGeometry args={[FERRIS_WHEEL_RADIUS, 0.013, 6, 40]} />
            <meshStandardMaterial color="#e2574a" />
          </mesh>
          <mesh>
            <torusGeometry args={[FERRIS_WHEEL_RADIUS * 0.55, 0.008, 5, 28]} />
            <meshStandardMaterial color="#fffaf0" />
          </mesh>
          <instancedMesh ref={spokeMesh} args={[undefined, undefined, 8]}>
            <boxGeometry />
            <meshStandardMaterial color="#fffaf0" />
          </instancedMesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.11, 10]} />
            <meshStandardMaterial color={GOLD} />
          </mesh>
        </group>
        <instancedMesh
          ref={gondolas}
          args={[undefined, undefined, CABIN_COLORS.length]}
          frustumCulled={false}
          castShadow
        >
          <boxGeometry />
          <meshStandardMaterial roughness={0.6} />
        </instancedMesh>
      </group>
      {/* A carousel with bobbing horses under a striped canopy. */}
      <group
        ref={carousel}
        position={[CAROUSEL.position[0], LAWN_TOP, CAROUSEL.position[1]]}
      >
        <mesh position={[0, 0.02, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[0.2, 0.21, 0.04, 20]} />
          <meshStandardMaterial color="#fffaf0" />
        </mesh>
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.32, 8]} />
          <meshStandardMaterial color={GOLD} />
        </mesh>
        <mesh position={[0, 0.37, 0]} castShadow>
          <coneGeometry args={[0.22, 0.1, 12]} />
          <meshStandardMaterial color="#e2574a" flatShading />
        </mesh>
        <mesh position={[0, 0.31, 0]}>
          <cylinderGeometry args={[0.215, 0.215, 0.025, 12, 1, true]} />
          <meshStandardMaterial color="#fffaf0" side={THREE.DoubleSide} />
        </mesh>
        <instancedMesh
          ref={horses}
          args={[undefined, undefined, 6]}
          frustumCulled={false}
          castShadow
        >
          <boxGeometry />
          <meshStandardMaterial color="#fff2d6" />
        </instancedMesh>
      </group>
      {/* A little sailing boat on the pond. */}
      <group ref={boat}>
        <mesh position={[0, 0.015, 0]} scale={[0.05, 0.03, 0.11]} castShadow>
          <boxGeometry />
          <meshStandardMaterial color="#fffaf0" />
        </mesh>
        <mesh position={[0, 0.09, 0.005]} rotation={[0, Math.PI / 2, 0]}>
          <coneGeometry args={[0.045, 0.13, 3]} />
          <meshStandardMaterial color="#ffcb55" flatShading />
        </mesh>
      </group>
      {/* A helicopter on its pad near the world tour. */}
      <group
        ref={helicopter}
        position={[HELIPAD.position[0], LAWN_TOP, HELIPAD.position[1]]}
      >
        <mesh position={[0, 0.07, 0]} scale={[0.1, 0.065, 0.065]} castShadow>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#ffcb55" roughness={0.4} />
        </mesh>
        <mesh position={[-0.13, 0.08, 0]} castShadow>
          <boxGeometry args={[0.16, 0.025, 0.025]} />
          <meshStandardMaterial color="#ffcb55" />
        </mesh>
        <mesh position={[0.05, 0.085, 0]} scale={[0.04, 0.035, 0.05]}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial color="#3d6277" roughness={0.25} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, 0.008, side * 0.045]}>
            <boxGeometry args={[0.17, 0.012, 0.012]} />
            <meshStandardMaterial color="#5c6b74" />
          </mesh>
        ))}
        <group ref={rotor} position={[0, 0.145, 0]}>
          {[0, Math.PI / 2].map((angle) => (
            <mesh key={angle} rotation={[0, angle, 0]}>
              <boxGeometry args={[0.32, 0.006, 0.022]} />
              <meshStandardMaterial color="#3f4b52" />
            </mesh>
          ))}
        </group>
      </group>
      <instancedMesh
        ref={fountainBasins}
        args={[undefined, undefined, FOUNTAINS.length]}
        receiveShadow
      >
        <cylinderGeometry args={[0.075, 0.08, 0.03, 14]} />
        <meshStandardMaterial color="#efe7d6" />
      </instancedMesh>
      <instancedMesh
        ref={jets}
        args={[undefined, undefined, FOUNTAINS.length]}
        frustumCulled={false}
      >
        <coneGeometry args={[0.035, 0.16, 8]} />
        <meshStandardMaterial
          color="#bfeefa"
          transparent
          opacity={0.85}
          roughness={0.2}
        />
      </instancedMesh>
    </>
  );
}

export function Downtown({
  state,
  preview = false,
  handle,
}: {
  state: PublicState | null;
  preview?: boolean;
  handle: { current: DowntownHandle | null };
}) {
  const { reducedMotion } = useDirector();
  return (
    <group>
      <TownBuildings state={state} preview={preview} handle={handle} />
      <AmbientLife animated={!reducedMotion} />
    </group>
  );
}
