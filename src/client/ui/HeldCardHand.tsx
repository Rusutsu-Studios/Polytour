import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import type { GameConfig, KeepCard } from "../../shared/engine/index.js";
import { useDirector } from "../director/director.js";
import { useLocale } from "../i18n.js";
import CardArt from "./CardArt.js";
import { cardName, describeChanceCard } from "./chance-display.js";
import "./HeldCardHand.css";

const PREVIEW_WIDTH = 210;

/** Kept cards beside a player's name; hovering or focusing one shows it large. */
export default function HeldCardHand({
  cards,
  config,
  below,
}: {
  cards: readonly KeepCard[];
  config: GameConfig;
  /** Top HUDs open the preview downwards, bottom HUDs upwards. */
  below: boolean;
}) {
  const { reducedMotion } = useDirector();
  const { t } = useLocale();
  const id = useId();
  const [open, setOpen] = useState<{
    card: KeepCard;
    x: number;
    top: number;
    bottom: number;
  } | null>(null);
  // Centred on the mini card, outside the HUD so the cash stays readable.
  const show = (card: KeepCard) => (event: { currentTarget: HTMLElement }) => {
    const chip = event.currentTarget.getBoundingClientRect();
    const hud = (
      event.currentTarget.closest(".player-card") ?? event.currentTarget
    ).getBoundingClientRect();
    setOpen({
      card,
      x: chip.left + chip.width / 2,
      top: hud.top,
      bottom: hud.bottom,
    });
  };
  const hide = () => setOpen(null);
  const face = open ? describeChanceCard(open.card, config) : null;
  // The HUD body clips its overflow, so the preview lives on the page.
  const preview = (
    <AnimatePresence>
      {open && face && (
        <motion.div
          key={open.card}
          id={id}
          role="tooltip"
          className="held-preview"
          data-card={open.card}
          style={{
            width: PREVIEW_WIDTH,
            left: Math.min(
              Math.max(8, open.x - PREVIEW_WIDTH / 2),
              window.innerWidth - PREVIEW_WIDTH - 8,
            ),
            ...(below
              ? { top: open.bottom + 10 }
              : { bottom: window.innerHeight - open.top + 10 }),
            transformOrigin: below ? "50% 0" : "50% 100%",
          }}
          initial={
            reducedMotion
              ? false
              : { opacity: 0, scale: 0.4, y: below ? -18 : 18, rotate: -6 }
          }
          animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
          exit={
            reducedMotion
              ? { opacity: 0, transition: { duration: 0 } }
              : { opacity: 0, scale: 0.6, y: below ? -10 : 10 }
          }
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
        >
          <CardArt card={open.card} />
          <strong>{face.title}</strong>
          <span>{face.badge}</span>
          <p>{face.text}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return (
    <span className="held-hand">
      {cards.map((card) => (
        <button
          key={card}
          type="button"
          className="held-mini"
          data-card={card}
          aria-label={t(
            `Carte « ${cardName(card)} »`,
            `Card “${cardName(card)}”`,
          )}
          aria-describedby={open?.card === card ? id : undefined}
          onPointerEnter={show(card)}
          onPointerLeave={hide}
          onFocus={show(card)}
          onBlur={hide}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              hide();
            }
          }}
        />
      ))}
      {createPortal(preview, document.body)}
    </span>
  );
}
