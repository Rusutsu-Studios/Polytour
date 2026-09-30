import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BOARD, DECISION_TIMING } from "../../shared/board/index.js";
import type { PublicState, Seat } from "../../shared/engine/index.js";
import { getProperty, propertyRent } from "../../shared/engine/index.js";
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

// THESIS: A full-screen toy board; the player sits at the table, not beside a dashboard.
// OWN-WORLD: a sky-blue table, ivory city tiles, green lawn and owner-colored toy roofs.
// STORY: roll, travel, buy, collect; the board shows events, the server owns rules.
// FIRST VIEWPORT: a fixed diamond fills the screen, with four corner players and a small action below.
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

function tileTexture(index: number, amount: number | null, rented: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const tile = BOARD[index];
  context.clearRect(0, 0, 512, 512);
  context.fillStyle = tileColor(index);
  context.fillRect(8, 8, 496, 28);
  if (tile.kind === "city") {
    context.fillStyle = "#e6edcc";
    context.fillRect(60, 50, 390, 135);
    context.fillStyle = "#c5d6a6";
    context.fillRect(60, 177, 390, 8);
  }
  context.fillStyle = "#173b45";
  context.textAlign = "center";
  context.textBaseline = "middle";
  // Lettering is printed on the tile, aligned with the fixed diagonal camera.
  // It stays flat and cannot obscure neighboring destinations like a billboard.
  context.save();
  context.translate(300, 300);
  context.rotate(-Math.PI / 4);
  context.scale(1, 2.15);
  const name = TILE_NAMES[index];
  context.font = "900 72px Trebuchet MS, sans-serif";
  context.fillText(name, 0, -35, 410);
  context.font = "900 92px Trebuchet MS, sans-serif";
  context.fillText(
    amount === null ? TILE_ICONS[tile.kind] : money(amount),
    0,
    31,
    300,
  );
  if (amount !== null) {
    context.font = "700 23px Segoe UI, sans-serif";
    context.fillStyle = "#47666c";
    context.fillText(rented ? "LOYER" : "ACHAT", 0, 77);
  }
  context.restore();
  if (tile.kind !== "city" && tile.kind !== "resort") {
    context.fillStyle = tileColor(index);
    context.beginPath();
    context.arc(100, 100, 60, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#173b45";
    context.font = "900 104px Segoe UI, sans-serif";
    context.fillText(TILE_ICONS[tile.kind], 100, 105);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function TileFace({
  index,
  amount,
  rented,
  onSelect,
  preview,
}: {
  index: number;
  amount: number | null;
  rented: boolean;
  onSelect: (tile: number) => void;
  preview?: boolean;
}) {
  const texture = useMemo(
    () => tileTexture(index, amount, rented),
    [index, amount, rented],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const [x, z] = tilePosition(index);
  return (
    <mesh
      position={[x, 0.317, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(event) => {
        if (preview) return;
        event.stopPropagation();
        onSelect(index);
      }}
    >
      <planeGeometry args={[0.99, 0.99]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

function BoardTiles({ state, selected, onSelect, preview }: BoardProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(roundedTile, []);
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
    mesh.current.computeBoundingSphere();
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
  }, [state, selected, transforms, color]);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
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
        const property = state ? getProperty(state, tile.index) : null;
        const rented = property?.owner != null;
        return (
          <TileFace
            key={tile.index}
            index={tile.index}
            rented={rented}
            amount={
              rented && state
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

function Towns({ state, preview }: Pick<BoardProps, "state" | "preview">) {
  const walls = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);
  const windows = useRef<THREE.InstancedMesh>(null);
  const pole = useRef<THREE.InstancedMesh>(null);
  const flags = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const roofGeometry = useMemo(() => {
    const geometry = new THREE.ConeGeometry(0.25, 0.23, 4);
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
    let windowCount = 0;
    let flagCount = 0;
    const angle = Math.PI / 4;
    for (const tile of BOARD) {
      if (tile.kind !== "city") continue;
      const [x, z] = tilePosition(tile.index);
      const property = state ? getProperty(state, tile.index) : null;
      const owner = property?.owner;
      const level =
        owner != null
          ? (property?.level ?? 0)
          : preview
            ? 1 + (tile.index % 5)
            : 0;
      const roofColor =
        owner != null ? PLAYER_COLORS[owner] : tileColor(tile.index);
      const building = (
        localX: number,
        localZ: number,
        width: number,
        depth: number,
        height: number,
        base = 0.34,
        roofHeight = 0.16,
      ) => {
        localZ -= 0.24;
        const centerX = x + localX * Math.cos(angle) + localZ * Math.sin(angle);
        const centerZ = z - localX * Math.sin(angle) + localZ * Math.cos(angle);
        dummy.rotation.set(0, angle, 0);
        dummy.position.set(centerX, base + height / 2, centerZ);
        dummy.scale.set(width, height, depth);
        dummy.updateMatrix();
        walls.current?.setMatrixAt(count, dummy.matrix);
        walls.current?.setColorAt(count, color.set("#fffaf0"));
        dummy.position.y = base + height + roofHeight / 2;
        dummy.scale.set(width / 0.35, roofHeight / 0.23, depth / 0.35);
        dummy.updateMatrix();
        roofs.current?.setMatrixAt(count, dummy.matrix);
        roofs.current?.setColorAt(count, color.set(roofColor));
        count += 1;
        const rows = height > 0.45 ? 3 : height > 0.3 ? 2 : 1;
        for (let row = 0; row < rows; row++) {
          for (const front of [0, 1]) {
            const faceAngle = angle + (front * Math.PI) / 2;
            dummy.rotation.set(0, faceAngle, 0);
            dummy.position.set(
              centerX + Math.sin(faceAngle) * (front ? width : depth) * 0.505,
              base + (height * (row + 0.5)) / rows,
              centerZ + Math.cos(faceAngle) * (front ? width : depth) * 0.505,
            );
            dummy.scale.set(
              width * 0.56,
              Math.min(0.075, height * 0.28),
              0.009,
            );
            dummy.updateMatrix();
            windows.current?.setMatrixAt(windowCount, dummy.matrix);
            windowCount += 1;
          }
        }
      };
      // A bare plot, one/two/three separate houses, a hotel and a tiered monument.
      // These are geometry stages, so development is readable without a tooltip.
      if (level >= 1 && level <= 3) {
        const offsets =
          level === 1
            ? [[0, -0.22]]
            : level === 2
              ? [
                  [-0.15, -0.23],
                  [0.15, -0.23],
                ]
              : [
                  [-0.17, -0.28],
                  [0.17, -0.28],
                  [0, -0.05],
                ];
        for (const [localX, localZ] of offsets)
          building(localX, localZ, level === 1 ? 0.31 : 0.24, 0.25, 0.27);
      } else if (level === 4) {
        building(0, -0.22, 0.48, 0.33, 0.61, 0.34, 0.11);
        building(-0.23, -0.14, 0.19, 0.24, 0.24, 0.34, 0.1);
      } else if (level === 5) {
        building(0, -0.22, 0.47, 0.38, 0.37, 0.34, 0.05);
        building(0, -0.22, 0.32, 0.27, 0.43, 0.75, 0.18);
        building(0, -0.22, 0.13, 0.13, 0.3, 1.22, 0.21);
      }
      if (owner != null) {
        dummy.position.set(x - 0.31, 0.54, z - 0.2);
        dummy.rotation.set(0, angle, 0);
        dummy.scale.set(0.018, 0.43, 0.018);
        dummy.updateMatrix();
        pole.current.setMatrixAt(flagCount, dummy.matrix);
        dummy.position.set(x - 0.24, 0.69, z - 0.2);
        dummy.scale.set(0.2, 0.15, 0.025);
        dummy.updateMatrix();
        flags.current.setMatrixAt(flagCount, dummy.matrix);
        flags.current.setColorAt(flagCount, color.set(PLAYER_COLORS[owner]));
        flagCount += 1;
      }
    }
    walls.current.count = count;
    roofs.current.count = count;
    windows.current.count = windowCount;
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
      object.computeBoundingSphere();
    }
  }, [state, preview, dummy, color]);
  useEffect(() => () => roofGeometry.dispose(), [roofGeometry]);
  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, 96]} castShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh
        ref={roofs}
        args={[roofGeometry, undefined, 96]}
        castShadow
      >
        <meshStandardMaterial roughness={0.65} />
      </instancedMesh>
      <instancedMesh ref={windows} args={[undefined, undefined, 320]}>
        <boxGeometry />
        <meshStandardMaterial color="#2b637a" roughness={0.4} />
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
          transform.position.set(x - 0.24, 0.691, z - 0.188);
          transform.rotation.set(0, Math.PI / 4, 0);
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
      mesh.computeBoundingSphere();
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
        const multiplier = Math.max(
          state?.festivalTiles.includes(index) ? 2 : 1,
          state?.championshipHost?.tile === index
            ? state.championshipHost.multiplier
            : 1,
        );
        return (
          <group key={index} position={[x + 0.24, 0.39, z - 0.33]}>
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
          scale={[0.7, 0.2, 1.7]}
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
  const lawn = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#a5c957";
      context.fillRect(0, 0, 1024, 1024);
      // Broad cuts in the grass give the empty play area a tactile toy-board finish.
      for (let strip = -2; strip < 8; strip++) {
        context.fillStyle = strip % 2 ? "#badb72" : "#95b949";
        context.beginPath();
        context.moveTo(strip * 210, 0);
        context.lineTo(strip * 210 + 130, 0);
        context.lineTo(strip * 210 + 650, 1024);
        context.lineTo(strip * 210 + 520, 1024);
        context.closePath();
        context.fill();
      }
      for (let flower = 0; flower < 62; flower++) {
        const x = 55 + ((flower * 179) % 914);
        const y = 55 + ((flower * 293) % 914);
        context.fillStyle = flower % 3 ? "#d5e698" : "#f3efbc";
        context.beginPath();
        context.ellipse(x, y, flower % 3 ? 3.5 : 5, 2.7, 0, 0, Math.PI * 2);
        context.fill();
      }
      context.save();
      context.translate(430, 230);
      context.rotate(-Math.PI / 4);
      context.fillStyle = "#6b903e";
      context.textAlign = "center";
      context.font = "900 43px Trebuchet MS, sans-serif";
      context.fillText("POLYTOUR", 0, 0);
      context.font = "700 17px Segoe UI, sans-serif";
      context.fillText("LE GRAND TOUR", 0, 30);
      context.restore();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }, []);
  useEffect(() => () => lawn.dispose(), [lawn]);
  return (
    <group>
      <mesh position={[0, 0.2, 0]} receiveShadow>
        <boxGeometry args={[7.6, 0.08, 7.6]} />
        <meshStandardMaterial color="#7f979a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.235, 0]} receiveShadow>
        <boxGeometry args={[7.22, 0.05, 7.22]} />
        <meshStandardMaterial color="#dce7b5" />
      </mesh>
      <mesh
        position={[0, 0.264, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[7.13, 7.13]} />
        <meshStandardMaterial map={lawn} roughness={1} />
      </mesh>
      {[5, 12, 21, 28].map((index) => {
        const [x, z] = tilePosition(index);
        return (
          <group key={index} position={[x - 0.32, 0.34, z - 0.32]} scale={0.65}>
            <mesh position={[0, -0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.32, 20]} />
              <meshBasicMaterial color="#67cbe3" />
            </mesh>
            <mesh
              position={[-0.08, 0.007, 0.06]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <circleGeometry args={[0.22, 16]} />
              <meshBasicMaterial color="#ffe4a3" />
            </mesh>
            <Palm position={[-0.07, 0.01, -0.05]} scale={0.84} />
            <Palm position={[0.15, 0.01, -0.13]} scale={0.54} />
            <mesh position={[0.13, 0.09, 0.09]} castShadow>
              <cylinderGeometry args={[0.13, 0.01, 0.07, 8]} />
              <meshStandardMaterial color="#ffcb55" />
            </mesh>
            <mesh position={[0.13, 0.041, 0.09]}>
              <cylinderGeometry args={[0.007, 0.007, 0.11, 6]} />
              <meshStandardMaterial color="#fffaf0" />
            </mesh>
          </group>
        );
      })}
      {/* Original stadium and aircraft make the special corners readable as toys. */}
      <group position={[4.01, 0.33, -4.64]} rotation={[0, Math.PI / 4, 0]}>
        <mesh scale={[1, 0.38, 0.7]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.27, 0.085, 5, 14]} />
          <meshStandardMaterial color="#f3efe6" />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026, 0]}>
          <circleGeometry args={[0.2, 14]} />
          <meshStandardMaterial color="#80ac49" />
        </mesh>
      </group>
      <group
        position={[-4.62, 0.41, -4.62]}
        rotation={[Math.PI / 2, 0, Math.PI / 4]}
      >
        <mesh castShadow>
          <capsuleGeometry args={[0.055, 0.37, 3, 8]} />
          <meshStandardMaterial color="#fffaf0" />
        </mesh>
        <mesh
          rotation={[0, 0, Math.PI / 2]}
          position={[0, 0.025, 0]}
          castShadow
        >
          <boxGeometry args={[0.05, 0.44, 0.1]} />
          <meshStandardMaterial color="#236cce" />
        </mesh>
        <mesh position={[0, -0.15, 0]}>
          <boxGeometry args={[0.21, 0.06, 0.045]} />
          <meshStandardMaterial color="#236cce" />
        </mesh>
      </group>
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
    <group ref={groupRef} position={position} scale={1.25}>
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

// A small rear lane keeps the pawn's base off the printed name and amount.
// Every hop and snapshot uses this same visual offset; the board index stays authoritative.
function scenePawnOffset(seat: Seat): [number, number] {
  const [x, z] = pawnOffset(seat);
  return [x * 0.65 + 0.02, z * 0.65 - 0.36];
}

function Pawn({
  seat,
  groupRef,
}: {
  seat: Seat;
  groupRef: (group: THREE.Group | null) => void;
}) {
  const [x, z] = tilePosition(0);
  const [offsetX, offsetZ] = scenePawnOffset(seat);
  const color = PLAYER_COLORS[seat];
  return (
    <group ref={groupRef} position={[x + offsetX, 0.38, z + offsetZ]}>
      <group rotation={[0, Math.PI / 4, 0]}>
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
        <mesh position={[0, 0.3, 0.137]}>
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
function SceneContent(props: BoardProps) {
  const { state, preview, zoom = 1 } = props;
  const { camera, invalidate, size, gl } = useThree();
  const pawns = useRef<(THREE.Group | null)[]>([]);
  const dice = useRef<(THREE.Group | null)[]>([]);
  const timelines = useRef(new Map<gsap.core.Timeline, () => void>());
  const pulse = useRef<THREE.Mesh>(null);
  const rendered = useRef(false);

  useEffect(() => {
    const aspect = size.width / size.height;
    const narrow = aspect < 1;
    const pitch = narrow ? 0.7 : aspect > 1.7 ? 0.52 : 0.6;
    camera.position.set(13, Math.hypot(13, 13) * pitch, 13);
    camera.lookAt(0, 0.28, 0);
    camera.updateMatrixWorld();
    if (camera instanceof THREE.OrthographicCamera) {
      const bounds = new THREE.Box3();
      for (const x of [-5.03, 5.03])
        for (const z of [-5.03, 5.03])
          for (const y of [-0.3, 0.65]) {
            bounds.expandByPoint(
              new THREE.Vector3(x, y, z).applyMatrix4(
                camera.matrixWorldInverse,
              ),
            );
          }
      for (const tile of BOARD) {
        const [x, z] = tilePosition(tile.index);
        bounds.expandByPoint(
          new THREE.Vector3(
            x,
            tile.kind === "city" ? 1.82 : 0.95,
            z,
          ).applyMatrix4(camera.matrixWorldInverse),
        );
      }
      const width = bounds.max.x - bounds.min.x;
      const height = bounds.max.y - bounds.min.y;
      const halfHeight = Math.max(
        height / (preview ? 1.72 : 1.64),
        width / (aspect * (narrow ? 1.83 : 1.8)),
      );
      // Leave a little sky above and room for the compact action at the bottom.
      const centerY =
        (bounds.min.y + bounds.max.y) / 2 - (preview ? 0 : halfHeight * 0.075);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = centerY + halfHeight;
      camera.bottom = centerY - halfHeight;
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    invalidate();
  }, [camera, size.width, size.height, zoom, preview, invalidate]);
  useEffect(() => {
    if (preview) return;
    function snap(next: PublicState | null) {
      for (const player of next?.players ?? []) {
        const pawn = pawns.current[player.seat];
        if (!pawn) continue;
        const [x, z] = tilePosition(player.position);
        const [offsetX, offsetZ] = scenePawnOffset(player.seat);
        pawn.position.set(x + offsetX, 0.38, z + offsetZ);
        pawn.scale.set(1, 1, 1);
        pawn.visible = !player.bankrupt;
      }
      for (let index = 0; index < 2; index++) {
        const die = dice.current[index];
        if (!die) continue;
        const rotation = diceRotation(next?.lastRoll?.dice[index] ?? index + 1);
        die.rotation.set(rotation[0], rotation[1], rotation[2]);
        die.position.set(index ? 0.65 : -0.65, 0.66, 0.85);
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
                { y: 2.0, z: 0.3, duration: 0.3, ease: "power2.out" },
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
                { y: 0.66, z: 0.85, duration: 0.65, ease: "bounce.out" },
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
          const [offsetX, offsetZ] = scenePawnOffset(event.seat);
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
    gl.setClearColor("#75d4ed", 0);
  }, [gl]);
  return (
    <>
      <ambientLight intensity={0.8} />
      <hemisphereLight args={["#e9fbff", "#a4a474", 1.25]} />
      <directionalLight
        position={[-5, 10, 5]}
        intensity={2.2}
        color="#fff1d5"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-normalBias={0.035}
        shadow-radius={3}
      />
      <mesh position={[0, -0.37, 0]} receiveShadow>
        <boxGeometry args={[200, 0.2, 200]} />
        <shadowMaterial opacity={0.12} />
      </mesh>
      <mesh
        position={[0, -0.055, 0]}
        receiveShadow
        castShadow
        onAfterRender={() => {
          if (rendered.current) return;
          rendered.current = true;
          gl.domElement.dataset.sceneReady = "true";
          gl.domElement
            .closest(".canvas-layer")
            ?.setAttribute("data-scene-ready", "true");
        }}
      >
        <boxGeometry args={[9.96, 0.46, 9.96]} />
        <meshStandardMaterial color="#c6b394" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <boxGeometry args={[9.8, 0.18, 9.8]} />
        <meshStandardMaterial color="#fffaf0" roughness={0.75} />
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
        position={[-0.65, 0.66, 0.85]}
        groupRef={(group) => {
          dice.current[0] = group;
        }}
      />
      <Die
        position={[0.65, 0.66, 0.85]}
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
    <div className="canvas-layer" data-scene-ready="false">
      <Canvas
        orthographic
        shadows
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [13, 11, 13], near: 0.1, far: 100, zoom: 1 }}
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
