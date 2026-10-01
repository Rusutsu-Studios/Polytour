import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BOARD, DECISION_TIMING } from "../../shared/board/index.js";
import type {
  GameEvent,
  PublicState,
  Seat,
} from "../../shared/engine/index.js";
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

// THESIS: A readable printed game board, with small low-poly pieces above its track.
// OWN-WORLD: lilac paper tiles, a quiet lawn, clear dark amounts and colored gabled roofs.
// STORY: roll, travel, buy, collect; the board shows events, the server owns rules.
// FIRST VIEWPORT: a fixed diamond fills the screen, with four corner players and a small action below.
// FORM: the user's pinned tabletop reference; shallow edges, separated print and buildings.

function tileAngle(index: number) {
  return (index > 8 && index < 16) || index > 24 ? Math.PI / 2 : 0;
}

function tileLocalPosition(index: number, localX: number, localZ: number) {
  const [x, z] = tilePosition(index);
  const angle = tileAngle(index);
  return [
    x + localX * Math.cos(angle) + localZ * Math.sin(angle),
    z - localX * Math.sin(angle) + localZ * Math.cos(angle),
  ] as const;
}

function tileDepth(index: number) {
  return index % 8 === 0 ? 1.035 : 1.15;
}

function tileTexture(index: number, amount: number | null, rented: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 640;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const tile = BOARD[index];
  context.clearRect(0, 0, 512, 640);
  context.fillStyle = tile.kind === "resort" ? "#fff1d5" : "#f1eef2";
  context.fillRect(0, 0, 512, 640);
  if (tile.kind === "city") {
    context.fillStyle = "#d9e7bb";
    context.fillRect(14, 12, 484, 230);
    context.fillStyle = tileColor(index);
    context.fillRect(14, 12, 484, 15);
  }
  context.fillStyle = "#253641";
  context.textAlign = "center";
  context.textBaseline = "middle";
  // Each side reads along the track. The upper band belongs to the buildings;
  // the city and its amount always keep their own unoccluded printed area.
  context.save();
  context.translate(256, 432);
  context.scale(1, 1.7);
  const name = TILE_NAMES[index];
  context.font = "900 68px Arial, sans-serif";
  context.fillText(
    name.toLocaleUpperCase("fr"),
    0,
    amount === null ? -15 : -75,
    474,
  );
  if (amount !== null) {
    context.font = "900 130px Arial, sans-serif";
    context.fillText(money(amount), 0, 35, 450);
    context.font = "700 18px Segoe UI, sans-serif";
    context.fillStyle = "#4b5c62";
    context.fillText(rented ? "LOYER" : "ACHAT", 0, 109);
  }
  context.restore();
  if (tile.kind !== "city" && tile.kind !== "resort") {
    const colors = [
      "#e95d75",
      "#efb840",
      "#55a881",
      "#47a5c8",
      "#9369bc",
      "#f08945",
    ];
    if (tile.kind === "chance") {
      for (let wedge = 0; wedge < 6; wedge++) {
        context.fillStyle = colors[wedge];
        context.beginPath();
        context.moveTo(256, 178);
        context.arc(
          256,
          178,
          116,
          (wedge * Math.PI) / 3,
          ((wedge + 1) * Math.PI) / 3,
        );
        context.closePath();
        context.fill();
      }
      context.fillStyle = "#fffaf0";
      context.beginPath();
      context.arc(256, 178, 34, 0, Math.PI * 2);
      context.fill();
    } else {
      context.fillStyle = tile.kind === "tax" ? "#dbc7d7" : "#d7e6bd";
      context.fillRect(14, 12, 484, 256);
      context.fillStyle = "#36516a";
      context.font = "900 138px Segoe UI, sans-serif";
      context.fillText(TILE_ICONS[tile.kind], 256, 159);
    }
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
      rotation={[-Math.PI / 2, 0, tileAngle(index)]}
      onPointerDown={(event) => {
        if (preview) return;
        event.stopPropagation();
        onSelect(index);
      }}
    >
      <planeGeometry args={[1.035, tileDepth(index)]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}

function BoardTiles({ state, selected, onSelect, preview }: BoardProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1.035, 0.075, 1), []);
  const transforms = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    if (!mesh.current) return;
    for (const tile of BOARD) {
      const [x, z] = tilePosition(tile.index);
      transforms.position.set(x, 0.278, z);
      transforms.rotation.set(0, tileAngle(tile.index), 0);
      transforms.scale.set(1, 1, tileDepth(tile.index));
      transforms.updateMatrix();
      mesh.current.setMatrixAt(tile.index, transforms.matrix);
      const owner = state ? getProperty(state, tile.index)?.owner : null;
      color.set(
        tile.index === selected
          ? "#ffda72"
          : owner != null
            ? PLAYER_COLORS[owner]
            : "#d3cbd7",
      );
      if (owner != null && tile.index !== selected)
        color.lerp(new THREE.Color("#d3cbd7"), 0.82);
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
        <meshStandardMaterial roughness={1} />
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

function TileFocus({ state, selected, preview }: BoardProps) {
  const outline = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.5, 0.5);
    shape.lineTo(-0.5, 0.5);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.455, -0.455);
    hole.lineTo(-0.455, 0.455);
    hole.lineTo(0.455, 0.455);
    hole.lineTo(0.455, -0.455);
    hole.closePath();
    shape.holes.push(hole);
    return new THREE.ShapeGeometry(shape);
  }, []);
  useEffect(() => () => outline.dispose(), [outline]);
  if (preview) return null;
  const pending = state?.pending;
  const decisionTile = pending && "tile" in pending ? pending.tile : null;
  return (
    <>
      {[decisionTile, selected].map((tile, index) => {
        if (tile == null || (index === 1 && tile === decisionTile)) return null;
        const [x, z] = tilePosition(tile);
        return (
          <mesh
            key={index === 0 ? "decision" : "inspection"}
            geometry={outline}
            position={[x, 0.323, z]}
            rotation={[-Math.PI / 2, 0, tileAngle(tile)]}
            scale={[1.045, tileDepth(tile), 1]}
          >
            <meshBasicMaterial
              color={
                index === 0 && pending ? PLAYER_COLORS[pending.seat] : "#db9e25"
              }
            />
          </mesh>
        );
      })}
    </>
  );
}

function Towns({ state, preview }: Pick<BoardProps, "state" | "preview">) {
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
  useEffect(() => {
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
      const angle = tileAngle(tile.index);
      const building = (
        localX: number,
        width: number,
        height: number,
        depth = 0.24,
      ) => {
        const [x, z] = tileLocalPosition(tile.index, localX, -0.35);
        const base = 0.324;
        dummy.rotation.set(0, angle, 0);
        dummy.position.set(x, base + height / 2, z);
        dummy.scale.set(width, height, depth);
        dummy.updateMatrix();
        walls.current?.setMatrixAt(count, dummy.matrix);
        walls.current?.setColorAt(count, color.set("#fffaf4"));
        dummy.position.y = base + height;
        dummy.scale.set(
          width + 0.045,
          level >= 4 ? 0.12 : 0.105,
          depth + 0.045,
        );
        dummy.updateMatrix();
        roofs.current?.setMatrixAt(count, dummy.matrix);
        roofs.current?.setColorAt(count, color.set(roofColor));
        count += 1;
        // One owner-colored footing and simple front windows: the roof silhouette
        // identifies a house, while the body height identifies hotels/monuments.
        dummy.position.y = base + 0.018;
        dummy.scale.set(width + 0.025, 0.036, depth + 0.025);
        dummy.updateMatrix();
        details.current?.setMatrixAt(detailCount, dummy.matrix);
        details.current?.setColorAt(detailCount, color.set(roofColor));
        detailCount += 1;
        const rows = height > 0.35 ? 3 : 1;
        for (let row = 0; row < rows; row++) {
          for (const column of [-1, 1]) {
            const [windowX, windowZ] = tileLocalPosition(
              tile.index,
              localX + column * width * 0.22,
              -0.35 + depth * 0.505,
            );
            dummy.position.set(
              windowX,
              base + (height * (row + 0.5)) / rows,
              windowZ,
            );
            dummy.scale.set(width * 0.22, Math.min(0.07, height * 0.34), 0.009);
            dummy.updateMatrix();
            windows.current?.setMatrixAt(windowCount++, dummy.matrix);
          }
        }
      };
      if (level >= 1 && level <= 3) {
        const offsets =
          level === 1 ? [0] : level === 2 ? [-0.18, 0.18] : [-0.3, 0, 0.3];
        for (const x of offsets) building(x, level === 1 ? 0.27 : 0.235, 0.2);
      } else if (level === 4) {
        building(0, 0.44, 0.41, 0.27);
        building(-0.31, 0.14, 0.18);
        building(0.31, 0.14, 0.18);
      } else if (level === 5) {
        building(0, 0.53, 0.53, 0.29);
        building(-0.32, 0.12, 0.28);
        building(0.32, 0.12, 0.28);
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
  }, [state, preview, dummy, color]);
  useEffect(() => () => roofGeometry.dispose(), [roofGeometry]);
  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, 96]} castShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh
        ref={roofs}
        args={[roofGeometry, undefined, 96]}
        castShadow
      >
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh ref={windows} args={[undefined, undefined, 320]}>
        <boxGeometry />
        <meshBasicMaterial color="#334759" />
      </instancedMesh>
      <instancedMesh ref={details} args={[undefined, undefined, 96]} castShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={1} />
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
        const [x, z] = tileLocalPosition(property.tile, -0.4, 0.44);
        transform.position.set(x, 0.322, z);
        transform.rotation.set(-Math.PI / 2, 0, tileAngle(property.tile));
        transform.scale.set(0.14, 0.105, 1);
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
        const [x, z] = tileLocalPosition(index, 0.41, -0.45);
        const multiplier = Math.max(
          state?.festivalTiles.includes(index) ? 2 : 1,
          state?.championshipHost?.tile === index
            ? state.championshipHost.multiplier
            : 1,
        );
        return (
          <group key={index} position={[x, 0.325, z]}>
            <mesh position={[0, 0.15, 0]} castShadow>
              <cylinderGeometry args={[0.009, 0.009, 0.3, 6]} />
              <meshStandardMaterial color="#bc8b30" />
            </mesh>
            <mesh position={[0, 0.31, 0]} rotation={[0, Math.PI / 4, 0]}>
              <planeGeometry args={[0.25, 0.16]} />
              <meshBasicMaterial
                map={festivalBadges[Math.min(10, multiplier)]}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh
              geometry={starGeometry}
              position={[0, 0.45, 0]}
              rotation={[0, Math.PI / 4, 0]}
              scale={0.55}
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
      context.fillStyle = "#b5cf72";
      context.fillRect(0, 0, 1024, 1024);
      // Soft, broad lawn patches leave the center quiet for dice and money.
      for (let patch = 0; patch < 6; patch++) {
        context.fillStyle = patch % 2 ? "#c0d780" : "#afc969";
        context.beginPath();
        context.moveTo(patch * 240 - 250, 0);
        context.lineTo(patch * 240 - 90, 0);
        context.lineTo(patch * 240 + 420, 1024);
        context.lineTo(patch * 240 + 260, 1024);
        context.closePath();
        context.fill();
      }
      for (let flower = 0; flower < 18; flower++) {
        const x = 80 + ((flower * 179) % 864);
        const y = 80 + ((flower * 293) % 864);
        context.fillStyle = "#d6e5a1";
        context.beginPath();
        context.ellipse(x, y, 4, 2.6, 0, 0, Math.PI * 2);
        context.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }, []);
  const road = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#83908e";
      context.fillRect(0, 0, 512, 512);
      context.strokeStyle = "#dce1cf";
      context.lineWidth = 2;
      context.setLineDash([8, 8]);
      context.strokeRect(6, 6, 500, 500);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  useEffect(
    () => () => {
      lawn.dispose();
      road.dispose();
    },
    [lawn, road],
  );
  return (
    <group>
      <mesh
        position={[0, 0.308, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[7.52, 7.52]} />
        <meshBasicMaterial map={road} />
      </mesh>
      <mesh
        position={[0, 0.311, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[7.2, 7.2]} />
        <meshStandardMaterial map={lawn} roughness={1} />
      </mesh>
      {[5, 12, 21, 28].map((index) => {
        const [x, z] = tileLocalPosition(index, 0, -0.35);
        return (
          <group
            key={index}
            position={[x, 0.325, z]}
            scale={0.48}
            rotation={[0, tileAngle(index), 0]}
          >
            <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.37, 16]} />
              <meshBasicMaterial color="#eedca6" />
            </mesh>
            <Palm position={[-0.12, 0.01, -0.04]} scale={0.66} />
            <mesh position={[0.16, 0.12, 0.05]} castShadow>
              <cylinderGeometry args={[0.2, 0.025, 0.1, 6]} />
              <meshStandardMaterial color="#f3ba4b" roughness={1} />
            </mesh>
            <mesh position={[0.16, 0.065, 0.05]}>
              <cylinderGeometry args={[0.012, 0.012, 0.13, 5]} />
              <meshStandardMaterial color="#fffaf0" />
            </mesh>
          </group>
        );
      })}
      <group position={[4.32, 0.325, -4.65]}>
        <mesh
          scale={[1.15, 0.38, 0.72]}
          rotation={[-Math.PI / 2, 0, 0]}
          castShadow
        >
          <torusGeometry args={[0.28, 0.09, 4, 12]} />
          <meshStandardMaterial color="#eadde9" roughness={1} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
          <circleGeometry args={[0.2, 12]} />
          <meshStandardMaterial color="#88b456" roughness={1} />
        </mesh>
      </group>
      <group
        position={[-4.32, 0.365, -4.65]}
        rotation={[Math.PI / 2, 0, Math.PI / 4]}
      >
        <mesh castShadow>
          <capsuleGeometry args={[0.05, 0.36, 2, 6]} />
          <meshStandardMaterial color="#fffaf0" roughness={1} />
        </mesh>
        <mesh
          rotation={[0, 0, Math.PI / 2]}
          position={[0, 0.025, 0]}
          castShadow
        >
          <boxGeometry args={[0.055, 0.42, 0.08]} />
          <meshStandardMaterial color="#3481c3" roughness={1} />
        </mesh>
        <mesh position={[0, -0.15, 0]}>
          <boxGeometry args={[0.19, 0.05, 0.04]} />
          <meshStandardMaterial color="#3481c3" roughness={1} />
        </mesh>
      </group>
      <group position={[4.32, 0.325, 4.04]} scale={0.54}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.48, 16]} />
          <meshBasicMaterial color="#68b7cb" />
        </mesh>
        <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.3, 12]} />
          <meshBasicMaterial color="#f1dba3" />
        </mesh>
        <Palm position={[0, 0.01, 0]} scale={0.62} />
      </group>
      <group position={[-4.32, 0.325, 3.98]}>
        <mesh position={[-0.12, 0.17, 0]}>
          <cylinderGeometry args={[0.011, 0.011, 0.34, 5]} />
          <meshStandardMaterial color="#fffaf0" />
        </mesh>
        <mesh position={[0.01, 0.29, 0]} rotation={[0, Math.PI / 4, 0]}>
          <planeGeometry args={[0.24, 0.14]} />
          <meshBasicMaterial color="#639247" side={THREE.DoubleSide} />
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
function scenePawnOffset(seat: Seat, tile = 0): [number, number] {
  const [x, z] = pawnOffset(seat);
  // Walk on the inner edge of the track. Pawns never stand on printed amounts
  // or inside a house, including when several players share a destination.
  if (tile % 8 === 0) {
    const [tileX, tileZ] = tilePosition(tile);
    return [
      -Math.sign(tileX) * 0.88 + x * 0.65,
      -Math.sign(tileZ) * 0.88 + z * 0.65,
    ];
  }
  if (tile < 8) return [x * 0.65, -1.26 + z * 0.35];
  if (tile < 16) return [-1.26 + x * 0.35, z * 0.65];
  if (tile < 24) return [x * 0.65, 1.26 + z * 0.35];
  return [1.26 + x * 0.35, z * 0.65];
}

function PawnPositions({ state }: { state: PublicState | null }) {
  const paths = useRef<THREE.InstancedMesh>(null);
  const pins = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    if (!paths.current || !pins.current) return;
    let count = 0;
    for (const player of state?.players ?? []) {
      if (player.bankrupt) continue;
      const [x, z] = tilePosition(player.position);
      const [dx, dz] = scenePawnOffset(player.seat, player.position);
      const start = player.position % 8 === 0 ? 0.75 : 0.55;
      const length = Math.hypot(dx, dz) * (1 - start);
      color.set(PLAYER_COLORS[player.seat]);
      transform.position.set(
        x + (dx * (1 + start)) / 2,
        0.328,
        z + (dz * (1 + start)) / 2,
      );
      transform.rotation.set(0, Math.atan2(dx, dz), 0);
      transform.scale.set(1, 1, length);
      transform.updateMatrix();
      paths.current.setMatrixAt(count, transform.matrix);
      paths.current.setColorAt(count, color);
      transform.position.set(x + dx * start, 0.333, z + dz * start);
      transform.rotation.set(0, 0, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      pins.current.setMatrixAt(count, transform.matrix);
      pins.current.setColorAt(count, color);
      count += 1;
    }
    for (const mesh of [paths.current, pins.current]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [state, transform, color]);
  return (
    <>
      <instancedMesh ref={paths} args={[undefined, undefined, 4]}>
        <boxGeometry args={[0.015, 0.008, 1]} />
        <meshBasicMaterial transparent opacity={0.6} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={pins} args={[undefined, undefined, 4]}>
        <cylinderGeometry args={[0.048, 0.048, 0.012, 8]} />
        <meshBasicMaterial />
      </instancedMesh>
    </>
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
  const [x, z] = tilePosition(0);
  const [offsetX, offsetZ] = scenePawnOffset(seat);
  const color = PLAYER_COLORS[seat];
  return (
    <group ref={groupRef} position={[x + offsetX, 0.38, z + offsetZ]}>
      {active && (
        <mesh position={[0, 0.048, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.225, 0.265, 24]} />
          <meshBasicMaterial color="#ffcf59" />
        </mesh>
      )}
      <group rotation={[0, Math.PI / 4, 0]} scale={0.82}>
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
const CASH_PILES: readonly [number, number, number][] = [
  [1.4, -0.26, 5.65],
  [-5.65, -0.26, -1.4],
  [-1.4, -0.26, -5.65],
  [5.65, -0.26, 1.4],
];
const CASH_BUNDLES_PER_SEAT = 6;
const CASH_TRANSFER_BUNDLES = 3;

function noteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#b9d98f";
    context.fillRect(0, 0, 256, 128);
    context.strokeStyle = "#689056";
    context.lineWidth = 7;
    context.strokeRect(9, 9, 238, 110);
    context.strokeStyle = "#8db470";
    context.lineWidth = 3;
    context.strokeRect(19, 19, 218, 90);
    for (const x of [42, 214]) {
      context.fillStyle = "#749955";
      context.beginPath();
      context.ellipse(x, 64, 18, 29, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#e4eec7";
      context.fillRect(x - 6, 51, 12, 26);
    }
    context.fillStyle = "#91b66a";
    context.beginPath();
    context.ellipse(128, 64, 39, 34, 0, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function cashBundleCount(cash: number) {
  // Visual denomination only; the authoritative amount is shown by the HUD.
  return Math.min(
    CASH_BUNDLES_PER_SEAT,
    Math.ceil(Math.max(0, cash) / 400_000),
  );
}

function CashReserveBadge({ seat, cash }: { seat: Seat; cash: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = PLAYER_COLORS[seat];
      context.beginPath();
      context.arc(64, 64, 59, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#fffaf0";
      context.lineWidth = 7;
      context.beginPath();
      context.arc(64, 64, 51, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#fffaf0";
      context.font = "700 70px Segoe UI, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(PLAYER_SYMBOLS[seat], 64, 64);
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    return result;
  }, [seat]);
  useEffect(() => () => texture.dispose(), [texture]);
  const bundle = cashBundleCount(cash) - 1;
  if (bundle < 0) return null;
  const [x, y, z] = CASH_PILES[seat];
  const sideways = seat === 1 || seat === 3;
  const across = ((bundle % 2) - 0.5) * 0.56;
  const top = y + 0.144 + Math.floor(bundle / 2) * 0.15;
  return (
    <mesh
      position={[x + (sideways ? across : 0), top, z + (sideways ? 0 : across)]}
      rotation={[-Math.PI / 2, 0, -Math.PI / 4]}
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
      const [x, y, z] = CASH_PILES[player.seat];
      const sideways = player.seat === 1 || player.seat === 3;
      const rotation = sideways ? Math.PI / 2 : 0;
      // This is a capped physical illustration, never an alternate cash counter.
      const bundles = cashBundleCount(player.cash);
      color.set(PLAYER_COLORS[player.seat]);
      for (let index = 0; index < bundles; index++) {
        const column = index % 2;
        const layer = Math.floor(index / 2);
        const across = (column - 0.5) * 0.56;
        const dx = sideways ? across : 0;
        const dz = sideways ? 0 : across;
        transform.position.set(x + dx, y + 0.065 + layer * 0.15, z + dz);
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
          transform.position.y = y + 0.065 + layer * 0.15 + offset;
          transform.updateMatrix();
          edges.setMatrixAt(edgeCount++, transform.matrix);
        }
        count += 1;
      }
      const goldCount = Math.min(6, Math.ceil(player.cash / 600_000));
      for (let index = 0; index < goldCount; index++) {
        const along = 0.61;
        const across = -0.15 + Math.floor(index / 3) * 0.25;
        transform.position.set(
          x + (sideways ? across : along),
          y + 0.035 + (index % 3) * 0.048,
          z + (sideways ? along : across),
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

function SceneContent(props: BoardProps) {
  const { state, preview, zoom = 1 } = props;
  const { camera, invalidate, size, gl } = useThree();
  const pawns = useRef<(THREE.Group | null)[]>([]);
  const dice = useRef<(THREE.Group | null)[]>([]);
  const timelines = useRef(new Map<gsap.core.Timeline, () => void>());
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
  const rendered = useRef(false);
  useEffect(() => () => cashTexture.dispose(), [cashTexture]);

  useEffect(() => {
    const aspect = size.width / size.height;
    const narrow = aspect < 1;
    const pitch = narrow ? 0.75 : 0.66;
    camera.position.set(13, Math.hypot(13, 13) * pitch, 13);
    camera.lookAt(0, 0.28, 0);
    camera.updateMatrixWorld();
    if (camera instanceof THREE.OrthographicCamera) {
      const bounds = new THREE.Box3();
      for (const x of [-5.03, 5.03])
        for (const z of [-5.03, 5.03])
          for (const y of [0.05, 0.65]) {
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
            tile.kind === "city" ? 1.08 : 0.95,
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
    let propertyEffectGeneration = 0;
    let cashEffectGeneration = 0;
    function snap(next: PublicState | null) {
      if (cashFlight.current) cashFlight.current.visible = false;
      for (const player of next?.players ?? []) {
        const pawn = pawns.current[player.seat];
        if (!pawn) continue;
        const [x, z] = tilePosition(player.position);
        const [offsetX, offsetZ] = scenePawnOffset(
          player.seat,
          player.position,
        );
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
      const [bankX, bankZ] = tilePosition(0);
      const bank: readonly [number, number, number] = [bankX, 0.7, bankZ];
      const from = transfer.from === null ? bank : CASH_PILES[transfer.from];
      const to = transfer.to === null ? bank : CASH_PILES[transfer.to];
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
          ease: "none",
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
          await play((timeline) => {
            if (Math.abs(steps) > 16 || steps === 0) {
              const [x, z] = tilePosition(event.position);
              const [offsetX, offsetZ] = scenePawnOffset(
                event.seat,
                event.position,
              );
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
                const tile =
                  (((from + step * Math.sign(steps)) % 32) + 32) % 32;
                const [x, z] = tilePosition(tile);
                const [offsetX, offsetZ] = scenePawnOffset(event.seat, tile);
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
          const effectGeneration = ++propertyEffectGeneration;
          const [x, z] = tilePosition(event.tile);
          ring.position.set(x, 0.34, z);
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
              const radius = 0.16 + progress * 0.4;
              sparkTransform.position.set(
                x + Math.cos(angle) * radius,
                0.42 + Math.sin(progress * Math.PI) * 0.55,
                z + Math.sin(angle) * radius,
              );
              sparkTransform.rotation.set(
                progress * Math.PI,
                angle,
                Math.PI / 4,
              );
              sparkTransform.scale.setScalar(0.075 * (1 - progress));
              sparkTransform.updateMatrix();
              burst.setMatrixAt(index, sparkTransform.matrix);
            }
            burst.instanceMatrix.needsUpdate = true;
          };
          await play((timeline) => {
            timeline.fromTo(
              ring.scale,
              { x: 0.1, y: 0.1, z: 0.1 },
              { x: 1.25, y: 1.25, z: 1.25, duration: 0.4, ease: "power2.out" },
            );
            timeline.fromTo(
              sparkProgress,
              { value: 0 },
              {
                value: 1,
                duration: 0.45,
                ease: "power2.out",
                onUpdate: updateSparks,
              },
              0,
            );
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
    gl.setClearColor("#75d4ed", 0);
  }, [gl]);
  return (
    <>
      <ambientLight intensity={1.1} />
      <hemisphereLight args={["#edf8ff", "#a9ad8a", 0.7]} />
      <directionalLight
        position={[-5, 10, 5]}
        intensity={1.1}
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
      <mesh position={[0, -0.085, 0]} receiveShadow>
        <boxGeometry args={[200, 0.1, 200]} />
        <shadowMaterial opacity={0.11} />
      </mesh>
      <mesh
        position={[0, 0.14, 0]}
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
        <boxGeometry args={[9.91, 0.2, 9.91]} />
        <meshStandardMaterial color="#b6aeba" roughness={1} />
      </mesh>
      <mesh position={[0, 0.251, 0]} receiveShadow>
        <boxGeometry args={[9.86, 0.025, 9.86]} />
        <meshStandardMaterial color="#e6e0e9" roughness={1} />
      </mesh>
      <CenterIsland />
      {!preview && state && <CashReserves state={state} />}
      <BoardTiles {...props} />
      <TileFocus {...props} />
      <Towns state={state} preview={preview} />
      <BoardMarkers state={state} />
      {!preview && <PawnPositions state={state} />}
      {([0, 1, 2, 3] as const).map((seat) => (
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
      <instancedMesh
        ref={sparks}
        visible={false}
        args={[undefined, undefined, 8]}
        frustumCulled={false}
      >
        <boxGeometry />
        <meshBasicMaterial color="#ffcf59" />
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
