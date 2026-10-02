import * as THREE from "three";
import { BOARD, ECONOMY } from "../../shared/board/index.js";
import type { Seat } from "../../shared/engine/index.js";
import type { Locale } from "../i18n.js";
import {
  PLAYER_COLORS,
  PLAYER_SYMBOLS,
  tileColor,
  tileName,
} from "../ui/board-display.js";
import {
  BUILDING_BAND,
  INNER_HALF,
  LAWN_HALF,
  LOT_DEPTH,
  LOT_WIDTH,
  ROAD_WIDTH,
  screenTop,
} from "./board-layout.js";

// Printed board art, painted once per change into canvas textures. Every
// canvas keeps one density on both axes so letters are never stretched.

const PIXELS_PER_UNIT = 300;
export const INK = "#1d3a46";
export const PAPER = "#fdfaf3";
const DISPLAY_FONT =
  "'Segoe UI Black', 'Arial Black', 'Segoe UI', system-ui, sans-serif";
const LABEL_FONT = "'Segoe UI', 'Trebuchet MS', system-ui, sans-serif";
const WHEEL_COLORS = [
  "#ef5b74",
  "#f6b93b",
  "#5bbf74",
  "#41a9d8",
  "#9a6bd0",
  "#f5874a",
];

type Context = CanvasRenderingContext2D;

export function canvasTexture(
  width: number,
  height: number,
  paint: (context: Context) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    paint(context);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const mixA = new THREE.Color();
const mixB = new THREE.Color();
export function mix(color: string, other: string, amount: number) {
  return `#${mixA.set(color).lerp(mixB.set(other), amount).getHexString()}`;
}

/** Board prints use the compact amounts of a printed board: 350K, 1,2M. */
export function boardAmount(value: number, locale: Locale) {
  const format = (amount: number, digits: number) =>
    new Intl.NumberFormat(locale === "fr" ? "fr-CH" : "en-GB", {
      maximumFractionDigits: digits,
    }).format(amount);
  if (Math.abs(value) >= 1_000_000) return `${format(value / 1_000_000, 2)}M`;
  if (Math.abs(value) >= 1000) return `${format(value / 1000, 1)}K`;
  return format(value, 0);
}

/** Largest font size up to `size` that fits `text` within `maxWidth`. */
function fitText(
  context: Context,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  weight: number,
  family: string,
  minimum = size * 0.55,
) {
  let current = size;
  context.font = `${weight} ${current}px ${family}`;
  while (current > minimum && context.measureText(text).width > maxWidth) {
    current -= 2;
    context.font = `${weight} ${current}px ${family}`;
  }
  context.fillText(text, x, y, maxWidth);
}

function wheel(context: Context, x: number, y: number, radius: number) {
  context.save();
  context.fillStyle = "#00000014";
  context.beginPath();
  context.arc(x + 4, y + 6, radius, 0, Math.PI * 2);
  context.fill();
  for (let wedge = 0; wedge < 6; wedge++) {
    context.fillStyle = WHEEL_COLORS[wedge];
    context.beginPath();
    context.moveTo(x, y);
    context.arc(
      x,
      y,
      radius,
      (wedge * Math.PI) / 3 - Math.PI / 2,
      ((wedge + 1) * Math.PI) / 3 - Math.PI / 2,
    );
    context.closePath();
    context.fill();
  }
  context.lineWidth = radius * 0.08;
  context.strokeStyle = "#fffaf0";
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#fffaf0";
  context.beginPath();
  context.arc(x, y, radius * 0.3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = INK;
  context.font = `900 ${Math.round(radius * 0.42)}px ${DISPLAY_FONT}`;
  context.fillText("?", x, y + radius * 0.02);
  context.restore();
}

function umbrella(context: Context, x: number, y: number, size: number) {
  context.save();
  context.strokeStyle = "#7b5a3c";
  context.lineWidth = size * 0.07;
  context.beginPath();
  context.moveTo(x, y - size * 0.15);
  context.lineTo(x + size * 0.12, y + size * 0.62);
  context.stroke();
  for (let panel = 0; panel < 4; panel++) {
    context.fillStyle = panel % 2 ? "#fffaf0" : "#ef6a55";
    context.beginPath();
    context.moveTo(x, y - size * 0.15);
    context.arc(
      x,
      y - size * 0.15,
      size * 0.5,
      Math.PI + (panel * Math.PI) / 4,
      Math.PI + ((panel + 1) * Math.PI) / 4,
    );
    context.closePath();
    context.fill();
  }
  context.restore();
}

/** The colored plot printed at the screen-top end of a lot. */
function paintPlot(
  context: Context,
  index: number,
  width: number,
  band: number,
) {
  const tile = BOARD[index];
  if (tile.kind === "city") {
    const color = tileColor(index);
    context.fillStyle = mix(PAPER, color, 0.68);
    context.fillRect(0, 0, width, band);
    context.fillStyle = mix(PAPER, color, 0.52);
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 4; column++) {
        context.beginPath();
        context.ellipse(
          28 + column * 82 + (row % 2) * 40,
          30 + row * 52,
          12,
          6,
          0,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    context.fillStyle = color;
    context.fillRect(0, band - 24, width, 24);
    return;
  }
  if (tile.kind === "resort") {
    const sea = context.createLinearGradient(0, 0, 0, band * 0.6);
    sea.addColorStop(0, "#41b9d6");
    sea.addColorStop(1, "#8ee0ec");
    context.fillStyle = sea;
    context.fillRect(0, 0, width, band * 0.6);
    context.strokeStyle = "#e6fbff";
    context.lineWidth = 5;
    for (const y of [band * 0.18, band * 0.38]) {
      context.beginPath();
      for (let x = 0; x <= width; x += 30)
        context.quadraticCurveTo(x + 15, y - 8, x + 30, y);
      context.stroke();
    }
    context.fillStyle = "#f3dfaa";
    context.fillRect(0, band * 0.6, width, band * 0.4);
    umbrella(context, width * 0.68, band * 0.58, band * 0.62);
    context.fillStyle = "#2f9fbb";
    context.fillRect(0, band - 24, width, 24);
    return;
  }
  if (tile.kind === "tax") {
    context.fillStyle = "#e3d6ea";
    context.fillRect(0, 0, width, band);
    context.fillStyle = "#c9a43d";
    context.beginPath();
    context.arc(width / 2, band * 0.48, band * 0.32, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffd768";
    context.beginPath();
    context.arc(width / 2, band * 0.45, band * 0.3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#8b6814";
    context.font = `900 ${Math.round(band * 0.34)}px ${DISPLAY_FONT}`;
    context.fillText("%", width / 2, band * 0.46);
    context.fillStyle = "#9d7fb3";
    context.fillRect(0, band - 24, width, 24);
  }
}

export type LotPrint = {
  /** Purchase price, or the current rent once someone owns the lot. */
  readonly amount: number | null;
  readonly owner: Seat | null;
  readonly locale: Locale;
  /** Eligible sale lots stay white rather than taking the owner's paper tint. */
  readonly forSale?: boolean;
};

export function lotTexture(index: number, print: LotPrint) {
  const width = LOT_WIDTH * PIXELS_PER_UNIT;
  const height = LOT_DEPTH * PIXELS_PER_UNIT;
  const band = Math.round((BUILDING_BAND / LOT_DEPTH) * height);
  const { amount, owner, locale, forSale } = print;
  return canvasTexture(width, height, (context) => {
    const tile = BOARD[index];
    const ownerColor = owner == null ? null : PLAYER_COLORS[owner];
    context.fillStyle = forSale
      ? "#ffffff"
      : ownerColor
        ? mix(PAPER, ownerColor, 0.12)
        : PAPER;
    context.fillRect(0, 0, width, height);
    const name = tileName(index).toLocaleUpperCase(locale);
    if (tile.kind === "chance") {
      context.fillStyle = "#fff3d9";
      context.fillRect(0, 0, width, height);
      wheel(context, width / 2, height * 0.38, width * 0.36);
      context.fillStyle = INK;
      fitText(
        context,
        name,
        width / 2,
        height * 0.79,
        width - 34,
        50,
        900,
        LABEL_FONT,
      );
      return;
    }
    paintPlot(context, index, width, band);
    context.fillStyle = INK;
    fitText(
      context,
      name,
      width / 2,
      band + 50,
      width - 30,
      40,
      800,
      LABEL_FONT,
    );
    const figure =
      tile.kind === "tax"
        ? `${ECONOMY.taxPercent} %`
        : amount === null
          ? ""
          : boardAmount(amount, locale);
    fitText(
      context,
      figure,
      width / 2,
      band + 146,
      width - 26,
      94,
      900,
      DISPLAY_FONT,
    );
    if (ownerColor && owner != null) {
      const strip = 56;
      context.fillStyle = ownerColor;
      context.fillRect(0, height - strip, width, strip);
      context.fillStyle = "#fffaf0";
      fitText(
        context,
        `${PLAYER_SYMBOLS[owner]}  ${locale === "fr" ? "LOYER" : "RENT"}`,
        width / 2,
        height - strip / 2 + 1,
        width - 30,
        30,
        800,
        LABEL_FONT,
      );
    }
  });
}

/** Corner art; its inner quarter stays plain for the pawns standing there. */
export function cornerTexture(index: number, locale: Locale, salary: number) {
  const size = Math.round(LOT_DEPTH * PIXELS_PER_UNIT);
  // Front corners show their inner quarter top-left, back corners bottom-right.
  const front = screenTop(index) === 1;
  const outer = front ? size * 0.66 : size * 0.34;
  return canvasTexture(size, size, (context) => {
    const kind = BOARD[index].kind;
    if (kind === "start") {
      context.fillStyle = PAPER;
      context.fillRect(0, 0, size, size);
      // The checkered line marks the departure toward the first lot (left).
      const square = size / 14;
      for (let row = 0; row < 14; row++)
        for (let column = 0; column < 2; column++) {
          context.fillStyle = (row + column) % 2 ? "#fffaf0" : INK;
          context.fillRect(column * square, row * square, square, square);
        }
      context.fillStyle = mix(PAPER, "#3a9a57", 0.1);
      context.fillRect(square * 2, 0, size - square * 2, size);
      // Arrow pointing in the direction of play.
      const y = size * 0.7;
      context.fillStyle = "#2f8a4c";
      context.beginPath();
      context.moveTo(size * 0.2, y - size * 0.2);
      context.lineTo(size * 0.2, y - size * 0.09);
      context.lineTo(size * 0.9, y - size * 0.09);
      context.lineTo(size * 0.9, y + size * 0.09);
      context.lineTo(size * 0.2, y + size * 0.09);
      context.lineTo(size * 0.2, y + size * 0.2);
      context.lineTo(size * 0.03 + square * 2, y);
      context.closePath();
      context.fill();
      context.fillStyle = "#fffaf0";
      fitText(
        context,
        tileName(index).toLocaleUpperCase(locale),
        size * 0.56,
        y + 2,
        size * 0.62,
        58,
        900,
        DISPLAY_FONT,
      );
      context.fillStyle = "#2f8a4c";
      fitText(
        context,
        `+${boardAmount(salary, locale)}`,
        size * 0.7,
        size * 0.3,
        size * 0.5,
        64,
        900,
        DISPLAY_FONT,
      );
      return;
    }
    if (kind === "island") {
      const sea = context.createRadialGradient(
        size / 2,
        size / 2,
        size * 0.2,
        size / 2,
        size / 2,
        size * 0.75,
      );
      sea.addColorStop(0, "#7fdcee");
      sea.addColorStop(1, "#2fb0d0");
      context.fillStyle = sea;
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#c7f1f8";
      context.beginPath();
      context.ellipse(
        size * 0.52,
        size * 0.52,
        size * 0.4,
        size * 0.36,
        0.4,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.fillStyle = "#f4dea6";
      context.beginPath();
      context.ellipse(
        size * 0.52,
        size * 0.52,
        size * 0.35,
        size * 0.31,
        0.4,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.fillStyle = "#e8cd86";
      context.beginPath();
      context.ellipse(
        outer,
        outer,
        size * 0.15,
        size * 0.11,
        0.4,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.strokeStyle = "#e6fbff";
      context.lineWidth = 6;
      for (const [x, y] of [
        [0.14, 0.12],
        [0.82, 0.2],
        [0.2, 0.86],
        [0.86, 0.88],
      ]) {
        context.beginPath();
        context.arc(
          size * x,
          size * y,
          size * 0.05,
          Math.PI * 1.1,
          Math.PI * 1.9,
        );
        context.stroke();
      }
      return;
    }
    if (kind === "championship") {
      context.fillStyle = "#7fbf4c";
      context.fillRect(0, 0, size, size);
      for (let stripe = 0; stripe < 7; stripe += 2) {
        context.fillStyle = "#8acb55";
        context.fillRect((stripe * size) / 7, 0, size / 7, size);
      }
      context.strokeStyle = "#f4fbe8";
      context.lineWidth = 7;
      context.strokeRect(size * 0.08, size * 0.08, size * 0.84, size * 0.84);
      context.beginPath();
      context.moveTo(size * 0.08, size * 0.92);
      context.lineTo(size * 0.92, size * 0.08);
      context.stroke();
      context.beginPath();
      context.arc(size / 2, size / 2, size * 0.14, 0, Math.PI * 2);
      context.stroke();
      return;
    }
    // World tour: an apron and a runway leading off the board.
    context.fillStyle = "#a9b3b8";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#99a4aa";
    for (let row = 0; row < 6; row++)
      context.fillRect(0, (row * size) / 6, size, 3);
    // Laid along the screen's horizontal, so the airliner shows in profile.
    context.save();
    context.translate(outer, outer);
    context.rotate(Math.PI / 4);
    context.fillStyle = "#5c676d";
    context.fillRect(-size, -size * 0.13, size * 2, size * 0.26);
    context.fillStyle = "#f6f7f2";
    for (let dash = -6; dash <= 6; dash++)
      context.fillRect(dash * size * 0.16, -5, size * 0.08, 10);
    context.restore();
  });
}

/** Mown stripes and a chalk circle where the dice land. */
export function lawnTexture() {
  const size = 1024;
  const unit = size / (LAWN_HALF * 2);
  return canvasTexture(size, size, (context) => {
    context.fillStyle = "#9fcb59";
    context.fillRect(0, 0, size, size);
    const stripes = 8;
    for (let stripe = 0; stripe < stripes; stripe += 2) {
      context.fillStyle = "#abd466";
      context.fillRect((stripe * size) / stripes, 0, size / stripes, size);
    }
    const shade = context.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.25,
      size / 2,
      size / 2,
      size * 0.72,
    );
    shade.addColorStop(0, "#ffffff00");
    shade.addColorStop(1, "#4d7d2a2e");
    context.fillStyle = shade;
    context.fillRect(0, 0, size, size);
    context.strokeStyle = "#f5fbeacc";
    context.lineWidth = 7;
    context.beginPath();
    context.arc(size / 2, size / 2, unit * 1.45, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#f5fbeacc";
    context.beginPath();
    context.arc(size / 2, size / 2, 9, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#5f8f3a40";
    context.lineWidth = 10;
    context.strokeRect(5, 5, size - 10, size - 10);
  });
}

/** Asphalt ring with curbs and a dashed center line; the lawn covers its middle. */
export function roadTexture() {
  const size = 1024;
  const unit = size / (INNER_HALF * 2);
  const road = ROAD_WIDTH * unit;
  return canvasTexture(size, size, (context) => {
    context.fillStyle = "#86929a";
    context.fillRect(0, 0, size, size);
    context.strokeStyle = "#eef1ea";
    context.lineWidth = 5;
    context.setLineDash([22, 18]);
    context.strokeRect(road / 2, road / 2, size - road, size - road);
    context.setLineDash([]);
    context.strokeStyle = "#dfe4dc";
    context.lineWidth = 7;
    context.strokeRect(
      road - 3,
      road - 3,
      size - road * 2 + 6,
      size - road * 2 + 6,
    );
  });
}

/** A sign label: bold white letters with a dark outline, like a printed sticker. */
export function labelTexture(text: string) {
  return canvasTexture(640, 150, (context) => {
    context.lineJoin = "round";
    let size = 76;
    context.font = `900 ${size}px ${DISPLAY_FONT}`;
    while (size > 40 && context.measureText(text).width > 590) {
      size -= 2;
      context.font = `900 ${size}px ${DISPLAY_FONT}`;
    }
    context.strokeStyle = INK;
    context.lineWidth = 16;
    context.strokeText(text, 320, 78);
    context.fillStyle = "#fffaf0";
    context.fillText(text, 320, 78);
  });
}

/** The dice total, shown on a small scoreboard above the dice. */
export function scoreTexture(total: number, double: boolean) {
  return canvasTexture(160, 160, (context) => {
    context.fillStyle = "#173b4533";
    context.beginPath();
    context.roundRect(14, 20, 136, 132, 26);
    context.fill();
    context.fillStyle = double ? "#ffcf59" : "#fffaf0";
    context.strokeStyle = double ? "#b17d12" : "#2b6f9e";
    context.lineWidth = 9;
    context.beginPath();
    context.roundRect(10, 10, 136, 132, 26);
    context.fill();
    context.stroke();
    context.fillStyle = INK;
    context.font = `900 92px ${DISPLAY_FONT}`;
    context.fillText(String(total), 78, 82);
  });
}

export function markerTexture(
  text: string,
  background: string,
  foreground: string,
) {
  return canvasTexture(128, 96, (context) => {
    context.fillStyle = background;
    context.fillRect(0, 0, 128, 96);
    context.fillStyle = foreground;
    context.font = `900 62px ${LABEL_FONT}`;
    context.fillText(text, 64, 50);
  });
}

export function noteTexture() {
  return canvasTexture(256, 128, (context) => {
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
  });
}

export function seatBadgeTexture(seat: Seat) {
  return canvasTexture(128, 128, (context) => {
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
    context.font = `700 70px ${LABEL_FONT}`;
    context.fillText(PLAYER_SYMBOLS[seat], 64, 64);
  });
}
