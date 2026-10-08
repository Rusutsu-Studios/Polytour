import { motion } from "motion/react";
import type { CSSProperties, Ref } from "react";
import type { GameEvent, PublicState } from "../../shared/engine/index.js";
import { useLocale } from "../i18n.js";
import { money, PLAYER_COLORS, tileName } from "./board-display.js";
import "./Notice.css";

type Unaffordable = Extract<GameEvent, { type: "PurchaseUnaffordable" }>;

/** The stage window: an irregular cloud over the board. */
const STAGE =
  "M118 122C150 62 262 74 332 64C424 50 522 42 612 58C706 70 756 132 738 232C728 300 746 360 690 404C600 444 222 446 120 412C60 382 72 302 80 242C86 182 88 150 118 122Z";
/**
 * Generated scenes (docs/CARD_ART.md), one per player colour:
 * `buy-<seat>` and `buyout-<buyer seat>-<owner seat>`.
 */
const SCENES = import.meta.glob<string>("./notice/*.webp", {
  eager: true,
  import: "default",
});
/**
 * Where each kind of scene holds its blank price sign: centre and width in the
 * 800 x 470 stage, where the image covers the stage.
 */
const SIGNS = {
  buy: { x: 532, y: 257, width: 236 },
  buyout: { x: 530, y: 265, width: 231 },
} as const;

/** The scene in its cloud, with the real price written on its blank sign. */
function NoticeArt({ scene, price }: { scene: string; price: string }) {
  const sign = SIGNS[scene.startsWith("buyout") ? "buyout" : "buy"];
  return (
    <svg className="notice-art" viewBox="0 0 800 470" aria-hidden="true">
      <defs>
        <clipPath id="notice-stage">
          <path d={STAGE} />
        </clipPath>
      </defs>
      <path d={STAGE} fill="#fffdf6" stroke="#fffdf6" strokeWidth="14" />
      <image
        href={SCENES[`./notice/${scene}.webp`]}
        width="800"
        height="470"
        preserveAspectRatio="xMidYMid slice"
        clipPath="url(#notice-stage)"
      />
      <text
        x={sign.x}
        y={sign.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Trebuchet MS, Segoe UI, sans-serif"
        // About 0.6 em per character keeps "1,16 M" inside the sign too.
        fontSize={Math.min(sign.width / 4, (sign.width * 1.3) / price.length)}
        fontWeight="900"
        fill="#203c42"
      >
        {price}
      </text>
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
          scene={
            buyout && owner !== null
              ? `buyout-${event.seat}-${owner}`
              : `buy-${event.seat}`
          }
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
