import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CHANCE_CARDS,
  type ChanceCard,
  type GameConfig,
} from "../../shared/engine/index.js";
import { useDirector } from "../director/director.js";
import { useLocale } from "../i18n.js";
import {
  describeChanceCard,
  describeChanceCardDetails,
} from "./chance-display.js";
import Icon from "./Icon.js";
import "./LuckCardHelp.css";

/** A reference catalogue: browsing cards never draws or plays one. */
export default function LuckCardHelp({ config }: { config: GameConfig }) {
  const { t } = useLocale();
  const { reducedMotion, speed } = useDirector();
  const id = useId();
  const [selected, setSelected] = useState<{
    card: ChanceCard;
    trigger: HTMLButtonElement;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!selected || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    heading.current?.focus();
    return () => {
      element.close();
      if (selected.trigger.isConnected) selected.trigger.focus();
    };
  }, [selected]);

  const card = selected && describeChanceCard(selected.card, config);
  return (
    <>
      <section className="help-cards" aria-labelledby={`${id}-catalogue`}>
        <h3 id={`${id}-catalogue`} tabIndex={-1}>
          {t("Cartes Surprise", "Luck cards")}
        </h3>
        <p>
          {t(
            "Sur une case Surprise, piochez une de ces cartes. Sélectionnez une carte pour lire son effet.",
            "Draw one of these cards when you land on a Chance space. Select a card to read its effect.",
          )}
        </p>
        <ul className="luck-card-list">
          {CHANCE_CARDS.map((entry) => {
            const presentation = describeChanceCard(entry, config);
            return (
              <li key={entry}>
                <button
                  type="button"
                  className="luck-card-button"
                  data-tone={presentation.tone}
                  aria-haspopup="dialog"
                  aria-expanded={selected?.card === entry}
                  aria-controls={`${id}-detail`}
                  onClick={(event) =>
                    setSelected({ card: entry, trigger: event.currentTarget })
                  }
                >
                  <img
                    src={`/cards/${presentation.art}.webp`}
                    alt=""
                    width="60"
                    height="48"
                    loading="lazy"
                    decoding="async"
                  />
                  <span>
                    <strong>{presentation.title}</strong>
                    <span className="luck-card-summary">
                      {presentation.badge}
                    </span>
                  </span>
                  <Icon name="arrow" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {selected &&
        card &&
        createPortal(
          <dialog
            ref={dialog}
            id={`${id}-detail`}
            className="luck-card-dialog"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-description`}
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSelected(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                const buttons = event.currentTarget.querySelectorAll("button");
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                } else if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                }
              }
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setSelected(null);
            }}
            onClose={(event) => event.stopPropagation()}
          >
            <motion.article
              className="luck-card-detail"
              data-tone={card.tone}
              initial={reducedMotion ? false : { opacity: 0.8, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.24 / speed }}
            >
              <header>
                <span>{t("Carte Surprise", "Luck card")}</span>
                <button
                  type="button"
                  className="icon-button luck-card-close"
                  aria-label={t("Retour aux cartes", "Back to cards")}
                  onClick={() => setSelected(null)}
                >
                  <Icon name="close" />
                </button>
              </header>
              <img
                className="luck-card-art"
                src={`/cards/${card.art}.webp`}
                alt=""
                width="600"
                height="400"
                decoding="async"
              />
              <div className="luck-card-copy">
                <h2 ref={heading} id={`${id}-title`} tabIndex={-1}>
                  {card.title}
                </h2>
                <strong className="luck-card-impact">{card.badge}</strong>
                <p id={`${id}-description`} className="luck-card-description">
                  {card.text}
                </p>
                <ul className="luck-card-notes">
                  {describeChanceCardDetails(selected.card, config).map(
                    (note) => (
                      <li key={note}>{note}</li>
                    ),
                  )}
                </ul>
                <button
                  type="button"
                  className="button blue luck-card-back"
                  onClick={() => setSelected(null)}
                >
                  {t("Retour aux cartes", "Back to cards")}
                </button>
              </div>
            </motion.article>
          </dialog>,
          document.body,
        )}
    </>
  );
}
