import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Seat } from "../../shared/engine/index.js";
import { BOARD_ZOOM, clampBoardZoom } from "../board-view.js";
import { useLocale } from "../i18n.js";
import type { RoomDebugState } from "../net/room-debug.js";
import type { PingState } from "../net/use-cloudflare-ping.js";
import { updateSettings, useSettings } from "../settings/store.js";
import ActionButton from "./ActionButton.js";
import { fullMoney } from "./board-display.js";
import GraphicsToggle from "./GraphicsToggle.js";
import Icon from "./Icon.js";
import RoomDebug, { translatedRegion } from "./RoomDebug.js";
import RoomSettingsFields, { type RoomSettingsProps } from "./RoomSettings.js";
import StreamerToggle from "./StreamerToggle.js";

export type SettingsTab =
  | "rules"
  | "video"
  | "accessibility"
  | "audio"
  | "debug";
const PERSONAL_TABS: readonly SettingsTab[] = [
  "video",
  "accessibility",
  "audio",
];

export type SettingsPanelProps = {
  initialTab?: SettingsTab;
  /** Recentres the 3D board; the control is disabled without it. */
  onViewReset: () => void;
  /** False while the flat fallback board is on screen. */
  zoomAvailable: boolean;
  streamer: boolean;
  onStreamerChange: (enabled: boolean) => void;
  debugAvailable: boolean;
  hasGame: boolean;
  connection: string;
  ping: PingState;
  roomDebug: RoomDebugState | null;
  ownSeat: Seat | null;
  onDebugActiveChange: (active: boolean) => void;
  bank: { received: number; paidOut: number; balance: number } | null;
  /** The room rules, when this screen belongs to a room. Null on the home screen. */
  rules?: RoomSettingsProps | null;
  /** Lets the dialog shell size itself for the tab in view. */
  onTabChange?: (tab: SettingsTab) => void;
};

/** Personal preferences shared by the lobby and the match pause dialog. */
export default function SettingsPanel({
  initialTab = "video",
  onViewReset,
  zoomAvailable,
  streamer,
  onStreamerChange,
  debugAvailable,
  hasGame,
  connection,
  ping,
  roomDebug,
  ownSeat,
  onDebugActiveChange,
  bank,
  rules = null,
  onTabChange,
}: SettingsPanelProps) {
  const { locale, setLocale, t } = useLocale();
  const { boardZoom, boardViewLocked, reducedMotion } = useSettings();
  const id = useId();
  const tabs: readonly SettingsTab[] = [
    ...(rules ? (["rules"] as const) : []),
    ...PERSONAL_TABS,
    ...(debugAvailable ? (["debug"] as const) : []),
  ];
  const [selectedTab, setTab] = useState<SettingsTab>(initialTab);
  // A tab this screen does not offer falls back to the first one it has.
  const tab = tabs.includes(selectedTab) ? selectedTab : (tabs[0] ?? "video");
  useEffect(() => {
    onTabChange?.(tab);
  }, [tab, onTabChange]);
  const tabRefs = useRef<
    Partial<Record<SettingsTab, HTMLButtonElement | null>>
  >({});
  const debugActive = debugAvailable && tab === "debug";
  const [fullscreen, setFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );
  const [fullscreenError, setFullscreenError] = useState(false);
  const fullscreenSupported = Boolean(document.fullscreenEnabled);

  // Stop diagnostic traffic before timers or events can see a closed tab.
  useLayoutEffect(() => {
    onDebugActiveChange(debugActive);
    return () => onDebugActiveChange(false);
  }, [debugActive, onDebugActiveChange]);

  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  async function toggleFullscreen() {
    setFullscreenError(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError(true);
    }
  }

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.indexOf(tab);
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const tabLabels: Record<SettingsTab, string> = {
    rules: t("Règles", "Rules"),
    video: t("Vidéo", "Video"),
    accessibility: t("Accessibilité", "Accessibility"),
    audio: "Audio",
    debug: t("Débogage", "Debug"),
  };
  const motionLabels = {
    system: t("Système", "System"),
    on: t("Activé", "On"),
    off: t("Désactivé", "Off"),
  };
  const zoomDisabled = !zoomAvailable || boardViewLocked;
  const zoomDisabledReason = !zoomAvailable
    ? t(
        "Le zoom est disponible sur le plateau 3D.",
        "Zoom is available on the 3D board.",
      )
    : t(
        "Déverrouillez la vue du plateau pour ajuster le zoom.",
        "Unlock the board view to adjust zoom.",
      );
  const sample = ping.status === "success" ? ping.value : null;
  const unavailable = t("Indisponible", "Unavailable");
  const entryPoint =
    sample?.runtime === "local"
      ? t("Local", "Local")
      : sample?.colo
        ? [sample.colo, sample.location].filter(Boolean).join(" · ")
        : unavailable;
  const regionLabel = translatedRegion(sample?.region ?? null, t);
  const connectionLabel =
    connection === "online"
      ? t("Connectée", "Connected")
      : connection === "offline"
        ? t("Hors ligne", "Offline")
        : connection === "connecting"
          ? t("Connexion en cours…", "Connecting…")
          : t("Reconnexion en cours…", "Reconnecting…");

  return (
    <div className="personal-settings">
      <div className="pause-setting settings-language">
        <label htmlFor={`${id}-language`}>{t("Langue", "Language")}</label>
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
      <div
        className="pause-tabs"
        role="tablist"
        aria-label={t("Catégories de réglages", "Settings categories")}
      >
        {tabs.map((value) => (
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
      {tabs.map((value) => (
        <div
          key={value}
          id={`${id}-panel-${value}`}
          className="pause-tab-panel"
          role="tabpanel"
          aria-labelledby={`${id}-tab-${value}`}
          hidden={tab !== value}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA panels without controls need a keyboard focus target.
          tabIndex={0}
        >
          {value === "rules" && rules && (
            <div className="pause-rules">
              <p className="field-note">
                {rules.disabled
                  ? t(
                      "Les réglages sont fixés pour toute la durée de cette partie.",
                      "Settings are fixed for the duration of this game.",
                    )
                  : rules.save
                    ? t(
                        "Vos changements sont enregistrés à la fermeture.",
                        "Your changes are saved when you close this window.",
                      )
                    : t(
                        "Choisissez les règles de votre prochaine partie.",
                        "Choose the rules for your next game.",
                      )}
              </p>
              <RoomSettingsFields {...rules} />
            </div>
          )}
          {value === "video" && (
            <div className="pause-video-settings">
              <GraphicsToggle />
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
                    checked={boardViewLocked}
                    onChange={(event) =>
                      updateSettings({ boardViewLocked: event.target.checked })
                    }
                  />
                  {t("Verrouiller la vue du plateau", "Lock board view")}
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
                    disabled={zoomDisabled || boardZoom <= BOARD_ZOOM.min}
                    disabledReason={
                      zoomDisabled
                        ? zoomDisabledReason
                        : t(
                            "Le plateau est déjà dézoomé au maximum.",
                            "The board is already zoomed out as far as possible.",
                          )
                    }
                    onClick={() =>
                      updateSettings({
                        boardZoom: clampBoardZoom(boardZoom - BOARD_ZOOM.step),
                      })
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
                    value={boardZoom}
                    disabled={zoomDisabled}
                    aria-labelledby={`${id}-zoom-label`}
                    aria-describedby={`${id}-view-help`}
                    aria-valuetext={`${Math.round(boardZoom * 100)} %`}
                    onChange={(event) =>
                      updateSettings({
                        boardZoom: clampBoardZoom(Number(event.target.value)),
                      })
                    }
                  />
                  <ActionButton
                    type="button"
                    aria-label={t("Zoomer le plateau", "Zoom in")}
                    disabled={zoomDisabled || boardZoom >= BOARD_ZOOM.max}
                    disabledReason={
                      zoomDisabled
                        ? zoomDisabledReason
                        : t(
                            "Le plateau est déjà zoomé au maximum.",
                            "The board is already zoomed in as far as possible.",
                          )
                    }
                    onClick={() =>
                      updateSettings({
                        boardZoom: clampBoardZoom(boardZoom + BOARD_ZOOM.step),
                      })
                    }
                  >
                    +
                  </ActionButton>
                  <output aria-labelledby={`${id}-zoom-label`}>
                    {Math.round(boardZoom * 100)} %
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
              <ActionButton
                type="button"
                className="pause-action pause-secondary settings-fullscreen"
                aria-pressed={fullscreen}
                disabled={!fullscreenSupported}
                disabledReason={t(
                  "Le plein écran est indisponible dans ce navigateur.",
                  "Fullscreen is unavailable in this browser.",
                )}
                onClick={() => void toggleFullscreen()}
              >
                <Icon name="fullscreen" size={18} />
                {fullscreen
                  ? t("Quitter le plein écran", "Exit fullscreen")
                  : t("Plein écran", "Fullscreen")}
              </ActionButton>
              {fullscreenError && (
                <p className="pause-error" role="status">
                  {t(
                    "Le navigateur n’a pas pu changer le mode plein écran. Réessayez.",
                    "The browser could not change fullscreen mode. Try again.",
                  )}
                </p>
              )}
            </div>
          )}
          {value === "accessibility" && (
            <div className="pause-accessibility-settings">
              <div className="settings-streamer">
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
              <fieldset className="settings-motion">
                <legend>{t("Réduire les animations", "Reduce motion")}</legend>
                <div className="settings-motion-options">
                  {(["system", "on", "off"] as const).map((mode) => (
                    <label key={mode} data-selected={reducedMotion === mode}>
                      <input
                        type="radio"
                        name={`${id}-motion`}
                        value={mode}
                        checked={reducedMotion === mode}
                        onChange={() => updateSettings({ reducedMotion: mode })}
                      />
                      <span>{motionLabels[mode]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="settings-description">
                {t(
                  "Système suit la préférence d’animation de votre appareil.",
                  "System follows your device’s motion preference.",
                )}
              </p>
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
              <div className="pause-debug-grid" data-room={Boolean(roomDebug)}>
                {roomDebug && <RoomDebug value={roomDebug} ownSeat={ownSeat} />}
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
                    {hasGame && (
                      <div>
                        <dt>
                          {t("Connexion de la partie", "Game connection")}
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
                          {new Date(ping.value.checkedAt).toLocaleTimeString(
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
                      t("Actualisation toutes les 5 s.", "Updated every 5 s.")
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
                    <h3 id={`${id}-bank-title`}>{t("Banque", "Bank")}</h3>
                    <dl>
                      <div>
                        <dt>{t("Versé aux joueurs", "Paid to players")}</dt>
                        <dd>{fullMoney(bank.paidOut)}</dd>
                      </div>
                      <div>
                        <dt>
                          {t("Reçu des joueurs", "Received from players")}
                        </dt>
                        <dd>{fullMoney(bank.received)}</dd>
                      </div>
                      <div>
                        <dt>{t("Solde du compte", "Account balance")}</dt>
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
    </div>
  );
}
