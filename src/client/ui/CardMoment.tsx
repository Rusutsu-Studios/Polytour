import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DECISION_TIMING } from "../../shared/board/index.js";
import type { GameEvent } from "../../shared/engine/index.js";
import {
  type AnimationContext,
  director,
  useDirector,
} from "../director/director.js";
import { useLocale } from "../i18n.js";
import { money, PLAYER_COLORS } from "./board-display.js";
import { type CardDraw, describeCard } from "./chance-display.js";
import Icon from "./Icon.js";
import "./CardMoment.css";

type TaxPayment = Extract<GameEvent, { type: "MoneyTransferred" }>;
type Moment = {
  event: CardDraw | TaxPayment;
  context: AnimationContext;
  readingMs: number;
};

/** One bounded reading moment in the Director queue, before the card's effects. */
export default function CardMoment({
  obscured = false,
}: {
  obscured?: boolean;
}) {
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
        if (
          event.type !== "CardDrawn" &&
          !(
            event.type === "MoneyTransferred" &&
            event.reason === "Tax" &&
            event.from !== null
          )
        )
          return Promise.resolve();
        complete();
        restoreFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        needsFocus.current = false;
        // The engine reserves this reading time before the next decision.
        // Catch-up never compresses a reading moment below six seconds.
        const readingMs =
          event.type === "CardDrawn"
            ? Math.max(
                DECISION_TIMING.taxAnimation,
                DECISION_TIMING.cardAnimation / context.playbackRate,
              )
            : DECISION_TIMING.taxAnimation;
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
    if (!moment || obscured || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, [moment, obscured]);
  useEffect(() => {
    if (moment || busy || obscured || !needsFocus.current) return;
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
  }, [moment, busy, obscured]);
  if (!moment) return null;
  const { event, context, readingMs } = moment;
  const tax = event.type === "MoneyTransferred";
  const seat = event.type === "CardDrawn" ? event.seat : (event.from ?? 0);
  const card =
    event.type === "CardDrawn"
      ? describeCard(event, context.next)
      : {
          title: t("Paiement des impôts", "Tax payment"),
          badge: `- ${money(event.amount)}`,
          text: t(
            "Les impôts ont été versés à la banque.",
            "Tax has been paid to the bank.",
          ),
          art: "fortune",
          tone: "cost",
        };
  const player = context.next.players.find((entry) => entry.seat === seat);
  return createPortal(
    <dialog
      ref={dialog}
      className="chance-dialog"
      data-moment={tax ? "tax" : "card"}
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
        style={{ "--chance-player": PLAYER_COLORS[seat] } as CSSProperties}
        initial={
          reducedMotion ? false : { opacity: 0, scale: 0.9, rotate: -3, y: 24 }
        }
        animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 28 }}
      >
        <header>
          <span className="chance-seal" aria-hidden="true">
            {tax ? <Icon name="bank" size={24} /> : "?"}
          </span>
          <span>
            {tax ? t("Impôts", "Taxes") : t("Carte Surprise", "Chance card")} ·{" "}
            <strong>{player?.name ?? t("Joueur", "Player")}</strong>
          </span>
        </header>
        {tax ? (
          <div className="tax-illustration" aria-hidden="true">
            <Icon name="bank" size={96} />
          </div>
        ) : (
          <img
            className="chance-art"
            src={`/cards/${card.art}.webp`}
            alt=""
            width="600"
            height="400"
            decoding="async"
          />
        )}
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
            key={
              event.type === "CardDrawn"
                ? `${event.seat}-${event.card}`
                : `tax-${seat}-${event.amount}`
            }
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
