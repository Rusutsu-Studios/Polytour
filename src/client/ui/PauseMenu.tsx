import { motion } from "motion/react";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { PublicState, Seat } from "../../shared/engine/index.js";
import { BOARD_ZOOM, clampBoardZoom } from "../board-view.js";
import { director, useDirector } from "../director/director.js";
import { useLocale } from "../i18n.js";
import type { RoomDebugState } from "../net/room-debug.js";
import type { PingState } from "../net/use-cloudflare-ping.js";
import ActionButton from "./ActionButton.js";
import { fullMoney } from "./board-display.js";
import GraphicsToggle from "./GraphicsToggle.js";
import Icon from "./Icon.js";
import RoomDebug, { translatedRegion } from "./RoomDebug.js";
import StreamerToggle from "./StreamerToggle.js";
import "./PauseMenu.css";

type Page = "menu" | "settings" | "confirm-leave";
export type SettingsTab = "game" | "video" | "audio" | "debug";
const TABS: readonly SettingsTab[] = ["game", "video", "audio", "debug"];

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
  zoom: number;
  onZoom: (zoom: number) => void;
  onViewReset: () => void;
  zoomAvailable: boolean;
  viewLocked: boolean;
  onViewLockedChange: (locked: boolean) => void;
  streamer: boolean;
  onStreamerChange: (enabled: boolean) => void;
  lowGraphics: boolean;
  onGraphicsChange: (low: boolean) => void;
  connection: string;
  ping: PingState;
  roomDebug: RoomDebugState | null;
  /** Null while this screen waits for a place in the room. */
  ownSeat: Seat | null;
  onDebugActiveChange: (active: boolean) => void;
  /** The bank's running totals, from the authoritative match state. */
  bank: { received: number; paidOut: number; balance: number } | null;
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
  zoom,
  onZoom,
  onViewReset,
  zoomAvailable,
  viewLocked,
  onViewLockedChange,
  streamer,
  onStreamerChange,
  lowGraphics,
  onGraphicsChange,
  connection,
  ping,
  roomDebug,
  ownSeat,
  onDebugActiveChange,
  bank,
}: PauseMenuProps) {
  const { locale, setLocale, t } = useLocale();
  const { reducedMotion } = useDirector();
  const [page, setPage] = useState<Page>(
    !game || initialSettingsTab ? "settings" : "menu",
  );
  const [tab, setTab] = useState<SettingsTab>(
    initialSettingsTab ?? (game ? "game" : "video"),
  );
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
    : solo && eligible.length > 0 && game?.status === "active"
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
  const tabRefs = useRef<
    Partial<Record<SettingsTab, HTMLButtonElement | null>>
  >({});
  const returnTo = useRef<"continue" | "settings" | "leave">("continue");
  const debugActive = page === "settings" && tab === "debug";
  const sample = ping.status === "success" ? ping.value : null;
  const unavailable = t("Indisponible", "Unavailable");
  const entryPoint =
    sample?.runtime === "local"
      ? t("Local", "Local")
      : sample?.colo
        ? [sample.colo, sample.location].filter(Boolean).join(" · ")
        : unavailable;
  const regionLabel = translatedRegion(sample?.region ?? null, t);

  // Stop room-diagnostic traffic before timers or events can see a closed tab.
  useLayoutEffect(() => {
    onDebugActiveChange(debugActive);
    return () => onDebugActiveChange(false);
  }, [debugActive, onDebugActiveChange]);

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
  const dismiss = () => {
    if (!game || page === "menu") onClose();
    else backToMenu();
  };
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(tab);
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (index + TABS.length - 1) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = TABS[nextIndex];
    if (!next) return;
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const tabLabels: Record<SettingsTab, string> = {
    game: t("Jeu", "Game"),
    video: t("Vidéo", "Video"),
    audio: "Audio",
    debug: t("Débogage", "Debug"),
  };
  const connectionLabel =
    connection === "online"
      ? t("Connectée", "Connected")
      : connection === "offline"
        ? t("Hors ligne", "Offline")
        : connection === "connecting"
          ? t("Connexion en cours…", "Connecting…")
          : t("Reconnexion en cours…", "Reconnecting…");
  const title =
    page === "settings"
      ? t("Réglages", "Settings")
      : page === "confirm-leave"
        ? t("Quitter la partie ?", "Leave the game?")
        : t("Menu pause", "Pause menu");
  const zoomDisabled = !zoomAvailable || viewLocked;
  const zoomDisabledReason = !zoomAvailable
    ? t(
        "Le zoom est disponible sur le plateau 3D.",
        "Zoom is available on the 3D board.",
      )
    : t(
        "Déverrouillez la vue du plateau pour ajuster le zoom.",
        "Unlock the board view to adjust zoom.",
      );

  return createPortal(
    <dialog
      ref={dialogRef}
      className="pause-dialog"
      data-debug={debugActive}
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
            onClick={onClose}
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
            <>
              <div
                className="pause-tabs"
                role="tablist"
                aria-label={t("Catégories de réglages", "Settings categories")}
              >
                {TABS.map((value) => (
                  <button
                    key={value}
                    ref={(element) => {
                      tabRefs.current[value] = element;
                    }}
                    id={`${id}-tab-${value}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    aria-controls={`${id}-panel-${value}`}
                    tabIndex={tab === value ? 0 : -1}
                    onClick={() => setTab(value)}
                    onKeyDown={handleTabKey}
                  >
                    {tabLabels[value]}
                  </button>
                ))}
              </div>
              {TABS.map((value) => (
                <div
                  key={value}
                  id={`${id}-panel-${value}`}
                  className="pause-tab-panel"
                  role="tabpanel"
                  aria-labelledby={`${id}-tab-${value}`}
                  hidden={tab !== value}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tab panels without controls need a keyboard focus target.
                  tabIndex={0}
                >
                  {value === "game" && (
                    <div className="pause-game-settings">
                      <div className="pause-setting">
                        <label htmlFor={`${id}-language`}>
                          {t("Langue", "Language")}
                        </label>
                        <select
                          id={`${id}-language`}
                          value={locale}
                          onChange={(event) =>
                            setLocale(event.target.value === "en" ? "en" : "fr")
                          }
                        >
                          <option value="fr">Français</option>
                          <option value="en">English</option>
                        </select>
                      </div>
                      <div className="pause-streamer-setting">
                        <StreamerToggle
                          enabled={streamer}
                          onChange={onStreamerChange}
                        />
                        <strong aria-hidden="true">
                          {streamer ? t("Activé", "On") : t("Désactivé", "Off")}
                        </strong>
                        <p>
                          {t(
                            "Masque le code de salle et de connexion.",
                            "Hides the room code and masks it when joining.",
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                  {value === "video" && (
                    <div className="pause-video-settings">
                      <div className="pause-setting">
                        <ActionButton
                          type="button"
                          className="pause-action pause-primary pause-view-default"
                          disabled={!zoomAvailable}
                          disabledReason={t(
                            "Le recentrage est disponible sur le plateau 3D.",
                            "Reset view is available on the 3D board.",
                          )}
                          onClick={onViewReset}
                        >
                          <Icon name="reset" size={20} />
                          {t("Vue par défaut", "Default view")}
                        </ActionButton>
                        <label className="pause-view-lock">
                          <input
                            type="checkbox"
                            checked={viewLocked}
                            onChange={(event) =>
                              onViewLockedChange(event.target.checked)
                            }
                          />
                          {t(
                            "Verrouiller la vue du plateau",
                            "Lock board view",
                          )}
                        </label>
                        <span id={`${id}-zoom-label`}>
                          {t("Zoom du plateau", "Board zoom")}
                        </span>
                        <fieldset
                          className="pause-zoom"
                          aria-labelledby={`${id}-zoom-label`}
                        >
                          <ActionButton
                            type="button"
                            aria-label={t("Dézoomer le plateau", "Zoom out")}
                            disabled={zoomDisabled || zoom <= BOARD_ZOOM.min}
                            disabledReason={
                              zoomDisabled
                                ? zoomDisabledReason
                                : t(
                                    "Le plateau est déjà dézoomé au maximum.",
                                    "The board is already zoomed out as far as possible.",
                                  )
                            }
                            onClick={() =>
                              onZoom(clampBoardZoom(zoom - BOARD_ZOOM.step))
                            }
                          >
                            -
                          </ActionButton>
                          <input
                            type="range"
                            className="pause-zoom-slider"
                            min={BOARD_ZOOM.min}
                            max={BOARD_ZOOM.max}
                            step={BOARD_ZOOM.step}
                            value={zoom}
                            disabled={zoomDisabled}
                            aria-labelledby={`${id}-zoom-label`}
                            aria-describedby={`${id}-view-help`}
                            aria-valuetext={`${Math.round(zoom * 100)} %`}
                            onChange={(event) =>
                              onZoom(clampBoardZoom(Number(event.target.value)))
                            }
                          />
                          <ActionButton
                            type="button"
                            aria-label={t("Zoomer le plateau", "Zoom in")}
                            disabled={zoomDisabled || zoom >= BOARD_ZOOM.max}
                            disabledReason={
                              zoomDisabled
                                ? zoomDisabledReason
                                : t(
                                    "Le plateau est déjà zoomé au maximum.",
                                    "The board is already zoomed in as far as possible.",
                                  )
                            }
                            onClick={() =>
                              onZoom(clampBoardZoom(zoom + BOARD_ZOOM.step))
                            }
                          >
                            +
                          </ActionButton>
                          <output aria-labelledby={`${id}-zoom-label`}>
                            {Math.round(zoom * 100)} %
                          </output>
                        </fieldset>
                        <p className="pause-zoom-help" id={`${id}-view-help`}>
                          {zoomAvailable
                            ? t(
                                "En partie : glisser horizontalement pour tourner autour du plateau, verticalement pour passer d’une vue basse à une vue de dessus. Maj + glisser pour déplacer. Molette, pincer ou + / - pour zoomer. 0 pour la vue par défaut. Le verrouillage bloque les gestes et le zoom.",
                                "In a match: drag sideways to turn around the board, up/down to move between a low and overhead view. Shift + drag to move. Wheel, pinch or + / - to zoom. 0 for the default view. Locking blocks gestures and zoom.",
                              )
                            : t(
                                "Le plateau simplifié ne permet pas de zoomer ni de déplacer la vue.",
                                "The flat board does not support zooming or moving the view.",
                              )}
                        </p>
                      </div>
                      <GraphicsToggle
                        lowGraphics={lowGraphics}
                        onChange={onGraphicsChange}
                      />
                      <label className="pause-reduced-motion">
                        <input
                          type="checkbox"
                          checked={reducedMotion}
                          onChange={(event) =>
                            director.setReducedMotion(event.target.checked)
                          }
                        />
                        {t("Réduire les animations", "Reduce motion")}
                      </label>
                    </div>
                  )}
                  {value === "audio" && (
                    <p className="pause-audio-soon">
                      {t("Bientôt disponible", "Coming soon")}
                    </p>
                  )}
                  {value === "debug" && debugActive && (
                    <div
                      className="pause-debug"
                      data-runtime={sample?.runtime ?? "unknown"}
                    >
                      <div
                        className="pause-debug-grid"
                        data-room={Boolean(roomDebug)}
                      >
                        {roomDebug && (
                          <RoomDebug value={roomDebug} ownSeat={ownSeat} />
                        )}
                        <section
                          className="pause-debug-edge"
                          aria-labelledby={`${id}-http-title`}
                        >
                          <h3 id={`${id}-http-title`}>
                            {t("Connexion HTTP", "HTTP connection")}
                          </h3>
                          <dl>
                            <div>
                              <dt>{t("Ping Cloudflare", "Cloudflare ping")}</dt>
                              <dd role="status">
                                {ping.status === "success"
                                  ? `${ping.value.latencyMs} ms`
                                  : ping.status === "loading"
                                    ? t("Mesure en cours…", "Measuring…")
                                    : unavailable}
                              </dd>
                            </div>
                            <div>
                              <dt>
                                {t(
                                  "Point d’entrée Cloudflare",
                                  "Cloudflare entry point",
                                )}
                              </dt>
                              <dd>{entryPoint}</dd>
                            </div>
                            <div>
                              <dt>{t("Région", "Region")}</dt>
                              <dd>{regionLabel}</dd>
                            </div>
                            <div>
                              <dt>{t("Service de jeu", "Game service")}</dt>
                              <dd>polytour</dd>
                            </div>
                            <div>
                              <dt>{t("Hôte", "Host")}</dt>
                              <dd>{sample?.hostname ?? unavailable}</dd>
                            </div>
                            {game && (
                              <div>
                                <dt>
                                  {t(
                                    "Connexion de la partie",
                                    "Game connection",
                                  )}
                                </dt>
                                <dd>{connectionLabel}</dd>
                              </div>
                            )}
                          </dl>
                          <p className="pause-debug-note">
                            {ping.status === "success" ? (
                              <>
                                {t("Dernière mesure : ", "Last measured: ")}
                                <time
                                  dateTime={new Date(
                                    ping.value.checkedAt,
                                  ).toISOString()}
                                >
                                  {new Date(
                                    ping.value.checkedAt,
                                  ).toLocaleTimeString(
                                    locale === "fr" ? "fr-CH" : "en-GB",
                                  )}
                                </time>
                                {t(" · Toutes les 5 s.", " · Every 5 s.")}
                              </>
                            ) : ping.status === "error" ? (
                              t(
                                "Mesure impossible. Nouvelle tentative dès que la connexion le permet.",
                                "Could not measure. Retrying when the connection allows.",
                              )
                            ) : (
                              t(
                                "Actualisation toutes les 5 s.",
                                "Updated every 5 s.",
                              )
                            )}
                          </p>
                          <p className="pause-debug-note">
                            {t(
                              "Ping HTTP vers Cloudflare, distinct de la latence de la partie.",
                              "HTTP ping to Cloudflare, separate from the game’s latency.",
                            )}
                          </p>
                        </section>
                        {bank && (
                          <section
                            className="pause-debug-bank"
                            aria-labelledby={`${id}-bank-title`}
                          >
                            <h3 id={`${id}-bank-title`}>
                              {t("Banque", "Bank")}
                            </h3>
                            <dl>
                              <div>
                                <dt>
                                  {t("Versé aux joueurs", "Paid to players")}
                                </dt>
                                <dd>{fullMoney(bank.paidOut)}</dd>
                              </div>
                              <div>
                                <dt>
                                  {t(
                                    "Reçu des joueurs",
                                    "Received from players",
                                  )}
                                </dt>
                                <dd>{fullMoney(bank.received)}</dd>
                              </div>
                              <div>
                                <dt>
                                  {t("Solde du compte", "Account balance")}
                                </dt>
                                <dd data-negative={bank.balance < 0}>
                                  {bank.balance > 0 ? "+" : ""}
                                  {fullMoney(bank.balance)}
                                </dd>
                              </div>
                            </dl>
                            <p className="pause-debug-note">
                              {t(
                                "Le compte de la banque démarre à 0. Salaires et primes le font baisser ; taxes et amendes le font monter. Les achats, constructions et ventes de propriétés n’y passent pas.",
                                "The bank account starts at 0. Salaries and bonuses lower it; taxes and fines raise it. Property purchases, building and sales don’t go through it.",
                              )}
                            </p>
                          </section>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </motion.div>
    </dialog>,
    document.body,
  );
}
