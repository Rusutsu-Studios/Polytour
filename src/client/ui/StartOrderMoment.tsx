import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DECISION_TIMING } from "../../shared/board/index.js";
import type { PublicState } from "../../shared/engine/index.js";
import { director, useDirector } from "../director/director.js";
import { useLocale } from "../i18n.js";
import { PLAYER_COLORS } from "./board-display.js";
import "./StartOrderMoment.css";

const CORNERS = [3, 0, 1, 2] as const;
// CSS rotation starts at twelve o'clock; each arrow lands in a HUD quadrant.
const POINTER_ANGLES = [225, 315, 45, 135] as const;

type StartMoment = {
  state: PublicState;
  reducedMotion: boolean;
  duration: number;
};

/** The server's selected starter, presented once in the ordered event queue. */
export default function StartOrderMoment() {
  const { t } = useLocale();
  const { busy } = useDirector();
  const [moment, setMoment] = useState<StartMoment | null>(null);
  const [settled, setSettled] = useState(false);
  const finish = useRef<() => void>(() => {});
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const needsFocus = useRef(false);

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
          event.type !== "GameCreated" ||
          event.state.config.turnOrderRule !== "clockwise"
        )
          return Promise.resolve();
        complete();
        previousFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        needsFocus.current = false;
        setSettled(context.reducedMotion);
        return new Promise<void>((done) => {
          resolve = done;
          const duration =
            DECISION_TIMING.startAnimation / context.playbackRate;
          setMoment({
            state: event.state,
            reducedMotion: context.reducedMotion,
            duration,
          });
          timer = setTimeout(complete, duration);
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
    const previous = previousFocus.current;
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
  const { state, reducedMotion, duration } = moment;
  const starter = state.players.find(
    (player) => player.seat === state.activeSeat,
  );
  const angle = POINTER_ANGLES[state.activeSeat];
  const order = state.startingTurnOrder
    .map((seat) => state.players.find((player) => player.seat === seat))
    .filter((player) => player !== undefined);
  const sectors = [2, 3, 0, 1].map(
    (seat, index) =>
      `${state.players.some((player) => player.seat === seat) ? PLAYER_COLORS[seat] : "#dce3df"} ${index * 90}deg ${(index + 1) * 90}deg`,
  );

  return createPortal(
    <dialog
      ref={dialog}
      className="start-order-dialog"
      data-starter={state.activeSeat}
      data-revealed={settled}
      data-reduced-motion={reducedMotion}
      aria-labelledby="start-order-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        finish.current();
      }}
    >
      <article className="start-order-moment">
        <h2 id="start-order-title">{t("Qui commence ?", "Who starts?")}</h2>
        <div className="start-order-stage">
          <div
            className="start-order-wheel"
            style={{ background: `conic-gradient(${sectors.join(", ")})` }}
            aria-hidden="true"
          >
            <motion.div
              className="start-order-pointer"
              initial={{ rotate: reducedMotion ? angle : 135 }}
              animate={{ rotate: reducedMotion ? angle : 1440 + angle }}
              transition={{
                duration: reducedMotion ? 0 : (duration / 1000) * 0.65,
                ease: [0.16, 1, 0.3, 1],
              }}
              onAnimationComplete={() => setSettled(true)}
            />
            <span className="start-order-hub" />
          </div>
          {CORNERS.map((seat) => {
            const player = state.players.find((entry) => entry.seat === seat);
            if (!player) return null;
            return (
              <div
                key={seat}
                className="start-order-player"
                data-seat={seat}
                data-first={settled && seat === state.activeSeat}
                style={
                  { "--starter-color": PLAYER_COLORS[seat] } as CSSProperties
                }
              >
                <span className="start-order-number" aria-hidden="true">
                  {settled ? state.startingTurnOrder.indexOf(seat) + 1 : "·"}
                </span>
                <strong title={player.name}>{player.name}</strong>
              </div>
            );
          })}
        </div>
        <p className="start-order-result" role="status" aria-live="polite">
          {settled
            ? t(
                `${starter?.name ?? "Le premier joueur"} commence !`,
                `${starter?.name ?? "The first player"} starts!`,
              )
            : ""}
        </p>
        <ol
          className="start-order-sequence"
          aria-label={t("Ordre de jeu", "Turn order")}
          data-revealed={settled}
        >
          {order.map((player, index) => (
            <li key={player.seat} data-seat={player.seat} title={player.name}>
              <span
                className="start-order-number"
                style={
                  {
                    "--starter-color": PLAYER_COLORS[player.seat],
                  } as CSSProperties
                }
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span>{player.name}</span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button blue start-order-continue"
          onClick={() => finish.current()}
        >
          {t("Commencer", "Start playing")}
        </button>
      </article>
    </dialog>,
    document.body,
  );
}
