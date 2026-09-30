import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BOARD, DECISION_TIMING } from "../../shared/board/index.js";
import type { PublicState, Seat } from "../../shared/engine/index.js";
import { getProperty } from "../../shared/engine/index.js";
import type { AnimationContext } from "../director/director.js";
import { director } from "../director/director.js";
import {
  money,
  PLAYER_COLORS,
  PLAYER_SYMBOLS,
  pawnOffset,
  TILE_ICONS,
  TILE_NAMES,
  tileColor,
  tilePosition,
  tilePrice,
} from "../ui/board-display.js";

type BoardProps = {
  state: PublicState | null;
  selected: number | null;
  onSelect: (tile: number) => void;
  preview?: boolean;
  zoom?: number;
};

// THESIS: A little travel world on a turquoise table, immediately playable.
// OWN-WORLD: ivory toy board, pastel districts, original roofs and seaside palms.
// STORY: roll, travel, buy, collect; the board shows events, the server owns rules.
// FIRST VIEWPORT: the whole diorama is framed; the decision stays in a readable DOM panel.
// FORM: premium toy diorama explicitly pinned by project docs and the supplied reference.

function roundedTile() {
  const shape = new THREE.Shape();
  const x = -0.5;
  const y = -0.5;
  const width = 1;
  const radius = 0.08;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + width - radius);
  shape.quadraticCurveTo(x + width, y + width, x + width - radius, y + width);
  shape.lineTo(x + radius, y + width);
  shape.quadraticCurveTo(x, y + width, x, y + width - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.025,
    bevelThickness: 0.025,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function tileTexture(index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const tile = BOARD[index];
  context.clearRect(0, 0, 256, 256);
  context.fillStyle = tileColor(index);
  context.fillRect(10, 10, 236, 56);
  context.fillStyle = "#173b45";
  context.textAlign = "center";
  context.font = "bold 24px Segoe UI, sans-serif";
  const words = TILE_NAMES[index].split(" ");
  if (words.length > 1 && TILE_NAMES[index].length > 12) {
    const split = Math.ceil(words.length / 2);
    context.fillText(words.slice(0, split).join(" "), 128, 178);
    context.fillText(words.slice(split).join(" "), 128, 203);
  } else context.fillText(TILE_NAMES[index], 128, 192);
  context.font = "bold 27px Segoe UI, sans-serif";
  const price = tilePrice(index);
  context.fillText(
    price === null ? TILE_ICONS[tile.kind] : money(price),
    128,
    236,
  );
  if (tile.kind !== "city" && tile.kind !== "resort") {
    context.fillStyle = "#173b45";
    context.font = "bold 80px Segoe UI, sans-serif";
    context.fillText(TILE_ICONS[tile.kind], 128, 139);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function BoardTiles({ state, selected, onSelect, preview }: BoardProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(roundedTile, []);
  const textures = useMemo(
    () => BOARD.map((tile) => tileTexture(tile.index)),
    [],
  );
  const transforms = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    if (!mesh.current) return;
    for (const tile of BOARD) {
      const [x, z] = tilePosition(tile.index);
      transforms.position.set(x, 0.14, z);
      transforms.updateMatrix();
      mesh.current.setMatrixAt(tile.index, transforms.matrix);
      const owner = state ? getProperty(state, tile.index)?.owner : null;
      color.set(
        tile.index === selected
          ? "#ffda72"
          : owner != null
            ? PLAYER_COLORS[owner]
            : "#fff9e9",
      );
      if (owner != null && tile.index !== selected)
        color.lerp(new THREE.Color("#fff9e9"), 0.78);
      mesh.current.setColorAt(tile.index, color);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
  }, [state, selected, transforms, color]);
  useEffect(
    () => () => {
      geometry.dispose();
      for (const texture of textures) texture.dispose();
    },
    [geometry, textures],
  );
  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[geometry, undefined, 32]}
        receiveShadow
        castShadow
        onPointerDown={(event) => {
          if (preview || event.instanceId === undefined) return;
          event.stopPropagation();
          onSelect(event.instanceId);
        }}
      >
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
      {BOARD.map((tile) => {
        const [x, z] = tilePosition(tile.index);
        const rotation =
          tile.index <= 8
            ? 0
            : tile.index <= 16
              ? Math.PI / 2
              : tile.index <= 24
                ? Math.PI
                : -Math.PI / 2;
        return (
          <group
            key={tile.index}
            position={[x, 0.316, z]}
            rotation={[0, rotation, 0]}
          >
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              onPointerDown={(event) => {
                if (!preview) {
                  event.stopPropagation();
                  onSelect(tile.index);
                }
              }}
            >
              <planeGeometry args={[0.96, 0.96]} />
              <meshBasicMaterial
                map={textures[tile.index]}
                transparent
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function Towns({ state, preview }: Pick<BoardProps, "state" | "preview">) {
  const walls = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);
  const windows = useRef<THREE.InstancedMesh>(null);
  const pole = useRef<THREE.InstancedMesh>(null);
  const flags = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const roofGeometry = useMemo(() => {
    const geometry = new THREE.ConeGeometry(0.24, 0.17, 4);
    geometry.rotateY(Math.PI / 4);
    return geometry;
  }, []);
  useEffect(() => {
    if (
      !walls.current ||
      !roofs.current ||
      !windows.current ||
      !pole.current ||
      !flags.current
    )
      return;
    let count = 0;
    let flagCount = 0;
    for (const tile of BOARD) {
      if (tile.kind !== "city") continue;
      const [x, z] = tilePosition(tile.index);
      const property = state ? getProperty(state, tile.index) : null;
      const level = property?.owner != null ? property.level : 0;
      const owner = property?.owner;
      const height =
        owner != null
          ? 0.24 + level * 0.14
          : preview
            ? 0.22 + (tile.index % 3) * 0.06
            : 0.14;
      const angle =
        tile.index <= 8
          ? 0
          : tile.index <= 16
            ? Math.PI / 2
            : tile.index <= 24
              ? Math.PI
              : -Math.PI / 2;
      const offsetX = Math.sin(angle) * 0.18;
      const offsetZ = -Math.cos(angle) * 0.18;
      dummy.rotation.set(0, angle, 0);
      dummy.position.set(x + offsetX, 0.34 + height / 2, z + offsetZ);
      dummy.scale.set(0.32, height, 0.29);
      dummy.updateMatrix();
      walls.current.setMatrixAt(count, dummy.matrix);
      walls.current.setColorAt(
        count,
        color.set(owner != null ? "#fff8de" : "#e8e7cf"),
      );
      dummy.position.y = 0.34 + height + 0.06;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      roofs.current.setMatrixAt(count, dummy.matrix);
      roofs.current.setColorAt(
        count,
        color.set(owner != null ? PLAYER_COLORS[owner] : tileColor(tile.index)),
      );
      dummy.position.set(
        x + offsetX + Math.sin(angle) * 0.151,
        0.34 + height / 2,
        z + offsetZ + Math.cos(angle) * 0.151,
      );
      dummy.scale.set(0.09, height * 0.5, 0.012);
      dummy.updateMatrix();
      windows.current.setMatrixAt(count, dummy.matrix);
      count += 1;
      if (owner != null) {
        dummy.position.set(x - 0.29, 0.54, z - 0.22);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.02, 0.43, 0.02);
        dummy.updateMatrix();
        pole.current.setMatrixAt(flagCount, dummy.matrix);
        dummy.position.set(x - 0.2, 0.69, z - 0.22);
        dummy.scale.set(0.21, 0.16, 0.028);
        dummy.updateMatrix();
        flags.current.setMatrixAt(flagCount, dummy.matrix);
        flags.current.setColorAt(flagCount, color.set(PLAYER_COLORS[owner]));
        flagCount += 1;
      }
    }
    walls.current.count = count;
    roofs.current.count = count;
    windows.current.count = count;
    pole.current.count = flagCount;
    flags.current.count = flagCount;
    for (const object of [
      walls.current,
      roofs.current,
      windows.current,
      pole.current,
      flags.current,
    ]) {
      object.instanceMatrix.needsUpdate = true;
      if (object.instanceColor) object.instanceColor.needsUpdate = true;
    }
  }, [state, preview, dummy, color]);
  useEffect(() => () => roofGeometry.dispose(), [roofGeometry]);
  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, 24]} castShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
      <instancedMesh
        ref={roofs}
        args={[roofGeometry, undefined, 24]}
        castShadow
      >
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={windows} args={[undefined, undefined, 24]}>
        <boxGeometry />
        <meshStandardMaterial color="#466a7c" />
      </instancedMesh>
      <instancedMesh ref={pole} args={[undefined, undefined, 24]} castShadow>
        <boxGeometry />
        <meshStandardMaterial color="#e6c79a" />
      </instancedMesh>
      <instancedMesh ref={flags} args={[undefined, undefined, 24]} castShadow>
        <boxGeometry />
        <meshStandardMaterial />
      </instancedMesh>
    </>
  );
}

function markerTexture(text: string, background: string, foreground: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = background;
    context.fillRect(0, 0, 128, 96);
    context.fillStyle = foreground;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "900 62px Segoe UI, sans-serif";
    context.fillText(text, 64, 50);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function BoardMarkers({ state }: { state: PublicState | null }) {
  const owners = useRef<(THREE.InstancedMesh | null)[]>([]);
  const badges = useMemo(
    () =>
      PLAYER_SYMBOLS.map((symbol, seat) =>
        markerTexture(symbol, PLAYER_COLORS[seat], "#fffaf0"),
      ),
    [],
  );
  const festivalBadges = useMemo(
    () =>
      Array.from({ length: 11 }, (_, multiplier) =>
        markerTexture(`×${multiplier}`, "#ffcf59", "#634711"),
      ),
    [],
  );
  const transform = useMemo(() => new THREE.Object3D(), []);
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
  const festivals = state
    ? [
        ...new Set([
          ...state.festivalTiles,
          ...(state.championshipHost ? [state.championshipHost.tile] : []),
        ]),
      ]
    : [];
  useEffect(() => {
    for (let seat = 0; seat < 4; seat++) {
      const mesh = owners.current[seat];
      if (!mesh) continue;
      let count = 0;
      for (const property of state?.properties ?? []) {
        if (property.owner !== seat) continue;
        const [x, z] = tilePosition(property.tile);
        if (BOARD[property.tile].kind === "city") {
          transform.position.set(x - 0.2, 0.691, z - 0.203);
          transform.rotation.set(0, 0, 0);
          transform.scale.set(0.18, 0.14, 1);
        } else {
          transform.position.set(x - 0.26, 0.337, z + 0.1);
          transform.rotation.set(-Math.PI / 2, 0, 0);
          transform.scale.set(0.26, 0.2, 1);
        }
        transform.updateMatrix();
        mesh.setMatrixAt(count, transform.matrix);
        count += 1;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [state, transform]);
  useEffect(
    () => () => {
      for (const texture of [...badges, ...festivalBadges]) texture.dispose();
      starGeometry.dispose();
    },
    [badges, festivalBadges, starGeometry],
  );
  return (
    <>
      {badges.map((texture, seat) => (
        <instancedMesh
          key={PLAYER_SYMBOLS[seat]}
          ref={(mesh) => {
            owners.current[seat] = mesh;
          }}
          args={[undefined, undefined, 24]}
        >
          <planeGeometry />
          <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
        </instancedMesh>
      ))}
      {festivals.map((index) => {
        const [x, z] = tilePosition(index);
        const multiplier =
          (state?.festivalTiles.includes(index) ? 2 : 1) *
          (state?.championshipHost?.tile === index
            ? state.championshipHost.multiplier
            : 1);
        return (
          <group key={index} position={[x + 0.28, 0.39, z + 0.12]}>
            <mesh position={[0, 0.17, 0]} castShadow>
              <cylinderGeometry args={[0.018, 0.018, 0.35, 6]} />
              <meshStandardMaterial color="#bc8b30" />
            </mesh>
            <mesh
              position={[0, 0.38, 0]}
              rotation={[-Math.PI / 5, Math.PI / 4, 0]}
            >
              <planeGeometry args={[0.38, 0.28]} />
              <meshBasicMaterial
                map={festivalBadges[Math.min(10, multiplier)]}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh
              geometry={starGeometry}
              position={[0, 0.59, 0]}
              rotation={[-Math.PI / 5, Math.PI / 4, 0]}
            >
              <meshStandardMaterial
                color="#ffdc6e"
                emissive="#664a12"
                emissiveIntensity={0.1}
              />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function Palm({
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
            Math.cos(leaf * 1.257) * 0.13,
            0.7,
            Math.sin(leaf * 1.257) * 0.13,
          ]}
          rotation={[0.3, leaf * 1.257, 0.45]}
          castShadow
        >
          <sphereGeometry args={[0.2, 5, 4]} />
          <meshStandardMaterial color={leaf % 2 ? "#559653" : "#7bb64d"} />
        </mesh>
      ))}
    </group>
  );
}

function CenterIsland() {
  const sign = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#173b45";
      context.textAlign = "center";
      context.font = "900 128px Trebuchet MS, sans-serif";
      context.fillText("POLYTOUR", 512, 144);
      context.font = "500 35px Segoe UI, sans-serif";
      context.fillStyle = "#3b777b";
      context.fillText("LE MONDE EST À VOUS", 512, 206);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  useEffect(() => () => sign.dispose(), [sign]);
  return (
    <group>
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[7.38, 0.15, 7.38]} />
        <meshStandardMaterial color="#74c9ca" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.245, -0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.08, 2.16, 48]} />
        <meshBasicMaterial color="#a8dfd7" />
      </mesh>
      <mesh
        position={[0.2, 0.24, -0.2]}
        scale={[1.65, 0.22, 1.35]}
        castShadow
        receiveShadow
      >
        <sphereGeometry args={[1, 16, 8]} />
        <meshStandardMaterial color="#efd5a0" />
      </mesh>
      <mesh position={[0.3, 0.32, -0.35]} scale={[1.2, 0.15, 1]} receiveShadow>
        <sphereGeometry args={[1, 16, 8]} />
        <meshStandardMaterial color="#a5bf6a" />
      </mesh>
      <group position={[0.9, 0.47, -1.04]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.22, 1.1, 12]} />
          <meshStandardMaterial color="#fff8e9" />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.19, 0.21, 0.19, 12]} />
          <meshStandardMaterial color="#e95131" />
        </mesh>
        <mesh position={[0, 1.12, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.17, 0.23, 8]} />
          <meshStandardMaterial color="#31576a" />
        </mesh>
        <mesh position={[0, 1.32, 0]} castShadow>
          <coneGeometry args={[0.25, 0.24, 8]} />
          <meshStandardMaterial color="#e95131" />
        </mesh>
      </group>
      <Palm position={[-0.8, 0.41, -0.55]} scale={1.15} />
      <Palm position={[-0.35, 0.4, 0.15]} scale={0.8} />
      <Palm position={[1.05, 0.32, 0.6]} scale={0.65} />
      <group position={[-0.05, 0.34, 0.8]}>
        <mesh rotation={[0, -0.12, 0]} receiveShadow>
          <boxGeometry args={[0.65, 0.08, 1.2]} />
          <meshStandardMaterial color="#ae8154" />
        </mesh>
        <mesh
          position={[-0.57, -0.025, 0.55]}
          rotation={[0, 0.3, 0]}
          castShadow
        >
          <capsuleGeometry args={[0.16, 0.45, 3, 8]} />
          <meshStandardMaterial color="#f4f3e1" />
        </mesh>
      </group>
      <mesh position={[0, 0.26, -2.55]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4.6, 1.15]} />
        <meshBasicMaterial map={sign} transparent depthWrite={false} />
      </mesh>
      {[5, 12, 21, 28].map((index) => {
        const [x, z] = tilePosition(index);
        return <Palm key={index} position={[x, 0.34, z - 0.12]} scale={0.65} />;
      })}
    </group>
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
  position,
}: {
  groupRef: (group: THREE.Group | null) => void;
  position: [number, number, number];
}) {
  return (
    <group ref={groupRef} position={position}>
      <mesh castShadow>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color="#fffdf2" roughness={0.38} />
      </mesh>
      {DIE_FACES.map((face) => (
        <group
          key={face.value}
          position={face.position}
          rotation={face.rotation}
        >
          {PIP_COORDINATES[face.value].map(([x, y]) => (
            <mesh key={`${x}-${y}`} position={[x * 0.15, y * 0.15, 0]}>
              <circleGeometry args={[0.045, 12]} />
              <meshBasicMaterial color="#173b45" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Pawn({
  seat,
  groupRef,
}: {
  seat: Seat;
  groupRef: (group: THREE.Group | null) => void;
}) {
  const [x, z] = tilePosition(0);
  const [offsetX, offsetZ] = pawnOffset(seat);
  return (
    <group ref={groupRef} position={[x + offsetX, 0.38, z + offsetZ]}>
      <mesh position={[0, 0.015, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.18, 0.08, 16]} />
        <meshStandardMaterial color="#fff7dc" />
      </mesh>
      <mesh position={[0, 0.17, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.14, 0.3, 12]} />
        <meshStandardMaterial color={PLAYER_COLORS[seat]} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.37, 0]} castShadow>
        <sphereGeometry args={[0.12, 12, 8]} />
        <meshStandardMaterial color={PLAYER_COLORS[seat]} roughness={0.38} />
      </mesh>
      <mesh
        position={[0, 0.52, 0]}
        rotation={seat === 1 ? [0, 0, Math.PI / 4] : [0, 0, 0]}
      >
        {seat === 0 ? (
          <sphereGeometry args={[0.042, 8, 6]} />
        ) : seat === 2 ? (
          <coneGeometry args={[0.065, 0.09, 3]} />
        ) : (
          <boxGeometry args={[0.07, 0.07, 0.07]} />
        )}
        <meshStandardMaterial color="#fff7dc" />
      </mesh>
    </group>
  );
}

function SceneContent(props: BoardProps) {
  const { state, preview, zoom = 1 } = props;
  const { camera, invalidate, size, gl } = useThree();
  const pawns = useRef<(THREE.Group | null)[]>([]);
  const dice = useRef<(THREE.Group | null)[]>([]);
  const timelines = useRef(new Map<gsap.core.Timeline, () => void>());
  const pulse = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const narrow = size.width / size.height < 1;
    camera.position.set(
      narrow ? 11.2 : 10.8,
      narrow ? 16 : 13.2,
      narrow ? 14 : 13.8,
    );
    camera.lookAt(0, 0, 0.3);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.zoom = zoom * (narrow ? 0.94 : 1.17);
      camera.updateProjectionMatrix();
    }
    invalidate();
  }, [camera, size.width, size.height, zoom, invalidate]);
  useEffect(() => {
    if (preview) return;
    function snap(next: PublicState | null) {
      for (const player of next?.players ?? []) {
        const pawn = pawns.current[player.seat];
        if (!pawn) continue;
        const [x, z] = tilePosition(player.position);
        const [offsetX, offsetZ] = pawnOffset(player.seat);
        pawn.position.set(x + offsetX, 0.38, z + offsetZ);
        pawn.scale.set(1, 1, 1);
        pawn.visible = !player.bankrupt;
      }
      for (let index = 0; index < 2; index++) {
        const die = dice.current[index];
        if (!die) continue;
        const rotation = diceRotation(next?.lastRoll?.dice[index] ?? index + 1);
        die.rotation.set(rotation[0], rotation[1], rotation[2]);
        die.position.set(index ? 0.49 : -0.49, 0.59, 2.5);
      }
      invalidate();
    }
    function cancel() {
      for (const [timeline, done] of timelines.current) {
        timeline.kill();
        done();
      }
      timelines.current.clear();
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
    return director.register({
      snap,
      cancel,
      animate: async (event, context) => {
        if (context.reducedMotion) {
          snap(context.next);
          return;
        }
        if (event.type === "DiceRolled") {
          await play((timeline) => {
            for (let index = 0; index < 2; index++) {
              const die = dice.current[index];
              if (!die) continue;
              const target = diceRotation(event.dice[index]);
              timeline.to(
                die.position,
                { y: 1.9, z: 2.15, duration: 0.3, ease: "power2.out" },
                index * 0.04,
              );
              timeline.to(
                die.rotation,
                {
                  x: target[0] + Math.PI * 4,
                  y: target[1] + Math.PI * 4,
                  z: target[2] + Math.PI * 2,
                  duration: 0.9,
                  ease: "power2.out",
                },
                index * 0.04,
              );
              timeline.to(
                die.position,
                { y: 0.59, z: 2.5, duration: 0.65, ease: "bounce.out" },
                0.3 + index * 0.04,
              );
            }
          }, context);
        } else if (event.type === "PlayerMoved") {
          const pawn = pawns.current[event.seat];
          if (!pawn) return;
          const before = context.previous?.players.find(
            (player) => player.seat === event.seat,
          );
          const from = event.from ?? before?.position ?? 0;
          const steps = event.steps ?? (event.position - from + 32) % 32;
          const [offsetX, offsetZ] = pawnOffset(event.seat);
          await play((timeline) => {
            if (Math.abs(steps) > 16 || steps === 0) {
              const [x, z] = tilePosition(event.position);
              timeline.to(pawn.position, {
                x: x + offsetX,
                z: z + offsetZ,
                y: 1.4,
                duration: 0.35,
                ease: "power2.inOut",
              });
              timeline.to(pawn.position, {
                y: 0.38,
                duration: 0.24,
                ease: "bounce.out",
              });
            } else {
              const duration = DECISION_TIMING.stepAnimation / 1000;
              for (let step = 1; step <= Math.abs(steps); step++) {
                const [x, z] = tilePosition(
                  (((from + step * Math.sign(steps)) % 32) + 32) % 32,
                );
                const at = (step - 1) * duration;
                timeline.to(
                  pawn.position,
                  { x: x + offsetX, z: z + offsetZ, duration, ease: "none" },
                  at,
                );
                timeline.to(
                  pawn.position,
                  { y: 0.75, duration: duration * 0.47, ease: "power2.out" },
                  at,
                );
                timeline.to(
                  pawn.position,
                  { y: 0.38, duration: duration * 0.53, ease: "power2.in" },
                  at + duration * 0.47,
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
            await play((timeline) => {
              timeline.fromTo(
                pawn.position,
                { y: 1.7 },
                { y: 0.38, duration: 0.5, ease: "bounce.out" },
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
          const [x, z] = tilePosition(event.tile);
          ring.position.set(x, 0.34, z);
          ring.visible = true;
          await play((timeline) => {
            timeline.fromTo(
              ring.scale,
              { x: 0.1, y: 0.1, z: 0.1 },
              { x: 1.25, y: 1.25, z: 1.25, duration: 0.4, ease: "power2.out" },
            );
          }, context);
          ring.visible = false;
        }
      },
    });
  }, [preview, invalidate]);

  useEffect(() => {
    if (state || preview) invalidate();
  }, [state, preview, invalidate]);
  useEffect(() => {
    gl.setClearColor("#9fded2", 0);
  }, [gl]);
  return (
    <>
      <ambientLight intensity={1.25} />
      <hemisphereLight args={["#e9fbff", "#9b876b", 1.6]} />
      <directionalLight
        position={[-5, 10, 5]}
        intensity={3.2}
        color="#fff1d5"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-normalBias={0.035}
      />
      <mesh position={[0, -0.37, 0]} receiveShadow>
        <boxGeometry args={[200, 0.2, 200]} />
        <shadowMaterial opacity={0.12} />
      </mesh>
      <mesh position={[0, -0.055, 0]} receiveShadow castShadow>
        <boxGeometry args={[9.96, 0.46, 9.96]} />
        <meshStandardMaterial color="#debb85" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <boxGeometry args={[9.8, 0.18, 9.8]} />
        <meshStandardMaterial color="#fff7dd" roughness={0.75} />
      </mesh>
      <CenterIsland />
      <BoardTiles {...props} />
      <Towns state={state} preview={preview} />
      <BoardMarkers state={state} />
      {([0, 1, 2, 3] as const).map((seat) => (
        <Pawn
          key={seat}
          seat={seat}
          groupRef={(group) => {
            pawns.current[seat] = group;
          }}
        />
      ))}
      <Die
        position={[-0.49, 0.59, 2.5]}
        groupRef={(group) => {
          dice.current[0] = group;
        }}
      />
      <Die
        position={[0.49, 0.59, 2.5]}
        groupRef={(group) => {
          dice.current[1] = group;
        }}
      />
      <mesh ref={pulse} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.49, 24]} />
        <meshBasicMaterial
          color="#ffda72"
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </mesh>
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
    <div className="canvas-layer">
      <Canvas
        shadows
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [10.8, 13.2, 13.8], fov: 36, near: 0.1, far: 100 }}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
      >
        <SceneContent {...props} />
      </Canvas>
    </div>
  );
}
