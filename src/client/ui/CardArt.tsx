import type { ReactNode } from "react";
import type { ChanceCard } from "../../shared/engine/index.js";

const PIPS: Record<number, readonly (readonly [number, number])[]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

/** A die face; the catalogue, which has no roll yet, shows a question mark. */
function Die({ value }: { value?: number }) {
  return (
    <g transform="translate(38 58)">
      <rect width="44" height="44" rx="9" fill="#fffdf6" />
      {value === undefined ? (
        <text
          x="22"
          y="33"
          textAnchor="middle"
          fontSize="30"
          fontWeight="900"
          fill="#24435a"
        >
          ?
        </text>
      ) : (
        PIPS[value]?.map(([column, row]) => (
          <circle
            key={`${column}-${row}`}
            cx={10 + column * 12}
            cy={10 + row * 12}
            r="4.2"
            fill="#24435a"
          />
        ))
      )}
    </g>
  );
}

function House({ x, roof }: { x: number; roof: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x="4" y="62" width="28" height="28" fill="#fff8e9" />
      <path d="M0 64 18 46l18 18Z" fill={roof} />
      <rect x="14" y="76" width="8" height="14" fill="#24435a" />
    </g>
  );
}

const ARROW = {
  stroke: "#fffdf6",
  strokeWidth: 7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
} as const;

/** One flat subject per card on a plain colour, readable at thumbnail size. */
const ART: Record<ChanceCard, (roll?: number) => [string, ReactNode]> = {
  "Grand Tour": () => [
    "#8fd48a",
    <>
      <rect y="92" width="120" height="28" fill="#5fae5b" />
      <rect x="38" y="24" width="6" height="70" rx="3" fill="#7a5233" />
      <path d="M44 26h44l-10 14 10 14H44Z" fill="#ef6f5e" />
      <path d="M60 106h34m-8-7 8 7-8 7" {...ARROW} strokeWidth={5} />
    </>,
  ],
  Stranded: () => [
    "#8fd3f4",
    <>
      <circle cx="94" cy="26" r="11" fill="#ffd35c" />
      <rect y="80" width="120" height="40" fill="#3f9fd0" />
      <ellipse cx="54" cy="82" rx="32" ry="10" fill="#f1d58a" />
      <path
        d="M56 80c-3-16 0-30 9-42"
        stroke="#8a5a3b"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M65 38c-10-8-24-6-30 4 10-4 20-2 30-4Z" fill="#3e9a55" />
      <path d="M65 38c8-10 22-10 28 0-10-3-19-2-28 0Z" fill="#3e9a55" />
      <path d="M65 38c2-10 10-16 20-14-8 3-14 8-20 14Z" fill="#4fb066" />
    </>,
  ],
  "Jet Set": () => [
    "#6fb8ea",
    <>
      <g fill="#fffdf6" opacity=".85">
        <circle cx="26" cy="92" r="10" />
        <circle cx="40" cy="88" r="13" />
        <rect x="16" y="92" width="44" height="10" rx="5" />
        <circle cx="92" cy="30" r="8" />
        <rect x="80" y="30" width="30" height="8" rx="4" />
      </g>
      <g transform="rotate(-28 60 60)">
        <path d="M54 56 40 28h11l23 28Z" fill="#dfe8f2" />
        <path d="M54 64 40 92h11l23-28Z" fill="#dfe8f2" />
        <rect x="20" y="53" width="80" height="14" rx="7" fill="#fffdf6" />
        <path d="M24 55 18 40h9l11 15Z" fill="#ef6f5e" />
        <circle cx="94" cy="60" r="3.5" fill="#24435a" />
      </g>
    </>,
  ],
  "Stadium Call": () => [
    "#f2a65a",
    <>
      <path
        d="M38 34h-9a11 11 0 0 0 12 16m41-16h9a11 11 0 0 1-12 16"
        stroke="#ffcf4a"
        strokeWidth="6"
        fill="none"
      />
      <path d="M38 26h44v16a22 22 0 0 1-44 0Z" fill="#ffcf4a" />
      <path
        d="m60 32 3.5 7 7.5 1-5.5 5 1.5 7.5-7-3.5-7 3.5 1.5-7.5-5.5-5 7.5-1Z"
        fill="#fff6c8"
      />
      <rect x="55" y="63" width="10" height="13" fill="#e0a92e" />
      <rect x="40" y="76" width="40" height="12" rx="4" fill="#8a5a3b" />
    </>,
  ],
  Windfall: () => [
    "#7cc98a",
    <>
      <path d="M48 34h24l-6 16H54Z" fill="#b58c52" />
      <path d="M42 52c-12 14-12 38 18 40 30-2 30-26 18-40Z" fill="#d6b27a" />
      <rect x="49" y="48" width="22" height="6" rx="3" fill="#8a5a3b" />
      <circle cx="60" cy="72" r="10" fill="#ffd35c" />
      <circle cx="60" cy="72" r="5" fill="#e0a92e" />
      <ellipse cx="94" cy="96" rx="11" ry="5" fill="#e0a92e" />
      <ellipse cx="94" cy="91" rx="11" ry="5" fill="#ffd35c" />
      <ellipse cx="24" cy="96" rx="11" ry="5" fill="#ffd35c" />
    </>,
  ],
  "Parking Fine": () => [
    "#c95a4a",
    <>
      <rect x="40" y="56" width="6" height="48" fill="#6b7a86" />
      <rect x="22" y="20" width="42" height="42" rx="8" fill="#2f6fd0" />
      <text
        x="43"
        y="53"
        textAnchor="middle"
        fontSize="32"
        fontWeight="900"
        fill="#fffdf6"
      >
        P
      </text>
      <g transform="rotate(10 84 72)">
        <rect x="66" y="46" width="36" height="52" rx="4" fill="#fff8e9" />
        <path
          d="M73 58h22M73 68h22M73 78h14"
          stroke="#c9b8a0"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
    </>,
  ],
  Birthday: () => [
    "#f2c94c",
    <>
      <ellipse cx="60" cy="92" rx="40" ry="7" fill="#fffdf6" />
      <rect x="30" y="58" width="60" height="32" rx="6" fill="#8a5a3b" />
      <rect x="30" y="56" width="60" height="12" rx="6" fill="#fff8e9" />
      {[42, 58, 74].map((x) => (
        <g key={x}>
          <rect x={x} y="40" width="5" height="16" rx="2" fill="#ef6f5e" />
          <ellipse cx={x + 2.5} cy="35" rx="3.5" ry="5" fill="#fff6c8" />
        </g>
      ))}
      <circle cx="20" cy="28" r="4" fill="#ef6f5e" />
      <circle cx="100" cy="36" r="4" fill="#3f9fd0" />
      <circle cx="96" cy="16" r="3" fill="#5fae5b" />
    </>,
  ],
  Audit: () => [
    "#e7a04f",
    <>
      <rect x="26" y="20" width="50" height="66" rx="5" fill="#fff8e9" />
      <path
        d="M35 34h32M35 45h32M35 56h20"
        stroke="#c9b8a0"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle
        cx="42"
        cy="72"
        r="8"
        fill="none"
        stroke="#d04a3a"
        strokeWidth="3"
      />
      <path
        d="m90 82 13 13"
        stroke="#24435a"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <circle
        cx="78"
        cy="70"
        r="15"
        fill="#cfe9f5"
        stroke="#24435a"
        strokeWidth="5"
      />
    </>,
  ],
  "Guardian Angel": () => [
    "#b9a6e6",
    <>
      <ellipse
        cx="60"
        cy="26"
        rx="18"
        ry="6"
        fill="none"
        stroke="#ffd35c"
        strokeWidth="5"
      />
      <path
        d="M56 64C44 44 24 42 14 54c10-1 14 5 12 10 8-2 14 4 12 10 8-4 16-4 18-10Z"
        fill="#fffdf6"
      />
      <path
        d="M64 64c12-20 32-22 42-10-10-1-14 5-12 10-8-2-14 4-12 10-8-4-16-4-18-10Z"
        fill="#fffdf6"
      />
      <path
        d="M60 92C42 80 36 70 42 62c5-6 13-5 18 2 5-7 13-8 18-2 6 8 0 18-18 30Z"
        fill="#ef6f5e"
      />
    </>,
  ],
  Coupon: () => [
    "#9b7fd1",
    <g key="coupon" transform="rotate(-12 60 60)">
      <path
        d="M18 38h84v14a8 8 0 0 0 0 16v14H18V68a8 8 0 0 0 0-16Z"
        fill="#fff8e9"
      />
      <path
        d="M40 40v40"
        stroke="#c9b8a0"
        strokeWidth="3"
        strokeDasharray="5 4"
      />
      <text
        x="70"
        y="67"
        textAnchor="middle"
        fontSize="20"
        fontWeight="900"
        fill="#d04a3a"
      >
        -50%
      </text>
    </g>,
  ],
  Earthquake: () => [
    "#e0795a",
    <>
      <rect y="90" width="120" height="30" fill="#8a5a3b" />
      <path
        d="m60 90-7 10 8 7-5 13"
        stroke="#3b2a20"
        strokeWidth="5"
        fill="none"
      />
      <g transform="rotate(-8 54 90)">
        <rect x="30" y="60" width="26" height="30" fill="#fff8e9" />
        <path d="M26 62 56 38v24Z" fill="#d04a3a" />
      </g>
      <g transform="rotate(8 66 90)">
        <rect x="64" y="60" width="26" height="30" fill="#fff8e9" />
        <path d="m64 38 30 24H64Z" fill="#d04a3a" />
      </g>
      <path
        d="m14 48-7 5m6 9H5m102-14 7 5m-6 9h8"
        stroke="#fffdf6"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </>,
  ],
  "Land Swap": () => [
    "#5cc0b5",
    <>
      <House x={14} roof="#ef6f5e" />
      <House x={70} roof="#2f6fd0" />
      <path d="M36 36c10-14 38-14 48 0" {...ARROW} strokeWidth={5} />
      <path d="m86 26-1 11-10-3" {...ARROW} strokeWidth={5} />
      <path d="M84 104c-10 12-38 12-48 0" {...ARROW} strokeWidth={5} />
      <path d="m34 114 1-11 10 3" {...ARROW} strokeWidth={5} />
    </>,
  ],
  Detour: (roll) => [
    "#8fc1e8",
    <>
      <path d="M96 32H28m14-14L28 32l14 14" {...ARROW} />
      <Die value={roll} />
    </>,
  ],
  Contractor: () => [
    "#f2c94c",
    <>
      <rect x="32" y="62" width="44" height="30" fill="#fff8e9" />
      <path
        d="m26 66 28-24 28 24"
        stroke="#d04a3a"
        strokeWidth="7"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="48" y="74" width="12" height="18" fill="#24435a" />
      <circle cx="88" cy="38" r="16" fill="#5fae5b" />
      <path d="M88 29v18m-9-9h18" {...ARROW} strokeWidth={5} />
    </>,
  ],
  Jailbreak: () => [
    "#5cc0b5",
    <>
      <path
        d="M44 54V36a16 16 0 0 1 32 0v4"
        stroke="#6b7a86"
        strokeWidth="8"
        strokeLinecap="round"
        fill="none"
        transform="translate(10 -10) rotate(12 60 40)"
      />
      <rect x="32" y="54" width="56" height="40" rx="7" fill="#ffcf4a" />
      <circle cx="60" cy="70" r="6" fill="#8a5a3b" />
      <rect x="57.5" y="70" width="5" height="12" fill="#8a5a3b" />
    </>,
  ],
  Charity: () => [
    "#f29bb0",
    <>
      <path
        d="M60 70C38 56 30 44 36 34c6-8 18-8 24 2 6-10 18-10 24-2 6 10-2 22-24 36Z"
        fill="#ef4f6a"
      />
      <path
        d="M14 92c10-6 24-6 34-2h22c6 0 6 8 0 8H54l18 2 22-10c6-3 10 3 5 7L76 110H38l-24-6Z"
        fill="#f6c39a"
      />
    </>,
  ],
  Tailwind: (roll) => [
    "#9ad48f",
    <>
      <path d="M24 32h68M78 18l14 14-14 14" {...ARROW} />
      <path
        d="M14 50h14M10 64h10M96 70h14"
        stroke="#fffdf6"
        strokeWidth="4"
        strokeLinecap="round"
        opacity=".7"
      />
      <Die value={roll} />
    </>,
  ],
  "Forced Sale": () => [
    "#e58a4e",
    <>
      <House x={18} roof="#2f6fd0" />
      <path d="m50 52 22-10" stroke="#fffdf6" strokeWidth="2" />
      <g transform="rotate(-20 84 40)">
        <path d="M70 30h26l8 10-8 10H70Z" fill="#ef4f4f" />
        <circle cx="76" cy="40" r="3" fill="#fffdf6" />
      </g>
      <path d="M88 66v28m-10-10 10 10 10-10" {...ARROW} strokeWidth={5} />
    </>,
  ],
  Shield: () => [
    "#5cb4e6",
    <>
      <path
        d="M60 16 94 29v27c0 23-15 40-34 48-19-8-34-25-34-48V29Z"
        fill="#2f6fd0"
      />
      <path
        d="M60 27 84 36v20c0 16-10 29-24 36-14-7-24-20-24-36V36Z"
        fill="#bfe3f7"
      />
      <path d="m47 59 9 9 18-20" {...ARROW} stroke="#2f6fd0" strokeWidth={7} />
    </>,
  ],
  Patron: () => [
    "#9b7fd1",
    <>
      <path d="m36 38 2-22 12 11 10-15 10 15 12-11 2 22Z" fill="#ffcf4a" />
      <rect x="36" y="34" width="48" height="8" rx="3" fill="#e0a92e" />
      <House x={42} roof="#ef6f5e" />
      <path d="M98 94V64m-10 10 10-10 10 10" {...ARROW} strokeWidth={5} />
    </>,
  ],
  "Fan Trip": () => [
    "#c95a4a",
    <>
      <path d="M42 18h36v14a18 18 0 0 1-36 0Z" fill="#ffcf4a" />
      <rect x="56" y="48" width="8" height="8" fill="#e0a92e" />
      <rect x="46" y="55" width="28" height="7" rx="3" fill="#8a5a3b" />
      <g transform="rotate(-18 60 86)">
        <rect x="8" y="76" width="104" height="20" fill="#fffdf6" />
        {[16, 40, 64, 88].map((x) => (
          <rect key={x} x={x} y="76" width="12" height="20" fill="#2f6fd0" />
        ))}
      </g>
    </>,
  ],
  Gift: () => [
    "#d9784f",
    <>
      <path
        d="M60 52c-9-14-26-12-22-2 3 6 14 4 22 2Zm0 0c9-14 26-12 22-2-3 6-14 4-22 2Z"
        fill="#ffcf4a"
      />
      <rect x="28" y="60" width="64" height="40" rx="4" fill="#ef6f5e" />
      <rect x="24" y="52" width="72" height="12" rx="3" fill="#d04a3a" />
      <rect x="56" y="52" width="8" height="48" fill="#ffcf4a" />
      <path d="M34 94V80l10-9 10 9v14Z" fill="#fff8e9" />
    </>,
  ],
  "Roll Again": () => [
    "#7cc98a",
    <>
      <path d="M28 52a34 34 0 0 1 60-20" {...ARROW} />
      <path d="m91 16-2 17-16-4" {...ARROW} />
      <Die value={5} />
    </>,
  ],
  "Power Cut": () => [
    "#2b3a55",
    <>
      <path d="M68 14 36 64h22l-8 42 36-56H64Z" fill="#ffd35c" />
      <circle
        cx="60"
        cy="60"
        r="42"
        fill="none"
        stroke="#ef4f4f"
        strokeWidth="8"
      />
      <path
        d="m31 31 58 58"
        stroke="#ef4f4f"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </>,
  ],
};

/** Original flat card drawings: one subject, one background, no fine detail. */
export default function CardArt({
  card,
  roll,
  className,
}: {
  card: ChanceCard;
  roll?: number;
  className?: string;
}) {
  const [background, subject] = ART[card](roll);
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="120" height="120" rx="16" fill={background} />
      <circle cx="60" cy="60" r="46" fill="#fffdf6" opacity=".16" />
      {subject}
    </svg>
  );
}
