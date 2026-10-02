import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DECISION_TIMING } from "../../shared/board/index.js";
import {
  type AnimationContext,
  director,
  useDirector,
} from "../director/director.js";
import { useLocale } from "../i18n.js";
import { PLAYER_COLORS, PLAYER_SYMBOLS } from "./board-display.js";
import { type CardDraw, describeCard } from "./chance-display.js";
import "./CardMoment.css";

type Moment = { event: CardDraw; context: AnimationContext; readingMs: number };

/** One bounded reading moment in the Director queue, before the card's effects. */
export default function CardMoment() {
  const { t } = useLocale();
  const [moment, setMoment] = useState<Moment | null>(null);
  const finish = useRef<() => void>(() => {});
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const needsFocus = useRef(false);
  const { reducedMotion, busy } = useDirector();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolve: (() => void) | undefined;
    const complete = () => {
      clearTimeout(timer);
      timer = undefined;
      if (resolve) needsFocus.current = true;
      setMoment(null);
      const done = resolve;
      resolve = undefined;
      done?.();
    };
    finish.current = complete;
    return director.registerPresenter({
      animate(event, context) {
        if (event.type !== "CardDrawn") return Promise.resolve();
        complete();
        restoreFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        needsFocus.current = false;
        // The engine reserves this reading time before the next decision.
        const readingMs = DECISION_TIMING.cardAnimation / context.speed;
        return new Promise<void>((done) => {
          resolve = done;
          setMoment({ event, context, readingMs });
          timer = setTimeout(complete, readingMs);
        });
      },
      cancel: complete,
      snap: complete,
    });
  }, []);
  useEffect(() => {
    if (!moment || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, [moment]);
  useEffect(() => {
    if (moment || busy || !needsFocus.current) return;
    needsFocus.current = false;
    const previous = restoreFocus.current;
    if (
      previous?.isConnected &&
      previous !== document.body &&
      !previous.matches(":disabled")
    )
      previous.focus();
    else
      document
        .querySelector<HTMLElement>(".decision-compact .roll-button")
        ?.focus();
  }, [moment, busy]);
  if (!moment) return null;
  const { event, context, readingMs } = moment;
  const card = describeCard(event, context.next);
  const player = context.next.players.find(
    (entry) => entry.seat === event.seat,
  );
  return createPortal(
    <dialog
      ref={dialog}
      className="chance-dialog"
      aria-labelledby="chance-title"
      aria-describedby="chance-description"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        finish.current();
      }}
    >
      <motion.article
        className="chance-card"
        data-tone={card.tone}
        style={
          { "--chance-player": PLAYER_COLORS[event.seat] } as CSSProperties
        }
        initial={
          reducedMotion ? false : { opacity: 0, scale: 0.9, rotate: -3, y: 24 }
        }
        animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 28 }}
      >
        <header>
          <span className="chance-seal" aria-hidden="true">
            ?
          </span>
          <span>
            {t("Carte Surprise", "Chance card")} ·{" "}
            <strong>{player?.name ?? t("Joueur", "Player")}</strong>
          </span>
          <i aria-hidden="true">{PLAYER_SYMBOLS[event.seat]}</i>
        </header>
        <img
          className="chance-art"
          src={`/cards/${card.art}.webp`}
          alt=""
          width="600"
          height="400"
          decoding="async"
        />
        <div className="chance-copy">
          <h2 id="chance-title">{card.title}</h2>
          <strong className="chance-impact">{card.badge}</strong>
          <p id="chance-description">{card.text}</p>
          <button
            type="button"
            className="button blue chance-continue"
            onClick={() => finish.current()}
          >
            {t("Continuer", "Continue")} <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div className="chance-reading" aria-hidden="true">
          <motion.i
            key={`${event.seat}-${event.card}`}
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: readingMs / 1000, ease: "linear" }}
          />
        </div>
      </motion.article>
    </dialog>,
    document.body,
  );
}
