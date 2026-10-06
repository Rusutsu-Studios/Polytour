import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type BoardRule, getBoard } from "../../shared/board/index.js";
import {
  getProperty,
  type PublicState,
  type Seat,
} from "../../shared/engine/index.js";
import { useLocale } from "../i18n.js";
import { PLAYER_COLORS, tileName } from "../ui/board-display.js";
import { LOT_TOP, tileCenter, tilePoint, type Vec3 } from "./board-layout.js";
import { canvasTexture, labelTexture, mix } from "./board-textures.js";

// Small original landmarks on the island, championship and world-tour corners;
// Start is printed flat so nothing tall stands in front of the board. Each
// keeps to the outer half of its square: the inner quarter belongs to pawns.
//
// The stadium and the airport are built for the fixed camera: their own +x
// runs to the right of the screen and +z toward the viewer. Static parts are
// baked into a few vertex-coloured meshes, so each landmark costs a handful
// of draw calls, and they only move while the board's ambient life plays.

export function Palm({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.34, 0]} rotation={[0, 0, -0.13]} castShadow>
        <cylinderGeometry args={[0.04, 0.055, 0.7, 6]} />
        <meshStandardMaterial color="#b88148" />
      </mesh>
      {[0, 1, 2, 3, 4].map((leaf) => (
        <mesh
          key={leaf}
          position={[
            Math.cos(leaf * 1.257) * 0.13 - 0.05,
            0.7,
            Math.sin(leaf * 1.257) * 0.13,
          ]}
          rotation={[0.3, leaf * 1.257, 0.45]}
          scale={[0.7, 0.2, 1.7]}
          castShadow
        >
          <sphereGeometry args={[0.2, 5, 4]} />
          <meshStandardMaterial color={leaf % 2 ? "#4f9a4d" : "#78b84a"} />
        </mesh>
      ))}
    </group>
  );
}

export function BeachUmbrella({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.4, 5]} />
        <meshStandardMaterial color="#fffaf0" />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <coneGeometry args={[0.24, 0.1, 8]} />
        <meshStandardMaterial color="#ef6a55" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Ground point on a corner, in the corner's own frame (x along play, z inward). */
function at(
  corner: number,
  x: number,
  z: number,
  y = LOT_TOP,
): [number, number, number] {
  const [worldX, worldZ] = tilePoint(corner, x, z);
  return [worldX, y, worldZ];
}

function Island() {
  return (
    <group>
      <Palm position={at(8, -0.45, -0.4)} scale={0.95} />
      <Palm position={at(8, -0.12, -0.55)} scale={0.72} />
      <BeachUmbrella position={at(8, -0.55, -0.02)} scale={0.9} />
    </group>
  );
}

/** Y rotation that turns a landmark's +x to the right of the screen. */
const SCREEN_YAW = Math.PI / 4;

/** World point of a landmark-local point, for an anchor on a corner. */
function landmarkPoint(
  anchor: readonly [number, number, number],
  x: number,
  y: number,
  z: number,
): Vec3 {
  const cos = Math.cos(SCREEN_YAW);
  const sin = Math.sin(SCREEN_YAW);
  return [
    anchor[0] + x * cos + z * sin,
    anchor[1] + y,
    anchor[2] - x * sin + z * cos,
  ];
}

const GOLD = "#ffc83d";
const IVORY = "#fbf6ec";
const CORAL = "#e2574a";
const GLASS = "#56b4d8";

type Part = {
  geometry: THREE.BufferGeometry;
  /** Omitted when the geometry already carries its own colours. */
  color?: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  /** Replaces position, rotation and scale. */
  matrix?: THREE.Matrix4;
};

const composer = new THREE.Object3D();
const tint = new THREE.Color();

/**
 * Bakes static parts into one vertex-coloured geometry, so a whole landmark
 * body costs one draw call and one shadow pass.
 */
function bake(parts: readonly Part[], keep: readonly string[] = []) {
  const baked = parts.map(
    ({ geometry, color, position, rotation, scale, matrix }) => {
      const part = geometry.index ? geometry.toNonIndexed() : geometry;
      if (part !== geometry) geometry.dispose();
      for (const name of Object.keys(part.attributes))
        if (
          name !== "position" &&
          name !== "normal" &&
          name !== "color" &&
          !keep.includes(name)
        )
          part.deleteAttribute(name);
      if (matrix) part.applyMatrix4(matrix);
      else {
        composer.position.set(...(position ?? [0, 0, 0]));
        const [x, y, z] = rotation ?? [0, 0, 0];
        composer.rotation.set(x, y, z, "XYZ");
        composer.scale.set(...(scale ?? [1, 1, 1]));
        composer.updateMatrix();
        part.applyMatrix4(composer.matrix);
      }
      if (color) {
        tint.set(color);
        const count = part.getAttribute("position").count;
        const colors = new Float32Array(count * 3);
        for (let vertex = 0; vertex < count; vertex++)
          tint.toArray(colors, vertex * 3);
        part.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
      return part;
    },
  );
  const merged = mergeGeometries(baked);
  for (const part of baked) part.dispose();
  if (!merged) throw new Error("Landmark parts could not be baked together.");
  return merged;
}

/** A flat outline, extruded downward from y = 0 by `depth`. */
function slab(points: readonly (readonly [number, number])[], depth: number) {
  const shape = new THREE.Shape(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
  );
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
  }).rotateX(Math.PI / 2);
}

/** A vertical outline in the x/y plane, `depth` thick and centred on z = 0. */
function plate(points: readonly (readonly [number, number])[], depth: number) {
  const shape = new THREE.Shape(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
  );
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
  }).translate(0, 0, -depth / 2);
}

/** A ring sector between two radii and angles, lying flat (angle 0 is +x). */
function arcSlab(
  inner: number,
  outer: number,
  from: number,
  to: number,
  depth: number,
) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, from, to, false);
  shape.absarc(0, 0, inner, to, from, true);
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 32,
  }).rotateX(Math.PI / 2);
}

/**
 * A painted gold matcap for the trophy: shiny metal without an environment
 * map, so nothing is prefiltered on the GPU when the board appears.
 */
function goldMatcap() {
  return canvasTexture(256, 256, (context) => {
    const body = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    body.addColorStop(0, "#fff0b8");
    body.addColorStop(0.45, "#ffc83d");
    body.addColorStop(0.8, "#c9850f");
    body.addColorStop(1, "#7a4506");
    context.fillStyle = body;
    context.fillRect(0, 0, 256, 256);
    const glint = (x: number, y: number, radius: number, alpha: number) => {
      const light = context.createRadialGradient(x, y, 0, x, y, radius);
      light.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      light.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = light;
      context.fillRect(0, 0, 256, 256);
    };
    glint(92, 78, 64, 0.95);
    glint(178, 196, 54, 0.45);
  });
}

/**
 * A neutral glossy matcap for glass: a bright sky above, a darker ground below
 * and one diagonal glint. Vertex colours tint it, so one map serves every pane.
 */
function glassMatcap() {
  return canvasTexture(256, 256, (context) => {
    const sky = context.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, "#ffffff");
    sky.addColorStop(0.45, "#e4eef1");
    sky.addColorStop(0.62, "#a9bcc3");
    sky.addColorStop(1, "#6f858d");
    context.fillStyle = sky;
    context.fillRect(0, 0, 256, 256);
    context.save();
    context.translate(128, 128);
    context.rotate(-0.6);
    const glint = context.createLinearGradient(0, -34, 0, 34);
    glint.addColorStop(0, "rgba(255, 255, 255, 0)");
    glint.addColorStop(0.5, "rgba(255, 255, 255, 0.85)");
    glint.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = glint;
    context.fillRect(-160, -34, 320, 68);
    context.restore();
  });
}

function useDisposable<T extends { dispose: () => void }>(make: () => T) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: built once per mount.
  const value = useMemo(make, []);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

/** A little deterministic noise, so painted crowds look the same every time. */
function noise(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

// ── Championship: a grand stadium ─────────────────────────────────────────

const STADIUM = {
  corner: 16,
  /** Corner-local center, on the outer diagonal, clear of the pawns. */
  x: -0.2,
  z: -0.2,
  /** The round bowl is squashed in depth, so it reads as an oval. */
  squash: 0.74,
  ground: 0.035,
  rim: 0.305,
  /** The main stand's canopy covers the back half and rises toward the back. */
  roof: { y: 0.335, inner: 0.44, outer: 0.655, tilt: 0.2, depth: 0.022 },
  roofArc: [Math.PI + 0.12, Math.PI * 2 - 0.12] as const,
  mast: { radius: 0.64, height: 0.62, angle: 1.0 },
  pitch: { y: 0.039, width: 0.44, depth: 0.26 },
  trophy: { y: 0.112, scale: 1.75, height: 0.226 },
  flags: [
    Math.PI + 0.42,
    Math.PI + 0.92,
    Math.PI * 2 - 0.92,
    Math.PI * 2 - 0.42,
  ],
  flagPole: 0.075,
} as const;

const STADIUM_ANCHOR = at(STADIUM.corner, STADIUM.x, STADIUM.z);

/** Underside of the tilted canopy above a round-space point (before squash). */
function roofUnderside(z: number) {
  return STADIUM.roof.y - z * Math.sin(STADIUM.roof.tilt);
}

/** Stadium-local floodlight heads: on the two front shoulders of the bowl. */
function floodlightHeads() {
  const { radius, height, angle } = STADIUM.mast;
  return [Math.PI / 2 - angle, Math.PI / 2 + angle].map((theta) => {
    const position = new THREE.Vector3(
      Math.cos(theta) * radius,
      STADIUM.ground + height + 0.03,
      Math.sin(theta) * radius * STADIUM.squash,
    );
    composer.position.copy(position);
    composer.rotation.set(0, 0, 0);
    composer.scale.set(1, 1, 1);
    composer.lookAt(0, STADIUM.pitch.y, 0);
    composer.updateMatrix();
    return { position, matrix: composer.matrix.clone() };
  });
}

/** Stadium-local tops of the flag poles standing on the canopy's rim. */
function flagTops() {
  const { tilt, depth } = STADIUM.roof;
  return STADIUM.flags.map((theta) => {
    const radius = STADIUM.roof.outer - 0.02;
    const z = Math.sin(theta) * radius;
    return new THREE.Vector3(
      Math.cos(theta) * radius,
      roofUnderside(z) + depth + STADIUM.flagPole,
      z * Math.cos(tilt) * STADIUM.squash,
    );
  });
}

function standsTexture() {
  const width = 1024;
  const third = 64;
  const random = noise(11);
  return canvasTexture(width, third * 3, (context) => {
    const crowd = (top: number, colors: readonly string[], count: number) => {
      for (let fan = 0; fan < count; fan++) {
        context.fillStyle = colors[Math.floor(random() * colors.length)];
        context.fillRect(
          Math.floor(random() * width),
          top + 4 + Math.floor(random() * (third - 10)),
          3,
          3,
        );
      }
    };
    const rows = (top: number, color: string) => {
      context.fillStyle = color;
      for (let row = 1; row < 6; row++)
        context.fillRect(0, top + (row * third) / 6, width, 2);
    };
    // The canvas top is the top of the bowl: the upper tier.
    context.fillStyle = "#5fb3d0";
    context.fillRect(0, 0, width, third);
    rows(0, "#3f8fae");
    crowd(0, ["#fffaf0", "#ffd166", "#f6a97a", "#d6f0f7"], 900);
    // The concourse, with its ring of advertising boards.
    context.fillStyle = "#d9d3c7";
    context.fillRect(0, third, width, third);
    for (let board = 0; board < 32; board++) {
      context.fillStyle = board % 2 ? CORAL : "#ffcf59";
      context.fillRect((board * width) / 32, third, width / 32, 14);
    }
    // The lower tier: eight blocks of fans in the four player colours.
    const block = width / 8;
    for (let index = 0; index < 8; index++) {
      context.fillStyle = mix(PLAYER_COLORS[index % 4], "#ffffff", 0.12);
      context.fillRect(index * block, third * 2, block, third);
    }
    rows(third * 2, "#00000026");
    crowd(third * 2, ["#fffaf0", "#ffe08a", "#ffffffb0"], 1100);
    context.fillStyle = IVORY;
    for (let index = 0; index < 8; index++) {
      context.fillRect(index * block - 3, third * 2, 6, third);
      context.fillRect(index * block + block / 2 - 1, third * 2, 2, third);
    }
  });
}

function pitchTexture() {
  return canvasTexture(256, 152, (context) => {
    for (let stripe = 0; stripe < 8; stripe++) {
      context.fillStyle = stripe % 2 ? "#63b04a" : "#71bd55";
      context.fillRect(stripe * 32, 0, 32, 152);
    }
    context.strokeStyle = "#f4fbe8";
    context.lineWidth = 3;
    context.strokeRect(12, 12, 232, 128);
    context.beginPath();
    context.moveTo(128, 12);
    context.lineTo(128, 140);
    context.stroke();
    context.beginPath();
    context.arc(128, 76, 20, 0, Math.PI * 2);
    context.stroke();
    context.strokeRect(12, 46, 30, 60);
    context.strokeRect(214, 46, 30, 60);
  });
}

/** A soft round glow for the lamps of a hosted championship. */
function haloTexture() {
  return canvasTexture(128, 128, (context) => {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.22, "rgba(255, 255, 255, 0.6)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  });
}

/** Everything that never moves or changes colour, baked into one mesh. */
function stadiumBody() {
  const { squash, ground, rim, roof } = STADIUM;
  const [from, to] = STADIUM.roofArc;
  // Round-space bowl first: it is squashed into an oval as one piece.
  const round: Part[] = [
    {
      geometry: new THREE.CylinderGeometry(0.64, 0.66, ground, 48),
      color: "#e7e0d3",
      position: [0, ground / 2, 0],
    },
    {
      geometry: new THREE.CircleGeometry(0.345, 48),
      color: "#cf6a4f",
      position: [0, ground + 0.002, 0],
      rotation: [-Math.PI / 2, 0, 0],
    },
    ...[0.3, 0.322].map(
      (radius): Part => ({
        geometry: new THREE.RingGeometry(radius, radius + 0.006, 48),
        color: "#f7efe2",
        position: [0, ground + 0.0028, 0],
        rotation: [-Math.PI / 2, 0, 0],
      }),
    ),
    {
      geometry: new THREE.RingGeometry(0.548, 0.627, 48),
      color: IVORY,
      position: [0, rim, 0],
      rotation: [-Math.PI / 2, 0, 0],
    },
    {
      geometry: new THREE.CylinderGeometry(0.55, 0.55, 0.04, 48, 1, true),
      color: IVORY,
      position: [0, rim - 0.02, 0],
    },
  ];
  // Ivory fins lean out over the glass facade, like a crown.
  for (let fin = 0; fin < 40; fin++) {
    const theta = (fin / 40) * Math.PI * 2;
    composer.position.set(
      Math.cos(theta) * 0.596,
      ground + 0.118,
      Math.sin(theta) * 0.596,
    );
    composer.rotation.set(0.1, Math.PI / 2 - theta, 0, "YXZ");
    composer.scale.set(1, 1, 1);
    composer.updateMatrix();
    round.push({
      geometry: new THREE.BoxGeometry(0.024, 0.236, 0.05),
      color: IVORY,
      matrix: composer.matrix.clone(),
    });
  }
  // The canopy and the posts holding up its back.
  round.push({
    geometry: arcSlab(roof.inner, roof.outer, from, to, roof.depth),
    color: "#fffdf7",
    position: [0, roof.y + roof.depth, 0],
    rotation: [roof.tilt, 0, 0],
  });
  for (const theta of [
    from + 0.45,
    Math.PI * 1.5 - 0.42,
    Math.PI * 1.5 + 0.42,
    to - 0.45,
  ]) {
    const x = Math.cos(theta) * 0.6;
    const z = Math.sin(theta) * 0.6;
    const top = roofUnderside(z);
    round.push({
      geometry: new THREE.CylinderGeometry(0.011, 0.014, top - rim, 6),
      color: "#e9edf0",
      position: [x, (top + rim) / 2, z * Math.cos(roof.tilt)],
    });
  }
  for (const theta of STADIUM.flags) {
    const radius = roof.outer - 0.02;
    const z = Math.sin(theta) * radius;
    const base = roofUnderside(z) + roof.depth;
    round.push({
      geometry: new THREE.CylinderGeometry(0.005, 0.005, STADIUM.flagPole, 5),
      color: "#f1f3f4",
      position: [
        Math.cos(theta) * radius,
        base + STADIUM.flagPole / 2,
        z * Math.cos(roof.tilt),
      ],
    });
  }
  const bowl = bake(round).scale(1, 1, squash);

  // Final-space parts: floodlight masts and the trophy's pedestal.
  const parts: Part[] = [{ geometry: bowl }];
  for (const { position, matrix } of floodlightHeads()) {
    const height = position.y - ground;
    parts.push(
      {
        geometry: new THREE.CylinderGeometry(0.008, 0.014, height, 8),
        color: "#d6dbe0",
        position: [position.x, ground + height / 2, position.z],
      },
      {
        geometry: new THREE.BoxGeometry(0.05, 0.03, 0.05),
        color: "#98a3ab",
        position: [position.x, ground + 0.015, position.z],
      },
      {
        geometry: new THREE.BoxGeometry(0.15, 0.09, 0.024),
        color: "#c3ccd3",
        matrix,
      },
    );
  }
  parts.push(
    {
      geometry: new THREE.CylinderGeometry(0.052, 0.064, 0.058, 20),
      color: "#22404f",
      position: [0, STADIUM.pitch.y + 0.029, 0],
    },
    {
      geometry: new THREE.CylinderGeometry(0.054, 0.054, 0.012, 20),
      color: GOLD,
      position: [0, STADIUM.pitch.y + 0.05, 0],
    },
  );
  return bake(parts);
}

/** The rim band and the canopy's fascia: coral, or the host's colour. */
function stadiumAccents() {
  const { roof } = STADIUM;
  const [from, to] = STADIUM.roofArc;
  return bake([
    {
      geometry: new THREE.CylinderGeometry(0.627, 0.622, 0.036, 48, 1, true),
      color: "#ffffff",
      position: [0, STADIUM.rim - 0.018, 0],
    },
    {
      geometry: new THREE.CylinderGeometry(
        roof.outer,
        roof.outer,
        0.034,
        32,
        1,
        true,
        Math.PI / 2 - to,
        to - from,
      ).translate(0, roof.depth / 2, 0),
      color: "#ffffff",
      position: [0, roof.y, 0],
      rotation: [roof.tilt, 0, 0],
    },
  ]).scale(1, 1, STADIUM.squash);
}

/** The ribbed glass facade behind the fins. */
function stadiumGlass() {
  return bake([
    {
      geometry: new THREE.CylinderGeometry(0.585, 0.565, 0.24, 48, 1, true),
      color: "#4aa6c6",
      position: [0, STADIUM.ground + 0.12, 0],
    },
  ]).scale(1, 1, STADIUM.squash);
}

/** Both tiers of seats and the concourse between them, as one lathe. */
function standsGeometry() {
  return new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.335, STADIUM.ground + 0.01),
      new THREE.Vector2(0.455, 0.145),
      new THREE.Vector2(0.477, 0.145),
      new THREE.Vector2(0.552, STADIUM.rim - 0.035),
    ],
    48,
  ).scale(1, 1, STADIUM.squash);
}

/** Lamp faces and the canopy's inner light strip: they glow for a host. */
function stadiumLights() {
  const { roof } = STADIUM;
  const [from, to] = STADIUM.roofArc;
  const face = new THREE.Matrix4().makeTranslation(0, 0, 0.0135);
  return bake([
    ...floodlightHeads().map(
      ({ matrix }): Part => ({
        geometry: new THREE.BoxGeometry(0.13, 0.074, 0.004),
        color: "#ffffff",
        matrix: matrix.clone().multiply(face),
      }),
    ),
    {
      geometry: bake([
        {
          geometry: new THREE.CylinderGeometry(
            roof.inner + 0.002,
            roof.inner + 0.002,
            0.03,
            32,
            1,
            true,
            Math.PI / 2 - to,
            to - from,
          ),
          color: "#ffffff",
          position: [0, roof.y - 0.002, 0],
          rotation: [roof.tilt, 0, 0],
        },
      ]).scale(1, 1, STADIUM.squash),
    },
  ]);
}

/** Soft beams from the lamps onto the pitch, shown only for a host. */
function stadiumBeams() {
  const target = new THREE.Vector3(0, STADIUM.pitch.y, 0);
  return bake(
    floodlightHeads().map(({ position, matrix }): Part => {
      const length = position.distanceTo(target);
      return {
        geometry: new THREE.ConeGeometry(0.15, length, 20, 1, true)
          .rotateX(-Math.PI / 2)
          .translate(0, 0, length / 2 + 0.02),
        color: "#ffffff",
        matrix,
      };
    }),
    ["uv"],
  );
}

/** Beam opacity: strong at the lamp (the cone's apex), gone at the pitch. */
function beamFade() {
  return canvasTexture(4, 64, (context) => {
    const gradient = context.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.55, "#555555");
    gradient.addColorStop(1, "#000000");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 64);
  });
}

/** The cup: a turned gold body with two handles. */
function trophyGeometry() {
  const profile = [
    [0, 0],
    [0.05, 0],
    [0.05, 0.012],
    [0.036, 0.02],
    [0.013, 0.032],
    [0.012, 0.074],
    [0.023, 0.084],
    [0.012, 0.096],
    [0.014, 0.11],
    [0.042, 0.122],
    [0.07, 0.146],
    [0.085, 0.18],
    [0.091, 0.214],
    [0.097, 0.226],
    [0.085, 0.227],
    [0.072, 0.2],
    [0, 0.18],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return bake([
    { geometry: new THREE.LatheGeometry(profile, 28), color: "#ffffff" },
    ...[-1, 1].map(
      (side): Part => ({
        geometry: new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(
            [
              [0.084, 0.206],
              [0.128, 0.206],
              [0.143, 0.174],
              [0.12, 0.143],
              [0.056, 0.134],
            ].map(([x, y]) => new THREE.Vector3(side * x, y, 0)),
          ),
          18,
          0.011,
          8,
        ),
        color: "#ffffff",
      }),
    ),
  ]).scale(STADIUM.trophy.scale, STADIUM.trophy.scale, STADIUM.trophy.scale);
}

function flagGeometry() {
  return new THREE.PlaneGeometry(0.078, 0.05).translate(0.039, -0.025, 0);
}

function Stadium({
  hosted,
  hostSeat,
  animated,
  lowGraphics,
  glaze,
}: {
  hosted: boolean;
  hostSeat: Seat | null;
  animated: boolean;
  lowGraphics: boolean;
  glaze: THREE.Texture;
}) {
  const body = useDisposable(stadiumBody);
  const glass = useDisposable(stadiumGlass);
  const accents = useDisposable(stadiumAccents);
  const stands = useDisposable(standsGeometry);
  const lights = useDisposable(stadiumLights);
  const beams = useDisposable(stadiumBeams);
  const cup = useDisposable(trophyGeometry);
  const pennant = useDisposable(flagGeometry);
  const seats = useDisposable(standsTexture);
  const turf = useDisposable(pitchTexture);
  const halo = useDisposable(haloTexture);
  const fade = useDisposable(beamFade);
  const gold = useDisposable(goldMatcap);
  const heads = useMemo(floodlightHeads, []);
  const trophy = useRef<THREE.Group>(null);
  const flags = useRef<THREE.InstancedMesh>(null);
  const tops = useMemo(flagTops, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const { invalidate } = useThree();
  const hostColor = hostSeat !== null ? PLAYER_COLORS[hostSeat] : null;
  const glow = hostColor ? mix(hostColor, "#ffffff", 0.35) : "#ffe7a8";

  useEffect(() => {
    const mesh = flags.current;
    if (!mesh) return;
    const color = new THREE.Color();
    tops.forEach((top, index) => {
      dummy.position.copy(top);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, color.set(hostColor ?? PLAYER_COLORS[index]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [tops, dummy, hostColor, invalidate]);

  useFrame(({ clock }) => {
    const time = animated ? clock.elapsedTime : 0;
    if (trophy.current) {
      trophy.current.rotation.y = 0.55 + time * 0.7;
      trophy.current.position.y =
        STADIUM.trophy.y + (animated ? Math.sin(time * 1.9) * 0.008 : 0);
    }
    const mesh = flags.current;
    if (!mesh) return;
    tops.forEach((top, index) => {
      const wave = animated ? Math.sin(time * 2.6 + index * 1.3) * 0.35 : 0;
      dummy.position.copy(top);
      dummy.rotation.set(0, wave, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={STADIUM_ANCHOR} rotation={[0, SCREEN_YAW, 0]}>
      <mesh geometry={body} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          roughness={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={accents}>
        <meshStandardMaterial
          color={hostColor ?? CORAL}
          emissive={hostColor ?? "#000000"}
          emissiveIntensity={hostColor ? 0.55 : 0}
          roughness={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={glass}>
        <meshMatcapMaterial vertexColors matcap={glaze} />
      </mesh>
      <mesh geometry={stands} receiveShadow>
        <meshStandardMaterial
          map={seats}
          roughness={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        position={[0, STADIUM.pitch.y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[STADIUM.pitch.width, STADIUM.pitch.depth]} />
        <meshStandardMaterial map={turf} roughness={0.9} />
      </mesh>
      <mesh geometry={lights}>
        <meshStandardMaterial
          side={THREE.DoubleSide}
          color="#fff8e8"
          emissive={glow}
          emissiveIntensity={hosted ? 1.3 : 0.28}
          toneMapped={false}
        />
      </mesh>
      {hosted &&
        heads.map(({ position }) => (
          <sprite
            key={position.x}
            position={[position.x, position.y, position.z]}
            scale={0.34}
            renderOrder={3}
          >
            <spriteMaterial
              map={halo}
              color={glow}
              transparent
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
        ))}
      {hosted && !lowGraphics && (
        <mesh geometry={beams} renderOrder={3}>
          <meshBasicMaterial
            color={glow}
            alphaMap={fade}
            transparent
            opacity={0.5}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
      <instancedMesh ref={flags} args={[pennant, undefined, tops.length]}>
        <meshStandardMaterial roughness={0.8} side={THREE.DoubleSide} />
      </instancedMesh>
      <group ref={trophy} position={[0, STADIUM.trophy.y, 0]}>
        <mesh geometry={cup} castShadow>
          <meshMatcapMaterial matcap={gold} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

// ── World tour: a little jet port ─────────────────────────────────────────

const AIRPORT = {
  corner: 24,
  terminal: { x: 0.08, z: -0.47, length: 0.66, depth: 0.17, height: 0.085 },
  tower: { x: -0.36, z: -0.6, top: 0.755 },
  plane: { x: 0.28, y: 0.142, pitch: 0.17 },
  windsock: { x: 0.66, z: -0.2, height: 0.22 },
} as const;

const AIRPORT_ANCHOR = at(AIRPORT.corner, 0, 0);

function airportBody() {
  const { terminal, tower, windsock } = AIRPORT;
  const parts: Part[] = [
    {
      geometry: new THREE.BoxGeometry(0.78, 0.02, 0.3),
      color: "#e3ded4",
      position: [terminal.x, 0.01, terminal.z + 0.01],
    },
    {
      geometry: new THREE.BoxGeometry(
        terminal.length,
        terminal.height,
        terminal.depth,
      ),
      color: "#f6f3ec",
      position: [terminal.x, 0.02 + terminal.height / 2, terminal.z],
    },
    {
      // A coral fascia under the glass vault.
      geometry: new THREE.BoxGeometry(
        terminal.length + 0.012,
        0.016,
        terminal.depth + 0.012,
      ),
      color: CORAL,
      position: [terminal.x, 0.012 + terminal.height, terminal.z],
    },
    {
      geometry: new THREE.BoxGeometry(0.036, 0.036, 0.13),
      color: "#dfe4e8",
      position: [terminal.x - 0.2, 0.075, terminal.z + 0.14],
    },
    {
      geometry: new THREE.BoxGeometry(0.05, 0.05, 0.04),
      color: "#cfd6db",
      position: [terminal.x - 0.2, 0.068, terminal.z + 0.215],
    },
    // A baggage tug and a fuel truck waiting on the apron.
    {
      geometry: new THREE.BoxGeometry(0.05, 0.026, 0.032),
      color: "#ffc93c",
      position: [0.0, 0.016, -0.255],
    },
    {
      geometry: new THREE.BoxGeometry(0.022, 0.02, 0.028),
      color: "#22394a",
      position: [-0.006, 0.039, -0.255],
    },
    {
      geometry: new THREE.BoxGeometry(0.075, 0.034, 0.034),
      color: "#fdfdfb",
      position: [0.36, 0.019, -0.26],
    },
    {
      geometry: new THREE.BoxGeometry(0.028, 0.034, 0.034),
      color: CORAL,
      position: [0.412, 0.019, -0.26],
    },
  ];
  // Edge lights along the runway, clear of the pawns' end.
  for (let light = 0; light < 9; light++)
    for (const side of [-1, 1])
      parts.push({
        geometry: new THREE.BoxGeometry(0.012, 0.01, 0.012),
        color: "#ffe39a",
        position: [-0.2 + light * 0.125, 0.005, side * 0.216],
      });
  // Ivory ribs over the glass vault.
  for (let rib = 0; rib < 6; rib++)
    parts.push({
      geometry: new THREE.TorusGeometry(0.103, 0.006, 4, 16, Math.PI)
        .rotateY(Math.PI / 2)
        .scale(1, 0.72, 1),
      color: IVORY,
      position: [
        terminal.x - 0.3 + rib * 0.12,
        0.02 + terminal.height,
        terminal.z,
      ],
    });
  // Facade mullions in front of the glass band.
  for (let mullion = 0; mullion <= 10; mullion++)
    parts.push({
      geometry: new THREE.BoxGeometry(0.008, 0.056, 0.006),
      color: IVORY,
      position: [
        terminal.x - 0.31 + mullion * 0.062,
        0.064,
        terminal.z + terminal.depth / 2 + 0.005,
      ],
    });
  // The control tower: a white shaft with coral bands and a glass cab.
  parts.push(
    {
      geometry: new THREE.BoxGeometry(0.12, 0.07, 0.12),
      color: "#e7e2d8",
      position: [tower.x, 0.035, tower.z],
    },
    {
      geometry: new THREE.CylinderGeometry(0.034, 0.046, 0.46, 14),
      color: "#f7f4ee",
      position: [tower.x, 0.3, tower.z],
    },
    {
      geometry: new THREE.CylinderGeometry(0.045, 0.045, 0.02, 14),
      color: CORAL,
      position: [tower.x, 0.2, tower.z],
    },
    {
      geometry: new THREE.CylinderGeometry(0.041, 0.041, 0.02, 14),
      color: CORAL,
      position: [tower.x, 0.38, tower.z],
    },
    {
      geometry: new THREE.CylinderGeometry(0.086, 0.07, 0.022, 16),
      color: "#e8ecef",
      position: [tower.x, 0.541, tower.z],
    },
    {
      geometry: new THREE.CylinderGeometry(0.058, 0.106, 0.03, 16),
      color: "#fdfbf6",
      position: [tower.x, 0.64, tower.z],
    },
    {
      geometry: new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6),
      color: "#9aa5ad",
      position: [tower.x, 0.7, tower.z],
    },
    {
      geometry: new THREE.CylinderGeometry(0.006, 0.007, windsock.height, 6),
      color: "#f1f3f4",
      position: [windsock.x, windsock.height / 2, windsock.z],
    },
  );
  return bake(parts);
}

function airportGlass() {
  const { terminal, tower } = AIRPORT;
  return bake([
    {
      // A flattened half-cylinder vault along the terminal.
      geometry: new THREE.CylinderGeometry(
        0.1,
        0.1,
        terminal.length + 0.04,
        20,
        1,
        false,
        0,
        Math.PI,
      )
        .rotateZ(Math.PI / 2)
        .scale(1, 0.72, 1),
      color: "#7ccfe8",
      position: [terminal.x, 0.02 + terminal.height, terminal.z],
    },
    {
      geometry: new THREE.BoxGeometry(terminal.length - 0.04, 0.05, 0.004),
      color: GLASS,
      position: [terminal.x, 0.064, terminal.z + terminal.depth / 2 + 0.002],
    },
    {
      geometry: new THREE.CylinderGeometry(0.096, 0.074, 0.076, 16),
      color: GLASS,
      position: [tower.x, 0.59, tower.z],
    },
  ]);
}

/** A chunky toy airliner, nose along +x, wheels at y ≈ -0.125. */
function planeGeometry() {
  const band = (from: number, to: number): Part => ({
    geometry: new THREE.CylinderGeometry(
      0.0668,
      0.0668,
      0.34,
      16,
      1,
      true,
      from,
      to - from,
    ).rotateZ(-Math.PI / 2),
    color: "#22394a",
    position: [0.01, 0, 0],
  });
  const wheel = (x: number, z: number): Part[] => [
    {
      geometry: new THREE.CylinderGeometry(0.005, 0.005, 0.05, 5),
      color: "#9aa5ad",
      position: [x, -0.085, z],
    },
    {
      geometry: new THREE.CylinderGeometry(0.015, 0.015, 0.014, 10).rotateX(
        Math.PI / 2,
      ),
      color: "#26323b",
      position: [x, -0.11, z],
    },
  ];
  return bake([
    {
      geometry: new THREE.CapsuleGeometry(0.066, 0.44, 6, 18).rotateZ(
        -Math.PI / 2,
      ),
      color: "#fdfdfb",
    },
    {
      geometry: new THREE.BoxGeometry(0.42, 0.014, 0.1345),
      color: CORAL,
      position: [0, -0.008, 0],
    },
    // Window bands on both flanks, and the cockpit glazing.
    band(-0.5, -0.24),
    band(Math.PI + 0.24, Math.PI + 0.5),
    {
      geometry: new THREE.BoxGeometry(0.034, 0.02, 0.06),
      color: "#22394a",
      position: [0.262, 0.044, 0],
      rotation: [0, 0, -0.75],
    },
    {
      geometry: slab(
        [
          [0.07, 0],
          [-0.11, 0.34],
          [-0.17, 0.34],
          [-0.09, 0],
          [-0.17, -0.34],
          [-0.11, -0.34],
        ],
        0.014,
      ),
      color: "#eef1f4",
      position: [0.02, -0.024, 0],
    },
    ...[-1, 1].map(
      (side): Part => ({
        geometry: new THREE.BoxGeometry(0.05, 0.05, 0.008),
        color: CORAL,
        position: [-0.115, -0.012, side * 0.345],
        rotation: [side * 0.15, 0, -0.35],
      }),
    ),
    ...[-1, 1].flatMap((side): Part[] => [
      {
        geometry: new THREE.CylinderGeometry(0.025, 0.021, 0.1, 14).rotateZ(
          -Math.PI / 2,
        ),
        color: CORAL,
        position: [0.045, -0.062, side * 0.145],
      },
      {
        geometry: new THREE.CircleGeometry(0.02, 14).rotateY(Math.PI / 2),
        color: "#26323b",
        position: [0.0955, -0.062, side * 0.145],
      },
      {
        geometry: new THREE.BoxGeometry(0.05, 0.03, 0.008),
        color: "#eef1f4",
        position: [0.03, -0.04, side * 0.145],
      },
    ]),
    {
      geometry: plate(
        [
          [-0.15, 0.03],
          [-0.265, 0.2],
          [-0.32, 0.2],
          [-0.27, 0.03],
        ],
        0.012,
      ),
      color: CORAL,
    },
    {
      geometry: slab(
        [
          [-0.2, 0],
          [-0.28, 0.125],
          [-0.31, 0.125],
          [-0.27, 0],
          [-0.31, -0.125],
          [-0.28, -0.125],
        ],
        0.01,
      ),
      color: "#eef1f4",
      position: [0, 0.03, 0],
    },
    ...wheel(0.19, 0),
    ...wheel(-0.03, 0.07),
    ...wheel(-0.03, -0.07),
  ]);
}

/** The windsock's three stripes, along +x from its pole. */
function windsockGeometry() {
  const stripes = [
    { from: 0.028, to: 0.024, color: CORAL },
    { from: 0.024, to: 0.02, color: "#fffaf0" },
    { from: 0.02, to: 0.016, color: CORAL },
  ];
  return bake(
    stripes.map(
      ({ from, to, color }, index): Part => ({
        geometry: new THREE.CylinderGeometry(
          to,
          from,
          0.036,
          10,
          1,
          true,
        ).rotateZ(-Math.PI / 2),
        color,
        position: [0.018 + index * 0.036, 0, 0],
      }),
    ),
  );
}

/** Exhaust puffs trailing behind each engine. */
const PUFFS_PER_ENGINE = 4;

function Airport({
  animated,
  glaze,
}: {
  animated: boolean;
  glaze: THREE.Texture;
}) {
  const body = useDisposable(airportBody);
  const glass = useDisposable(airportGlass);
  const jet = useDisposable(planeGeometry);
  const sockGeometry = useDisposable(windsockGeometry);
  const plane = useRef<THREE.Group>(null);
  const radar = useRef<THREE.Group>(null);
  const sock = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.MeshStandardMaterial>(null);
  const puffs = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const { tower, plane: pose, windsock } = AIRPORT;

  useFrame(({ clock }) => {
    const time = animated ? clock.elapsedTime : 0;
    if (plane.current) {
      plane.current.position.y =
        pose.y + (animated ? (1 + Math.sin(time * 1.6)) * 0.006 : 0);
      plane.current.rotation.set(
        animated ? Math.sin(time * 1.1) * 0.03 : 0,
        0,
        pose.pitch + (animated ? Math.sin(time * 1.6 + 0.6) * 0.015 : 0),
      );
    }
    if (radar.current) radar.current.rotation.y = 0.6 + time * 2.2;
    if (sock.current)
      sock.current.rotation.set(0, -0.5 + Math.sin(time * 0.9) * 0.35, -0.12);
    if (beacon.current)
      beacon.current.emissiveIntensity =
        animated && Math.sin(time * 4) < 0 ? 0.15 : 1.4;
    // Exhaust puffs swell as they roll back from the engines, then vanish.
    const mesh = puffs.current;
    if (!mesh) return;
    for (let puff = 0; puff < PUFFS_PER_ENGINE * 2; puff++) {
      const side = puff % 2 ? 1 : -1;
      const step = Math.floor(puff / 2) / PUFFS_PER_ENGINE;
      const phase = ((animated ? time * 0.7 : 0) + step + 0.12) % 1;
      const size = (0.016 + 0.038 * phase) * (1 - phase ** 3);
      dummy.position.set(
        -0.03 - phase * 0.3,
        -0.06 + phase * 0.012,
        side * 0.145,
      );
      dummy.scale.setScalar(Math.max(0.001, size));
      dummy.updateMatrix();
      mesh.setMatrixAt(puff, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={AIRPORT_ANCHOR} rotation={[0, SCREEN_YAW, 0]}>
      <mesh geometry={body} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.7} />
      </mesh>
      <mesh geometry={glass} castShadow>
        <meshMatcapMaterial vertexColors matcap={glaze} />
      </mesh>
      <group ref={radar} position={[tower.x, 0.688, tower.z]}>
        <mesh position={[0.012, 0, 0]}>
          <boxGeometry args={[0.1, 0.026, 0.012]} />
          <meshStandardMaterial color="#e8ecef" roughness={0.5} />
        </mesh>
      </group>
      <mesh position={[tower.x, AIRPORT.tower.top, tower.z]}>
        <sphereGeometry args={[0.015, 10, 8]} />
        <meshStandardMaterial
          ref={beacon}
          color="#ff6b5a"
          emissive="#ff3b2a"
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </mesh>
      <group
        ref={sock}
        position={[windsock.x, windsock.height - 0.02, windsock.z]}
      >
        <mesh geometry={sockGeometry}>
          <meshStandardMaterial
            vertexColors
            roughness={0.85}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      <group ref={plane} position={[pose.x, pose.y, 0]}>
        <mesh geometry={jet} castShadow>
          <meshStandardMaterial vertexColors roughness={0.35} />
        </mesh>
        <instancedMesh
          ref={puffs}
          args={[undefined, undefined, PUFFS_PER_ENGINE * 2]}
          frustumCulled={false}
        >
          <icosahedronGeometry args={[1, 2]} />
          <meshStandardMaterial
            color="#ffffff"
            emissive="#ffffff"
            emissiveIntensity={0.4}
            roughness={1}
          />
        </instancedMesh>
      </group>
    </group>
  );
}

/**
 * World points the landmarks reach up to, so the camera framing keeps the
 * stadium's lamps and flags and the control tower inside the free band.
 */
export const LANDMARK_PEAKS: readonly Vec3[] = [
  landmarkPoint(
    STADIUM_ANCHOR,
    0,
    STADIUM.trophy.y + STADIUM.trophy.height * STADIUM.trophy.scale,
    0,
  ),
  ...floodlightHeads().map(({ position }) =>
    landmarkPoint(STADIUM_ANCHOR, position.x, position.y + 0.05, position.z),
  ),
  ...flagTops().map((top) =>
    landmarkPoint(STADIUM_ANCHOR, top.x, top.y, top.z),
  ),
  landmarkPoint(
    STADIUM_ANCHOR,
    0,
    roofUnderside(-STADIUM.roof.outer) + STADIUM.roof.depth + 0.02,
    -STADIUM.roof.outer * Math.cos(STADIUM.roof.tilt) * STADIUM.squash,
  ),
  landmarkPoint(
    AIRPORT_ANCHOR,
    AIRPORT.tower.x,
    AIRPORT.tower.top + 0.02,
    AIRPORT.tower.z,
  ),
];

// Screen-down offset (toward the camera) of each corner's printed name.
const LABEL_DROP: Record<number, number> = { 8: 0.42, 16: 0.28, 24: 0.42 };

function CornerLabel({
  corner,
  boardRule,
}: {
  corner: number;
  boardRule: BoardRule;
}) {
  const { locale } = useLocale();
  const texture = useMemo(
    () =>
      labelTexture(tileName(corner, { boardRule }).toLocaleUpperCase(locale)),
    [corner, locale, boardRule],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const [x, z] = tileCenter(corner);
  const drop = LABEL_DROP[corner] ?? 0;
  return (
    <sprite
      position={[x + drop, LOT_TOP + 0.12, z + drop]}
      scale={[1.55, 0.36, 1]}
      renderOrder={4}
    >
      <spriteMaterial
        map={texture}
        depthTest={false}
        transparent
        toneMapped={false}
      />
    </sprite>
  );
}

export function Landmarks({
  boardRule = "country",
  state = null,
  animated = false,
  lowGraphics = false,
  potato = false,
}: {
  boardRule?: BoardRule;
  state?: PublicState | null;
  /** Ambient life plays; see `useAmbientMotion`, which keeps frames coming. */
  animated?: boolean;
  lowGraphics?: boolean;
  potato?: boolean;
}) {
  const glaze = useDisposable(glassMatcap);
  const host = state?.championshipHost ?? null;
  const hostSeat =
    state && host ? (getProperty(state, host.tile)?.owner ?? null) : null;
  return (
    <group>
      {!potato && (
        <>
          <Island />
          <Stadium
            hosted={host !== null}
            hostSeat={hostSeat}
            animated={animated}
            lowGraphics={lowGraphics}
            glaze={glaze}
          />
          <Airport animated={animated} glaze={glaze} />
        </>
      )}
      {getBoard(boardRule)
        .filter((tile) => tile.index % 8 === 0 && tile.kind !== "start")
        .map((tile) => (
          <CornerLabel
            key={tile.index}
            corner={tile.index}
            boardRule={boardRule}
          />
        ))}
    </group>
  );
}
