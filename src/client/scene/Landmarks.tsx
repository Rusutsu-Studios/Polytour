import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BOARD } from "../../shared/board/index.js";
import { useLocale } from "../i18n.js";
import { tileName } from "../ui/board-display.js";
import {
  LOT_TOP,
  tileCenter,
  tilePoint,
  tileRotation,
} from "./board-layout.js";
import { labelTexture } from "./board-textures.js";

// Small original landmarks on the island, championship and world-tour corners;
// Start is printed flat so nothing tall stands in front of the board. Each
// keeps to the outer half of its square: the inner quarter belongs to pawns.

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

// A small open-air arena: sloped stands around a pitch, a coral canopy band
// and two floodlights.
function Arena() {
  const stands = useMemo(() => {
    const profile = [
      new THREE.Vector2(0.3, 0),
      new THREE.Vector2(0.46, 0),
      new THREE.Vector2(0.46, 0.2),
      new THREE.Vector2(0.42, 0.22),
      new THREE.Vector2(0.3, 0.07),
    ];
    return new THREE.LatheGeometry(profile, 28);
  }, []);
  useEffect(() => () => stands.dispose(), [stands]);
  const rotation = tileRotation(16);
  return (
    <group position={at(16, -0.32, -0.32)} rotation={[0, rotation, 0]}>
      <mesh geometry={stands} scale={[1, 1, 0.82]} castShadow receiveShadow>
        <meshStandardMaterial
          color="#f1ece6"
          roughness={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0.205, 0]} scale={[1, 1, 0.82]}>
        <cylinderGeometry args={[0.47, 0.47, 0.05, 28, 1, true]} />
        <meshStandardMaterial color="#e2574a" side={THREE.DoubleSide} />
      </mesh>
      <mesh
        position={[0, 0.012, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[1, 0.82, 1]}
      >
        <circleGeometry args={[0.3, 24]} />
        <meshStandardMaterial color="#6fb547" />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.5, 0, side * -0.18]}>
          <mesh position={[0, 0.3, 0]} castShadow>
            <cylinderGeometry args={[0.014, 0.018, 0.6, 5]} />
            <meshStandardMaterial color="#d7d9dc" />
          </mesh>
          <mesh position={[0, 0.61, 0]}>
            <boxGeometry args={[0.12, 0.07, 0.03]} />
            <meshStandardMaterial
              color="#fff7cf"
              emissive="#ffe28a"
              emissiveIntensity={0.6}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Airport() {
  return (
    <group>
      {/* The tower stands at the back tip, where it hides nothing. */}
      <group position={at(24, -0.45, 0.42)}>
        <mesh position={[0, 0.27, 0]} castShadow>
          <cylinderGeometry args={[0.06, 0.08, 0.54, 10]} />
          <meshStandardMaterial color="#f3f0ea" />
        </mesh>
        <mesh position={[0, 0.6, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.1, 0.12, 10]} />
          <meshStandardMaterial color="#4fb5d8" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.68, 0]}>
          <cylinderGeometry args={[0.02, 0.15, 0.05, 10]} />
          <meshStandardMaterial color="#e2574a" />
        </mesh>
      </group>
      {/* An airliner on its runway, seen in profile from the camera. */}
      <group
        position={at(24, -0.25, -0.25, LOT_TOP + 0.13)}
        rotation={[0, Math.PI / 4, 0]}
        scale={0.95}
      >
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <capsuleGeometry args={[0.065, 0.5, 4, 10]} />
          <meshStandardMaterial color="#fbfbf8" roughness={0.5} />
        </mesh>
        <mesh position={[0.02, -0.01, 0]} castShadow>
          <boxGeometry args={[0.14, 0.02, 0.62]} />
          <meshStandardMaterial color="#e8ecef" />
        </mesh>
        <mesh position={[-0.27, 0.06, 0]}>
          <boxGeometry args={[0.08, 0.016, 0.24]} />
          <meshStandardMaterial color="#e8ecef" />
        </mesh>
        <mesh position={[-0.28, 0.12, 0]} castShadow>
          <boxGeometry args={[0.1, 0.14, 0.018]} />
          <meshStandardMaterial color="#2b80c4" />
        </mesh>
        <mesh position={[0.1, 0.02, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.067, 0.067, 0.16, 10, 1, true]} />
          <meshStandardMaterial color="#2b80c4" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

// Screen-down offset (toward the camera) of each corner's printed name.
const LABEL_DROP: Record<number, number> = { 8: 0.42, 16: 0, 24: 0.42 };

function CornerLabel({ corner }: { corner: number }) {
  const { locale } = useLocale();
  const texture = useMemo(
    () => labelTexture(tileName(corner).toLocaleUpperCase(locale)),
    [corner, locale],
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

export function Landmarks() {
  return (
    <group>
      <Island />
      <Arena />
      <Airport />
      {BOARD.filter(
        (tile) => tile.index % 8 === 0 && tile.kind !== "start",
      ).map((tile) => (
        <CornerLabel key={tile.index} corner={tile.index} />
      ))}
    </group>
  );
}
