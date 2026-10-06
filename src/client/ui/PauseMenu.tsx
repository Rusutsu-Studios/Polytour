import { motion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PublicState, Seat } from "../../shared/engine/index.js";
import { useDirector } from "../director/director.js";
import { useLocale } from "../i18n.js";
import type { RoomDebugState } from "../net/room-debug.js";
import type { PingState } from "../net/use-cloudflare-ping.js";
import Icon from "./Icon.js";
import type { RoomSettingsProps } from "./RoomSettings.js";
import SettingsPanel, { type SettingsTab } from "./SettingsPanel.js";
import "./PauseMenu.css";

type Page = "menu" | "settings" | "confirm-leave";

export type { SettingsTab } from "./SettingsPanel.js";

export type PauseMenuProps = {
  game: PublicState | null;
  initialSettingsTab?: SettingsTab;
  mySeats: readonly Seat[];
  blocked: boolean;
  solo: boolean;
  onRequestPause: () => void;
  onVote: (seat: Seat, accept: boolean) => void;
  onResume: () => void;
  error: string | null;
  onClose: () => void;
  onLeave: () => void;
  debugAvailable: boolean;
  connection: string;
  ping: PingState;
  roomDebug: RoomDebugState | null;
  /** Null while this screen waits for a place in the room. */
  ownSeat: Seat | null;
  onDebugActiveChange: (active: boolean) => void;
  /** The bank's running totals, from the authoritative match state. */
  bank: { received: number; paidOut: number; balance: number } | null;
  /** The room rules, when this screen belongs to a room. Null on the home screen. */
  rules?: RoomSettingsProps | null;
  /** False when this screen was opened only to be read, leaving a solo game running. */
  willPause?: boolean;
};

// THESIS: A small pause sheet lets the player adjust their view and return to play.
// OWN-WORLD: Ivory paper, a blue ribbon and pressed toy buttons match the board.
// STORY: Continue first; settings stay one step away, and leaving is deliberate.
// FIRST VIEWPORT: A quiet three-action menu; tabs replace its body on request.
// FORM: Native dialog focus protects settings and each human's pause consent.
export default function PauseMenu({
  game,
  initialSettingsTab,
  mySeats,
  blocked,
  solo,
  onRequestPause,
  onVote,
  onResume,
  error,
  onClose,
  onLeave,
  debugAvailable,
  connection,
  ping,
  roomDebug,
  ownSeat,
  onDebugActiveChange,
  bank,
  rules = null,
  willPause = true,
}: PauseMenuProps) {
  const { t } = useLocale();
  const { reducedMotion } = useDirector();
  const [page, setPage] = useState<Page>(
    !game || initialSettingsTab ? "settings" : "menu",
  );
  const [debugActive, setDebugActive] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("video");
  const [now, setNow] = useState(Date.now());
  const paused = game?.pause?.kind === "paused";
  const vote = game?.pause?.kind === "vote" ? game.pause : null;
  const eligible = (game?.players ?? []).filter(
    (player) =>
      player.control === "human" &&
      !player.bankrupt &&
      mySeats.includes(player.seat),
  );
  const canResume = paused && eligible.length > 0;
  const pauseNote = paused
    ? t(
        "La partie est en pause. Les tours et les chronomètres sont arrêtés.",
        "The game is paused. Turns and clocks are stopped.",
      )
    : willPause && solo && eligible.length > 0 && game?.status === "active"
      ? t("Mise en pause de la partie…", "Pausing the game…")
      : null;
  const cooldown = Math.max(
    0,
    Math.ceil(((game?.pauseCooldownUntil ?? 0) - now) / 1000),
  );
  const countdown = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  useEffect(() => {
    if (!vote && cooldown === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [vote, cooldown]);
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<"continue" | "settings" | "leave">("continue");
  const handleDebugActiveChange = useCallback(
    (active: boolean) => {
      setDebugActive(active);
      onDebugActiveChange(active);
    },
    [onDebugActiveChange],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (page === "settings") headingRef.current?.focus();
    else if (page === "confirm-leave") stayRef.current?.focus();
    else {
      const target =
        returnTo.current === "settings"
          ? settingsRef.current
          : returnTo.current === "leave"
            ? leaveRef.current
            : continueRef.current;
      target?.focus();
    }
  }, [page]);

  useEffect(() => {
    // A pause acknowledgement can disable Continue or remove a vote button.
    // Restore Resume without overriding focus returned from settings or Leave.
    const focusLost =
      document.activeElement === document.body ||
      document.activeElement === dialogRef.current;
    if (
      paused &&
      !blocked &&
      page === "menu" &&
      (returnTo.current === "continue" || focusLost)
    ) {
      continueRef.current?.focus();
    }
  }, [paused, blocked, page]);

  const backToMenu = () => {
    returnTo.current = page === "settings" ? "settings" : "leave";
    setPage("menu");
  };
  // Leaders send their rule changes once, whichever way the panel closes.
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const flushed = useRef(false);
  const dirty = Boolean(rules?.save?.dirty);
  useEffect(() => {
    if (dirty) flushed.current = false;
  }, [dirty]);
  const flushRules = useCallback(() => {
    const current = rulesRef.current;
    if (flushed.current || !current || current.disabled) return;
    if (!current.save?.dirty) return;
    flushed.current = true;
    current.save.onSave();
  }, []);
  useEffect(() => flushRules, [flushRules]);
  const closePanel = () => {
    flushRules();
    onClose();
  };
  const dismiss = () => {
    flushRules();
    if (!game || page === "menu") onClose();
    else backToMenu();
  };
  const title =
    page === "settings"
      ? t("Réglages", "Settings")
      : page === "confirm-leave"
        ? t("Quitter la partie ?", "Leave the game?")
        : t("Menu pause", "Pause menu");

  return createPortal(
    <dialog
      ref={dialogRef}
      className="pause-dialog"
      data-debug={debugActive}
      data-tab={page === "settings" ? activeTab : undefined}
      aria-labelledby={`${id}-title`}
      aria-describedby={pauseNote ? `${id}-note` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
    >
      <motion.div
        className="pause-dialog-frame"
        initial={reducedMotion ? false : { opacity: 0.85, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
      >
        <header className="pause-dialog-header">
          {game && page !== "menu" && (
            <button
              type="button"
              className="pause-back"
              aria-label={t("Retour au menu pause", "Back to pause menu")}
              onClick={backToMenu}
            >
              <Icon name="arrow" size={21} />
            </button>
          )}
          <h2 ref={headingRef} id={`${id}-title`} tabIndex={-1}>
            {title}
          </h2>
          <button
            type="button"
            className="pause-close"
            aria-label={
              game
                ? t("Revenir au plateau", "Back to the board")
                : t("Fermer les réglages", "Close settings")
            }
            onClick={closePanel}
          >
            <Icon name="close" size={23} />
          </button>
        </header>
        <div className="pause-dialog-body">
          {pauseNote && (
            <p className="pause-note" id={`${id}-note`}>
              {pauseNote}
            </p>
          )}
          {error && (
            <p className="pause-error" role="alert">
              {error}
            </p>
          )}
          {game && vote && (
            <section
              className="pause-vote"
              aria-label={t("Vote de pause", "Pause vote")}
            >
              <p role="status">
                {t("Pause demandée par ", "Pause requested by ")}
                <strong>
                  {
                    game.players.find(
                      (player) => player.seat === vote.requestedBy,
                    )?.name
                  }
                </strong>
                {` · ${vote.acceptedSeats.length}/${vote.requiredSeats.length} · ${countdown(Math.max(0, Math.ceil((vote.deadline - now) / 1000)))}`}
              </p>
              <p>
                {t(
                  "Tous les joueurs humains doivent accepter. La partie continue pendant le vote.",
                  "Every human player must agree. Play continues during the vote.",
                )}
              </p>
              <ul>
                {vote.requiredSeats.map((seat) => {
                  const player = game.players.find(
                    (entry) => entry.seat === seat,
                  );
                  const accepted = vote.acceptedSeats.includes(seat);
                  return (
                    <li key={seat}>
                      <span>{player?.name}</span>
                      <strong>
                        {accepted
                          ? t("D’accord", "Agreed")
                          : t("En attente", "Waiting")}
                      </strong>
                      {mySeats.includes(seat) && !accepted && (
                        <div className="pause-vote-actions">
                          <button
                            type="button"
                            className="pause-action pause-primary"
                            disabled={blocked}
                            aria-label={t(
                              `Accepter la pause pour ${player?.name}`,
                              `Accept pause for ${player?.name}`,
                            )}
                            onClick={() => onVote(seat, true)}
                          >
                            {t("Accepter", "Accept")}
                          </button>
                          <button
                            type="button"
                            className="pause-action pause-secondary"
                            disabled={blocked}
                            aria-label={t(
                              `Refuser la pause pour ${player?.name}`,
                              `Decline pause for ${player?.name}`,
                            )}
                            onClick={() => onVote(seat, false)}
                          >
                            {t("Refuser", "Decline")}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {game &&
            !solo &&
            !game.pause &&
            game.status === "active" &&
            eligible.length > 0 && (
              <div className="pause-request">
                <button
                  type="button"
                  className="pause-action pause-secondary"
                  disabled={blocked || cooldown > 0}
                  onClick={onRequestPause}
                >
                  <Icon name="pause" size={18} />
                  {t("Demander une pause", "Request pause")}
                </button>
                <p>
                  {cooldown > 0
                    ? t(
                        `Nouvelle demande dans ${countdown(cooldown)}.`,
                        `Next request in ${countdown(cooldown)}.`,
                      )
                    : t(
                        "Une demande toutes les 5 minutes pour la salle.",
                        "One request every 5 minutes for the room.",
                      )}
                </p>
              </div>
            )}
          {game && page === "menu" && (
            <div className="pause-menu-actions">
              <button
                ref={continueRef}
                type="button"
                className="pause-action pause-primary"
                onClick={canResume ? onResume : onClose}
                disabled={canResume && blocked}
              >
                {canResume
                  ? t("Reprendre la partie", "Resume game")
                  : t("Continuer", "Continue")}
                <Icon name="arrow" size={20} />
              </button>
              <button
                ref={settingsRef}
                type="button"
                className="pause-action pause-secondary pause-settings"
                aria-label={t("Réglages", "Settings")}
                title={t("Réglages", "Settings")}
                onClick={() => setPage("settings")}
              >
                <Icon name="settings" size={20} />
                <span>{t("Réglages", "Settings")}</span>
              </button>
              <button
                ref={leaveRef}
                type="button"
                className="pause-action pause-leave"
                onClick={() => setPage("confirm-leave")}
              >
                <Icon name="exit" size={20} />
                {t("Quitter", "Leave")}
              </button>
            </div>
          )}
          {game && page === "confirm-leave" && (
            <div className="pause-leave-confirmation">
              <p>
                {t(
                  "Vous reviendrez à l’accueil. La partie continuera pour les autres joueurs.",
                  "You will return to the lobby. The game will continue for the other players.",
                )}
              </p>
              <button
                ref={stayRef}
                type="button"
                className="pause-action pause-primary"
                onClick={backToMenu}
              >
                {t("Rester dans la partie", "Stay in the game")}
              </button>
              <button
                type="button"
                className="pause-action pause-leave"
                onClick={onLeave}
              >
                <Icon name="exit" size={20} />
                {t("Quitter la partie", "Leave the game")}
              </button>
            </div>
          )}
          {page === "settings" && (
            <SettingsPanel
              initialTab={initialSettingsTab}
              rules={rules}
              onTabChange={setActiveTab}
              debugAvailable={debugAvailable}
              hasGame={Boolean(game)}
              connection={connection}
              ping={ping}
              roomDebug={roomDebug}
              ownSeat={ownSeat}
              onDebugActiveChange={handleDebugActiveChange}
              bank={bank}
            />
          )}
        </div>
      </motion.div>
    </dialog>,
    document.body,
  );
}
