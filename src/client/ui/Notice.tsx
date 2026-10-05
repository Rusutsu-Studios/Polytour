import { motion } from "motion/react";
import type { CSSProperties, Ref } from "react";
import type { GameEvent, PublicState } from "../../shared/engine/index.js";
import { useLocale } from "../i18n.js";
import { money, PLAYER_COLORS, tileName } from "./board-display.js";
import "./Notice.css";

type Unaffordable = Extract<GameEvent, { type: "PurchaseUnaffordable" }>;

const SKIN = "#f4c7a1";
const SKIN_SHADE = "#e0a57f";
const INK = "#2b2b3a";
/** The stage window: an irregular cloud the characters step out of. */
const STAGE =
  "M118 122C150 62 262 74 332 64C424 50 522 42 612 66C694 88 742 142 730 232C722 300 746 360 690 404C600 444 222 446 120 412C60 382 72 302 80 242C86 182 88 150 118 122Z";

/** Suit, shirt, tie and trousers shared by both characters, feet at 0 0. */
function Body({ suit }: { suit: string }) {
  return (
    <>
      <path d="M-40-120-44 0H-6l4-96h4L6 0h38l-4-120Z" fill="#2b3550" />
      <path
        d="M-64-214c-10 44-2 84 10 110H54c12-26 20-66 10-110-24-18-104-18-128 0Z"
        fill={suit}
      />
      <path d="M-22-228 0-164l22-64Z" fill="#fffdf6" />
      <path d="M-6-222H6l4 42-10 14-10-14Z" fill={suit} />
      <path d="M-6-222H6l4 42-10 14-10-14Z" fill="#000" opacity=".28" />
      <path
        d="m-22-228 18 78m26-78-18 78"
        stroke="#000"
        strokeOpacity=".2"
        strokeWidth="4"
        fill="none"
      />
      <rect x="-12" y="-254" width="24" height="28" rx="8" fill={SKIN_SHADE} />
    </>
  );
}

function Arm({ d, suit }: { d: string; suit: string }) {
  return (
    <path
      d={d}
      stroke={suit}
      strokeWidth="26"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

function Head() {
  return (
    <>
      <circle cx="-38" cy="-282" r="8" fill={SKIN_SHADE} />
      <circle cx="38" cy="-282" r="8" fill={SKIN_SHADE} />
      <ellipse cx="0" cy="-286" rx="38" ry="42" fill={SKIN} />
    </>
  );
}

/** The property's owner, or the bank's agent: pleased, one finger raised. */
function Owner({ suit }: { suit: string }) {
  return (
    <>
      <path
        d="M-48-282c-6-58 102-58 96 0 2 20-8 32-18 30h-60c-10 2-20-10-18-30Z"
        fill="#3b2f63"
      />
      <Arm d="m-58-200-34 50 36 32" suit={suit} />
      <circle cx="-54" cy="-118" r="11" fill={SKIN} />
      <Body suit={suit} />
      <Arm d="m58-200 34 28 8-64" suit={suit} />
      <rect x="95" y="-276" width="10" height="32" rx="5" fill={SKIN} />
      <circle cx="100" cy="-240" r="12" fill={SKIN} />
      <Head />
      <path d="M-40-290c4-42 70-48 82-8-18-16-46-18-82 8Z" fill="#3b2f63" />
      <path
        d="M-26-305q10-7 19-1m33 1q-10-7-19-1"
        stroke={INK}
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="-15" cy="-287" rx="8" ry="9.5" fill="#fff" />
      <ellipse cx="15" cy="-287" rx="8" ry="9.5" fill="#fff" />
      <circle cx="-12" cy="-286" r="4.6" fill={INK} />
      <circle cx="18" cy="-286" r="4.6" fill={INK} />
      <path d="M-11-263q11 12 22 0-11 4-22 0Z" fill="#d9534f" />
    </>
  );
}

/** The player who cannot pay: pockets turned out, scratching their head. */
function Broke({ suit }: { suit: string }) {
  return (
    <>
      <Body suit={suit} />
      <path
        d="M-50-108c-16 8-14 30-2 34 10 2 16-12 12-32Z"
        fill="#fffdf6"
        stroke="#d8cdb8"
        strokeWidth="2"
      />
      <path
        d="M50-108c16 8 14 30 2 34-10 2-16-12-12-32Z"
        fill="#fffdf6"
        stroke="#d8cdb8"
        strokeWidth="2"
      />
      <Arm d="m-58-200-28 50-38-20" suit={suit} />
      <ellipse
        cx="-134"
        cy="-176"
        rx="15"
        ry="9"
        transform="rotate(-24 -134 -176)"
        fill={SKIN}
      />
      <Head />
      <path
        d="M-40-284c-6-46 30-56 46-50 24-14 48 8 34 50-4-20-18-28-36-26-20-2-36 6-44 26Z"
        fill="#6b3a2a"
      />
      <path
        d="m-27-301 18-8m36 8-18-8"
        stroke={INK}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <ellipse cx="-15" cy="-287" rx="8" ry="9.5" fill="#fff" />
      <ellipse cx="15" cy="-287" rx="8" ry="9.5" fill="#fff" />
      <circle cx="-15" cy="-283" r="4.6" fill={INK} />
      <circle cx="15" cy="-283" r="4.6" fill={INK} />
      <path
        d="M-11-257q11-9 22 0"
        stroke="#7a3b2e"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M-50-314q-8 12 0 16 8-4 0-16Z" fill="#7cc8ef" />
      <Arm d="m58-200 40-50-50-56" suit={suit} />
      <circle cx="46" cy="-306" r="13" fill={SKIN} />
    </>
  );
}

function Coin({ x, y, turn }: { x: number; y: number; turn: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <g className="notice-float">
        <ellipse cy="5" rx="22" ry="10" fill="#c98712" />
        <ellipse rx="22" ry="10" fill="#ffc93c" />
        <ellipse
          rx="13"
          ry="5.5"
          fill="none"
          stroke="#e8a521"
          strokeWidth="2.5"
        />
      </g>
    </g>
  );
}

function Bill({ x, y, turn }: { x: number; y: number; turn: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <g className="notice-float">
        <rect x="-30" y="-15" width="60" height="30" rx="3" fill="#7fc47a" />
        <rect
          x="-25"
          y="-10"
          width="50"
          height="20"
          rx="2"
          fill="none"
          stroke="#4f9a4b"
          strokeWidth="2"
        />
        <circle r="6" fill="#4f9a4b" />
      </g>
    </g>
  );
}

function Alarm({ x, y, turn }: { x: number; y: number; turn: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <g className="notice-pop">
        <path d="M-8-44h16l-4 34h-8Z" fill="#ef6f5e" />
        <circle cy="4" r="7" fill="#ef6f5e" />
      </g>
    </g>
  );
}

/** Original drawing: the city on a price sign, its owner, and empty pockets. */
function NoticeArt({
  buyer,
  owner,
  price,
}: {
  buyer: string;
  /** The owner's colour for a buyout; null for a free city sold by the bank. */
  owner: string | null;
  price: string;
}) {
  return (
    <svg
      className="notice-art"
      viewBox="0 0 800 470"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="notice-stage">
          <path d={STAGE} />
        </clipPath>
        <linearGradient id="notice-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fd3f2" />
          <stop offset=".7" stopColor="#e6f7fd" />
        </linearGradient>
      </defs>
      <path d={STAGE} fill="#fffdf6" stroke="#fffdf6" strokeWidth="14" />
      <g clipPath="url(#notice-stage)">
        <rect width="800" height="470" fill="url(#notice-sky)" />
        <circle cx="560" cy="128" r="44" fill="#fff4c4" opacity=".6" />
        <circle cx="560" cy="128" r="26" fill="#ffe28a" />
        <g fill="#fff">
          <ellipse cx="262" cy="100" rx="46" ry="16" />
          <ellipse cx="288" cy="86" rx="28" ry="18" />
          <ellipse cx="452" cy="78" rx="38" ry="13" />
          <ellipse cx="472" cy="68" rx="22" ry="14" />
        </g>
        <path
          d="M84 340V268h34v-30h26v102m18 0V250h40v90m20 0V284h30v-46h28v102m216 0V246h36v-24h22v118m18 0V270h44v70m16 0V230h32v110"
          fill="#c4e4f2"
        />
        <path
          d="M300 190q7-7 14 0 7-7 14 0m120-48q6-6 12 0 6-6 12 0m-60 70q5-5 10 0 5-5 10 0"
          stroke="#5a7d8c"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <rect y="336" width="800" height="50" fill="#a5c957" />
        <rect y="336" width="800" height="8" fill="#95b949" />
        <rect y="382" width="800" height="90" fill="#ece5d6" />
        <rect y="382" width="800" height="7" fill="#d6ccb8" />
        <g transform="translate(372 362)">
          {owner ? (
            <>
              <rect x="22" y="-212" width="18" height="44" fill="#c9b9a0" />
              <rect x="-62" y="-150" width="124" height="150" fill="#fff6e6" />
              <path d="M-78-146 0-210l78 64Z" fill={owner} />
              <path d="M-78-146 0-210l78 64Z" fill="#000" opacity=".12" />
              <g fill="#3b5b7a" stroke="#fffdf6" strokeWidth="4">
                <rect x="-46" y="-128" width="32" height="34" />
                <rect x="14" y="-128" width="32" height="34" />
                <rect x="-46" y="-78" width="32" height="34" />
              </g>
              <rect x="14" y="-66" width="30" height="66" rx="4" fill={owner} />
              <path d="M0-210v-46" stroke="#5a4a3c" strokeWidth="4" />
              <path d="M2-256 38-245 2-234Z" fill={owner} />
            </>
          ) : (
            <>
              <path d="M-96 0-74-30H74L96 0Z" fill="#d1b07c" />
              <path
                d="M-58-24v-120h116v120M-74-140 0-200l74 60"
                stroke="#fffdf6"
                strokeWidth="5"
                strokeDasharray="12 9"
                strokeLinejoin="round"
                fill="none"
              />
            </>
          )}
        </g>
        <path d="M524 222v150" stroke="#8a5a3b" strokeWidth="9" />
        <rect
          x="466"
          y="174"
          width="116"
          height="52"
          rx="6"
          fill="#fffdf6"
          stroke="#8a5a3b"
          strokeWidth="6"
        />
        <text
          x="524"
          y="211"
          textAnchor="middle"
          fontFamily="Trebuchet MS, Segoe UI, sans-serif"
          fontSize="30"
          fontWeight="900"
          fill="#203c42"
        >
          {price}
        </text>
      </g>
      <Bill x={96} y={128} turn={-22} />
      <Bill x={560} y={36} turn={24} />
      <Coin x={340} y={50} turn={-16} />
      <Coin x={452} y={302} turn={12} />
      <Coin x={40} y={214} turn={20} />
      <Coin x={772} y={300} turn={-24} />
      <g transform="translate(160 482) scale(1.22)">
        <Owner suit={owner ?? "#3f7f8c"} />
      </g>
      <g transform="translate(664 482) scale(1.3)">
        <Broke suit={buyer} />
      </g>
      <Alarm x={618} y={52} turn={-20} />
      <Alarm x={704} y={46} turn={18} />
    </svg>
  );
}

/** Everyone sees when a player cannot pay for the city they landed on. */
export default function PurchaseNotice({
  ref,
  event,
  state,
  own,
  readingMs,
  reducedMotion,
  onDone,
}: {
  ref: Ref<HTMLDialogElement>;
  event: Unaffordable;
  state: PublicState;
  /** The viewer is this player, so the notice says "you". */
  own: boolean;
  readingMs: number;
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const name =
    state.players.find((player) => player.seat === event.seat)?.name ??
    t("Joueur", "Player");
  const cash =
    state.players.find((player) => player.seat === event.seat)?.cash ?? 0;
  const city = tileName(event.tile, state.config);
  const buyout = event.purchase === "buyout";
  const owner =
    state.properties.find((property) => property.tile === event.tile)?.owner ??
    null;
  const verbFr = buyout ? "racheter" : "acheter";
  const verbEn = buyout ? "buy out" : "buy";
  const headline = own
    ? t(
        `Vous n’avez pas assez d’argent pour ${verbFr} ${city}`,
        `You don’t have enough money to ${verbEn} ${city}`,
      )
    : t(
        `${name} n’a pas assez d’argent pour ${verbFr} ${city}`,
        `${name} doesn’t have enough money to ${verbEn} ${city}`,
      );
  return (
    <dialog
      ref={ref}
      className="notice-dialog"
      data-moment="notice"
      data-reduced-motion={reducedMotion}
      aria-labelledby="notice-title"
      aria-describedby="notice-description"
      onKeyDown={(keyboard) => {
        if (keyboard.key === "Escape") keyboard.stopPropagation();
      }}
      onCancel={(cancel) => {
        cancel.preventDefault();
        onDone();
      }}
      style={{ "--notice-player": PLAYER_COLORS[event.seat] } as CSSProperties}
    >
      <motion.div
        className="notice-stage"
        initial={reducedMotion ? false : { opacity: 0, scale: 0.86, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
      >
        <NoticeArt
          buyer={PLAYER_COLORS[event.seat]}
          owner={buyout && owner !== null ? PLAYER_COLORS[owner] : null}
          price={money(event.price)}
        />
        <motion.div
          className="notice-banner"
          initial={reducedMotion ? false : { opacity: 0, y: 40, rotate: -2 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{
            delay: 0.12,
            type: "spring",
            stiffness: 380,
            damping: 26,
          }}
        >
          <div className="notice-paper">
            <h2 id="notice-title">{headline}</h2>
            <p id="notice-description">
              {buyout ? t("Rachat", "Buyout") : t("Prix", "Price")}{" "}
              <strong>{money(event.price)}</strong> · {t("Argent", "Cash")}{" "}
              <strong>{money(cash)}</strong>
            </p>
            <div className="notice-reading" aria-hidden="true">
              <motion.i
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: readingMs / 1000, ease: "linear" }}
              />
            </div>
          </div>
        </motion.div>
        <button type="button" className="notice-continue" onClick={onDone}>
          {t("Continuer", "Continue")} <span aria-hidden="true">↗</span>
        </button>
      </motion.div>
    </dialog>
  );
}
