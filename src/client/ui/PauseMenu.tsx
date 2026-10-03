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
import type { Seat } from "../../shared/engine/index.js";
import { director, useDirector } from "../director/director.js";
import { useLocale } from "../i18n.js";
import type { RoomDebugState } from "../net/room-debug.js";
import type { PingState } from "../net/use-cloudflare-ping.js";
import Icon from "./Icon.js";
import RoomDebug, { translatedRegion } from "./RoomDebug.js";
import "./PauseMenu.css";

type Page = "menu" | "settings" | "confirm-leave";
type SettingsTab = "game" | "video" | "audio" | "debug";
const TABS: readonly SettingsTab[] = ["game", "video", "audio", "debug"];

export type PauseMenuProps = {
  onClose: () => void;
  onLeave: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  connection: string;
  ping: PingState;
  roomDebug: RoomDebugState;
  ownSeat: Seat;
  onDebugActiveChange: (active: boolean) => void;
};

// THESIS: A small pause sheet lets the player adjust their view and return to play.
// OWN-WORLD: Ivory paper, a blue ribbon and pressed toy buttons match the board.
// STORY: Continue first; settings stay one step away, and leaving is deliberate.
// FIRST VIEWPORT: A quiet three-action menu; tabs replace its body on request.
// FORM: Native dialog focus protects the menu while the live match keeps running.
export default function PauseMenu({
  onClose,
  onLeave,
  zoom,
  onZoom,
  connection,
  ping,
  roomDebug,
  ownSeat,
  onDebugActiveChange,
}: PauseMenuProps) {
  const { locale, setLocale, t } = useLocale();
  const { reducedMotion } = useDirector();
  const [page, setPage] = useState<Page>("menu");
  const [tab, setTab] = useState<SettingsTab>("game");
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

  const backToMenu = () => {
    returnTo.current = page === "settings" ? "settings" : "leave";
    setPage("menu");
  };
  const dismiss = () => {
    if (page === "menu") onClose();
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

  return createPortal(
    <dialog
      ref={dialogRef}
      className="pause-dialog"
      data-debug={debugActive}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-note`}
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
          {page !== "menu" && (
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
            aria-label={t("Revenir au plateau", "Back to the board")}
            onClick={onClose}
          >
            <Icon name="close" size={23} />
          </button>
        </header>
        <div className="pause-dialog-body">
          <p className="pause-note" id={`${id}-note`}>
            {t(
              "La partie continue pendant que ce menu est ouvert.",
              "The game keeps running while this menu is open.",
            )}
          </p>
          {page === "menu" && (
            <div className="pause-menu-actions">
              <button
                ref={continueRef}
                type="button"
                className="pause-action pause-primary"
                onClick={onClose}
              >
                {t("Continuer", "Continue")}
                <Icon name="arrow" size={20} />
              </button>
              <button
                ref={settingsRef}
                type="button"
                className="pause-action pause-secondary"
                onClick={() => setPage("settings")}
              >
                <Icon name="settings" size={20} />
                {t("Réglages", "Settings")}
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
          {page === "confirm-leave" && (
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
                  )}
                  {value === "video" && (
                    <div className="pause-video-settings">
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
                      <div className="pause-setting">
                        <span id={`${id}-zoom-label`}>
                          {t("Taille du plateau", "Board size")}
                        </span>
                        <fieldset
                          className="pause-zoom"
                          aria-labelledby={`${id}-zoom-label`}
                        >
                          <button
                            type="button"
                            aria-label={t("Dézoomer le plateau", "Zoom out")}
                            disabled={zoom <= 0.8}
                            onClick={() =>
                              onZoom(
                                Math.max(
                                  0.8,
                                  Math.round((zoom - 0.1) * 10) / 10,
                                ),
                              )
                            }
                          >
                            −
                          </button>
                          <button
                            type="button"
                            className="pause-zoom-reset"
                            onClick={() => onZoom(1)}
                          >
                            {t("Recentrer", "Reset view")}
                          </button>
                          <button
                            type="button"
                            aria-label={t("Zoomer le plateau", "Zoom in")}
                            disabled={zoom >= 1.3}
                            onClick={() =>
                              onZoom(
                                Math.min(
                                  1.3,
                                  Math.round((zoom + 0.1) * 10) / 10,
                                ),
                              )
                            }
                          >
                            +
                          </button>
                          <output aria-labelledby={`${id}-zoom-label`}>
                            {Math.round(zoom * 100)} %
                          </output>
                        </fieldset>
                      </div>
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
                      <div className="pause-debug-grid">
                        <RoomDebug value={roomDebug} ownSeat={ownSeat} />
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
                            <div>
                              <dt>
                                {t("Connexion de la partie", "Game connection")}
                              </dt>
                              <dd>{connectionLabel}</dd>
                            </div>
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
