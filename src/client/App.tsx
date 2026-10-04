import { AnimatePresence, animate, motion } from "motion/react";
import type { CSSProperties, ErrorInfo, ReactNode } from "react";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ECONOMY, getBoard } from "../shared/board/index.js";
import type {
  GameConfig,
  GameEvent,
  PlayerState,
  PublicState,
  WinKind,
} from "../shared/engine/index.js";
import {
  decisionWindow,
  getProperty,
  legalActions,
  netWorth,
  propertyRefund,
  propertyRent,
  resortFestivals,
} from "../shared/engine/index.js";
import type {
  RandomnessStatus,
  RoomConfig,
  RoomCredentials,
} from "../shared/protocol/index.js";
import { RoomCodeSchema, RoomConfigSchema } from "../shared/protocol/index.js";
import { director, useDirector } from "./director/director.js";
import { translate as t, useLocale } from "./i18n.js";
import {
  enterRoom,
  forgetCredentials,
  readCredentials,
  useRoom,
} from "./net/room.js";
import { useCloudflarePing } from "./net/use-cloudflare-ping.js";
import ActionButton from "./ui/ActionButton.js";
import {
  fullMoney,
  levelName,
  money,
  PLAYER_COLORS,
  TILE_ICONS,
  tileColor,
  tileName,
  tilePrice,
} from "./ui/board-display.js";
import {
  boardPickActions,
  boardPickKey,
  isBoardPick,
} from "./ui/board-pick.js";
import CardMoment from "./ui/CardMoment.js";
import Changelog from "./ui/Changelog.js";
import CityCard from "./ui/CityCard.js";
import { cardName } from "./ui/chance-display.js";
import DecisionPanel from "./ui/DecisionPanel.js";
import DiceExplanation from "./ui/DiceExplanation.js";
import GraphicsToggle from "./ui/GraphicsToggle.js";
import Icon from "./ui/Icon.js";
import InvitationEntry from "./ui/InvitationEntry.js";
import LanguagePicker from "./ui/LanguagePicker.js";
import LuckCardHelp from "./ui/LuckCardHelp.js";
import PauseMenu from "./ui/PauseMenu.js";
import {
  deviceSeats,
  LobbySeats,
  PlayerAvatar,
  ReturnToLobby,
  RoomLeaderPicker,
  RoomLock,
  WaitingNotice,
  WaitingRoom,
} from "./ui/RoomPeople.js";
import RoomSettingsFields, { QuickSettings } from "./ui/RoomSettings.js";
import RoomSettings from "./ui/SettingsDialog.js";
import "./App.css";

const BoardScene = lazy(() => import("./scene/BoardScene.js"));
const DEFAULT_CONFIG = RoomConfigSchema.parse({});
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Keep the accessible board available without WebGL. */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      polytour<span className="brand-dot">.</span>
    </span>
  );
}
function MoneyCounter({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  const { reducedMotion } = useDirector();
  useEffect(() => {
    if (reducedMotion) {
      setDisplay(value);
      previous.current = value;
      return;
    }
    const controls = animate(previous.current, value, {
      duration: 0.45,
      ease: "easeOut",
      onUpdate: (amount) => setDisplay(Math.round(amount)),
    });
    previous.current = value;
    return () => controls.stop();
  }, [value, reducedMotion]);
  return <>{fullMoney(display)}</>;
}

function victoryReason(kind: WinKind) {
  const reasons: Record<WinKind, string> = {
    "last-standing": t(
      "Tous les autres joueurs ont fait faillite.",
      "All other players went bankrupt.",
    ),
    "triple-monopoly": t(
      "Trois collections complètes.",
      "Three complete city groups.",
    ),
    "line-monopoly": t(
      "Une ligne entière du plateau à votre nom.",
      "You own every property on one side of the board.",
    ),
    "resort-monopoly": t(
      "Toutes les destinations de vacances réunies.",
      "You own all four beaches.",
    ),
    "round-limit": t(
      "La plus grande fortune à la fin des manches.",
      "Highest net worth at the round limit.",
    ),
    "time-limit": t(
      "La plus grande fortune à la fin du temps imparti.",
      "Highest net worth when time runs out.",
    ),
  };
  return reasons[kind];
}

function MatchResults({
  players,
  result,
  leader,
  leaderName,
  disabled,
  onLobby,
  onLeave,
  onJournal,
  leaving,
}: {
  players: readonly PlayerState[];
  result: NonNullable<PublicState["result"]>;
  /** Only the room leader brings everyone back for another game. */
  leader: boolean;
  leaderName: string | undefined;
  disabled: boolean;
  onLobby: () => void;
  onLeave: () => void;
  onJournal: (button: HTMLButtonElement) => void;
  leaving: boolean;
}) {
  const winner = players.find((player) => player.seat === result.winner);
  const winnerWealth =
    result.standings.find((standing) => standing.seat === result.winner)
      ?.netWorth ?? 0;
  return (
    <>
      <div
        className="winner-portrait"
        style={
          { "--player-color": PLAYER_COLORS[result.winner] } as CSSProperties
        }
      >
        <PlayerAvatar seat={result.winner} />
        <span className="winner-trophy" aria-hidden="true">
          <Icon name="trophy" size={31} />
        </span>
      </div>
      <p className="victory-call">{t("Victoire !", "Victory!")}</p>
      <h2 id="winner-heading">
        {winner?.name}
        <span>{t("remporte la partie", "wins the game")}</span>
      </h2>
      <p className="victory-reason">{victoryReason(result.kind)}</p>
      <div className="winner-wealth">
        <span>{t("Fortune finale", "Final net worth")}</span>
        <strong>{money(winnerWealth)}</strong>
      </div>
      <div className="standings-label">
        <span>{t("Classement final", "Final standings")}</span>
        <span>{t("Argent + propriétés", "Cash + properties")}</span>
      </div>
      <ol className="standings">
        {result.standings.map((standing, index) => (
          <li
            key={standing.seat}
            data-winner={standing.seat === result.winner}
            style={
              {
                "--player-color": PLAYER_COLORS[standing.seat],
              } as CSSProperties
            }
          >
            <span className="standing-rank">{index + 1}</span>
            <span className="standing-color" aria-hidden="true" />
            <b>
              {players.find((player) => player.seat === standing.seat)?.name}
            </b>
            <strong>{money(standing.netWorth)}</strong>
          </li>
        ))}
      </ol>
      {leader ? (
        <ReturnToLobby
          finished
          disabled={disabled || leaving}
          onConfirm={onLobby}
        />
      ) : (
        <p className="results-leader-note">
          {t(
            `${leaderName ?? "Le chef de salle"} peut ramener tout le monde au salon pour une autre partie.`,
            `${leaderName ?? "The room leader"} can bring everyone back to the lobby for another game.`,
          )}
        </p>
      )}
      <ActionButton
        type="button"
        className="button secondary"
        onClick={onLeave}
        disabled={leaving}
        disabledReason={t(
          "Vous quittez la salle. Veuillez patienter.",
          "You are leaving the room. Please wait.",
        )}
      >
        {t("Quitter la salle", "Leave the room")}
      </ActionButton>
      <button
        type="button"
        className="text-button"
        onClick={(event) => onJournal(event.currentTarget)}
      >
        {t("Voir le journal de la partie", "View game log")}
        <Icon name="journal" size={16} />
      </button>
    </>
  );
}

function BoardFallback({
  state,
  onSelect,
  saleTargets,
  saleSelected,
  saleBlocked = false,
  targets,
  picked,
  config,
}: {
  state: PublicState | null;
  onSelect: (tile: number) => void;
  saleTargets?: readonly number[];
  saleSelected?: number | null;
  saleBlocked?: boolean;
  targets?: readonly number[] | null;
  picked?: number | null;
  config?: GameConfig;
}) {
  const choices = targets ?? saleTargets;
  const chosen = targets != null ? picked : saleSelected;
  const boardConfig = state?.config ?? config;
  return (
    <section
      className="flat-board"
      data-sale-active={saleTargets !== undefined}
      data-pick-active={targets != null}
      aria-label={t("Plateau accessible", "Accessible board")}
    >
      <p className="flat-board-note">
        {t("Vue légère du plateau", "Simple board view")}
      </p>
      {getBoard(boardConfig).map((tile) => {
        const owner = state ? getProperty(state, tile.index)?.owner : null;
        return (
          <ActionButton
            type="button"
            key={tile.index}
            style={
              {
                "--tile-color": tileColor(tile.index, boardConfig),
              } as CSSProperties
            }
            data-sale={saleTargets?.includes(tile.index) || undefined}
            data-pick={targets?.includes(tile.index) || undefined}
            aria-pressed={
              choices?.includes(tile.index) ? chosen === tile.index : undefined
            }
            aria-label={
              state && saleTargets?.includes(tile.index)
                ? t(
                    `Choisir ${tileName(tile.index, boardConfig)} à vendre · ${money(propertyRefund(state, tile.index))}`,
                    `Select ${tileName(tile.index, boardConfig)} to sell · ${money(propertyRefund(state, tile.index))}`,
                  )
                : undefined
            }
            disabledReason={
              saleBlocked
                ? t(
                    "Attendez la fin de l’action en cours.",
                    "Wait for the current action to finish.",
                  )
                : t(
                    "Choisissez une propriété en surbrillance disponible pour cette action.",
                    "Choose a highlighted property available for this action.",
                  )
            }
            disabled={
              choices !== undefined &&
              (saleBlocked || !choices.includes(tile.index))
            }
            onClick={() => onSelect(tile.index)}
          >
            <span>{tileName(tile.index, boardConfig)}</span>
            <b
              style={
                owner != null ? { color: PLAYER_COLORS[owner] } : undefined
              }
            >
              {state && saleTargets?.includes(tile.index)
                ? `+${money(propertyRefund(state, tile.index))}`
                : state && owner != null
                  ? money(propertyRent(state, tile.index))
                  : tilePrice(
                        tile.index,
                        state ?? (config ? { config } : null),
                      ) != null
                    ? money(
                        tilePrice(
                          tile.index,
                          state ?? (config ? { config } : null),
                        ) ?? 0,
                      )
                    : TILE_ICONS[tile.kind]}
            </b>
          </ActionButton>
        );
      })}
    </section>
  );
}

function eventText(event: GameEvent, state: PublicState): ReactNode | null {
  const name = (seat: PlayerState["seat"]) => (
    <strong
      className="journal-player"
      data-seat={seat}
      style={{ color: PLAYER_COLORS[seat] }}
    >
      {state.players.find((player) => player.seat === seat)?.name ??
        t("Un joueur", "A player")}
    </strong>
  );
  const entry = (
    icon: Parameters<typeof Icon>[0]["name"],
    content: ReactNode,
  ) => (
    <>
      <Icon name={icon} size={16} />
      <span className="journal-event-text">{content}</span>
    </>
  );
  switch (event.type) {
    case "DiceRolled":
      return entry(
        "dice",
        <>
          {name(event.seat)}{" "}
          {t(
            `lance ${event.dice[0]} + ${event.dice[1]} = ${event.dice[0] + event.dice[1]}${event.isDouble ? " · Double !" : ""}`,
            `rolls ${event.dice[0]} + ${event.dice[1]} = ${event.dice[0] + event.dice[1]}${event.isDouble ? " · Doubles!" : ""}`,
          )}
        </>,
      );
    case "PropertyBought":
      return entry(
        "buy",
        <>
          {name(event.seat)}{" "}
          {t(
            `achète ${tileName(event.tile, state.config)} · ${money(event.amount)}`,
            `buys ${tileName(event.tile, state.config)} · ${money(event.amount)}`,
          )}
        </>,
      );
    case "PropertyUpgraded":
      return entry(
        "build",
        <>
          {name(event.seat)}{" "}
          {t(
            `construit à ${tileName(event.tile, state.config)} · ${levelName(event.level)}`,
            `builds in ${tileName(event.tile, state.config)} · ${levelName(event.level)}`,
          )}
        </>,
      );
    case "BoughtOut":
      return entry(
        "buy",
        <>
          {name(event.seat)}{" "}
          {t(
            `rachète ${tileName(event.tile, state.config)} à`,
            `buys out ${tileName(event.tile, state.config)} from`,
          )}{" "}
          {name(event.previousOwner)} · {money(event.amount)}
        </>,
      );
    case "PropertySold":
      return entry(
        "sell",
        <>
          {name(event.seat)}{" "}
          {t(
            `vend ${tileName(event.tile, state.config)} · ${money(event.amount)}`,
            `sells ${tileName(event.tile, state.config)} · ${money(event.amount)}`,
          )}
        </>,
      );
    case "RentPaid":
      return entry(
        "people",
        <>
          {name(event.seat)}{" "}
          {t(`paie ${money(event.amount)} à`, `pays ${money(event.amount)} to`)}{" "}
          {name(event.owner)}
        </>,
      );
    case "SalaryPaid":
      return entry(
        "bank",
        <>
          {name(event.seat)}{" "}
          {t(
            `reçoit ${money(event.amount)} au départ`,
            `receives ${money(event.amount)} at Start`,
          )}
        </>,
      );
    case "CardDrawn":
      return entry(
        "journal",
        <>
          {name(event.seat)}{" "}
          {t(
            `tire « ${cardName(event.card)} »`,
            `draws “${cardName(event.card)}”`,
          )}
        </>,
      );
    case "CardUsed":
      return entry(
        "journal",
        <>
          {name(event.seat)}{" "}
          {t(
            `joue « ${cardName(event.card)} »`,
            `plays “${cardName(event.card)}”`,
          )}
        </>,
      );
    case "PlayerBankrupt":
      return entry(
        "bank",
        <>
          {name(event.seat)} {t("fait faillite", "goes bankrupt")}
        </>,
      );
    case "SentToIsland":
      return entry(
        "pin",
        <>
          {name(event.seat)} {t("séjourne sur l’île", "arrives on the island")}
        </>,
      );
    case "LeftIsland":
      return entry(
        "exit",
        <>
          {name(event.seat)} {t("quitte l’île", "leaves the island")}
        </>,
      );
    case "ChampionshipChanged":
      return event.host
        ? entry(
            "crown",
            t(
              `Championnat à ${tileName(event.host.tile, state.config)} · loyers ×${event.host.multiplier}`,
              `Championship in ${tileName(event.host.tile, state.config)} · rent ×${event.host.multiplier}`,
            ),
          )
        : null;
    case "MoneyTransferred":
      return entry(
        event.from === null || event.to === null ? "bank" : "people",
        <>
          {event.from === null ? t("La banque", "The bank") : name(event.from)}{" "}
          {t(
            `verse ${money(event.amount)} à`,
            `pays ${money(event.amount)} to`,
          )}{" "}
          {event.to === null ? t("la banque", "the bank") : name(event.to)}
        </>,
      );
    case "GameOver":
      return entry(
        "trophy",
        <>
          {name(event.winner)} {t("remporte la partie", "wins the game")}
        </>,
      );
    default:
      return null;
  }
}

function RandomnessPanel({
  value,
  mode,
  onHelp,
  expanded = false,
}: {
  value: RandomnessStatus | null;
  mode: RoomConfig["randomnessMode"];
  onHelp: () => void;
  expanded?: boolean;
}) {
  const proof = value?.proof;
  const commitment = value?.commitment ?? proof;
  function downloadProof() {
    if (!proof) return;
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = href;
    link.download = `polytour-dice-${proof.round ?? "crypto"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  if (mode === "secure") {
    return (
      <details className="proof-panel" open={expanded}>
        <summary>
          <span className="proof-indicator" />
          {t("Dés cryptographiques serveur", "Server-generated dice")}
          <span>↗</span>
        </summary>
        <div className="proof-body">
          {proof ? (
            <p className="proof-result">
              {t(
                `Dernier lancer : ${proof.dice[0]} + ${proof.dice[1]}`,
                `Last roll: ${proof.dice[0]} + ${proof.dice[1]}`,
              )}
            </p>
          ) : (
            <p>{t("Aucun lancer pour le moment.", "No rolls yet.")}</p>
          )}
          <button type="button" className="text-button" onClick={onHelp}>
            {t("Comment fonctionnent les dés ?", "How are the dice rolled?")}
          </button>
        </div>
      </details>
    );
  }
  return (
    <details className="proof-panel" open={expanded}>
      <summary>
        <span
          className={`proof-indicator ${proof?.verified ? "verified" : ""}`}
        />
        {proof?.verified
          ? t("Dernier lancer vérifié", "Last roll verified")
          : t("Dés vérifiables · drand", "Verifiable dice · drand")}
        <span>↗</span>
      </summary>
      <div className="proof-body">
        <p>
          {t(
            "Un signal public futur est choisi avant de connaître son résultat. Le serveur vérifie sa signature, puis transforme les octets en deux dés sans biais de modulo.",
            "A future public beacon round is chosen before its result is known. The server verifies the signature and derives two dice without modulo bias.",
          )}
        </p>
        {commitment && (
          <dl>
            <div>
              <dt>{t("Tour fixé", "Committed round")}</dt>
              <dd>
                {commitment.round ?? t("Crypto serveur", "Server randomness")}
              </dd>
            </div>
            <div>
              <dt>{t("Contexte", "Context")}</dt>
              <dd className="proof-value">{commitment.context}</dd>
            </div>
          </dl>
        )}
        {proof && (
          <>
            <p className="proof-result">
              {t(
                `Dés : ${proof.dice[0]} + ${proof.dice[1]}`,
                `Dice: ${proof.dice[0]} + ${proof.dice[1]}`,
              )}{" "}
              ·{" "}
              {proof.verified
                ? t(
                    "Signature vérifiée par le serveur",
                    "Signature verified by the server",
                  )
                : t(
                    "Source cryptographique serveur",
                    "Server cryptographic source",
                  )}
            </p>
            {proof.randomness && (
              <label>
                {t("Aléa public", "Public randomness")}
                <input
                  readOnly
                  value={proof.randomness}
                  aria-label={t("Aléa public drand", "Public drand randomness")}
                />
              </label>
            )}
            {proof.signature && (
              <label>
                Signature
                <input
                  readOnly
                  value={proof.signature}
                  aria-label={t(
                    "Signature du signal drand",
                    "drand beacon signature",
                  )}
                />
              </label>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void navigator.clipboard.writeText(
                  JSON.stringify(proof, null, 2),
                )
              }
            >
              {t("Copier la preuve", "Copy proof")}
              <Icon name="copy" size={15} />
            </button>
            <button
              type="button"
              className="text-button proof-download"
              onClick={downloadProof}
            >
              {t("Télécharger la preuve ↓", "Download proof ↓")}
            </button>
          </>
        )}
        {!commitment && (
          <p className="field-note">
            {t(
              "La preuve apparaîtra après le premier lancer.",
              "The proof appears after the first roll.",
            )}
          </p>
        )}
        <a
          href="https://docs.drand.love/developer/clients/"
          target="_blank"
          rel="noreferrer"
        >
          {t("Comprendre drand ↗", "About drand ↗")}
        </a>
      </div>
    </details>
  );
}
function Help({
  open,
  onClose,
  mode,
  config,
}: {
  open: boolean;
  onClose: () => void;
  mode: RoomConfig["randomnessMode"];
  config: GameConfig;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="help-dialog"
      aria-labelledby="help-heading"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="help-top">
        <h2 id="help-heading">{t("Comment jouer", "How to play")}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Fermer les règles", "Close rules")}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <p>
        {t(
          "Une partie de 2 à 4 joueurs, avec des amis ou des bots.",
          "Two to four players, with friends or bots.",
        )}
      </p>
      <button
        type="button"
        className="text-button help-card-shortcut"
        onClick={() =>
          dialog.current?.querySelector<HTMLElement>(".help-cards h3")?.focus()
        }
      >
        {t("Voir les 16 cartes Surprise", "View all 16 luck cards")}
        <Icon name="arrow" size={15} />
      </button>
      <ol className="rules-list">
        <li>
          <b>{t("Lancez et voyagez", "Roll and move")}</b>
          <span>
            {t(
              "Deux dés vous déplacent. Un double vous offre un nouveau lancer si cette option est activée ; trois doubles vous envoient sur l’île.",
              "Move using two dice. Doubles grant another roll when that rule is enabled; three doubles send you to the island.",
            )}
          </span>
        </li>
        <li>
          <b>{t("Achetez et construisez", "Buy and build")}</b>
          <span>
            {t(
              "Choisissez un terrain ou un bâtiment. Vos visiteurs paient le loyer ; les collections de villes, les festivals et le championnat l’augmentent.",
              "Choose land or a building. Other players pay rent when they land there; complete city groups, festivals and the championship increase the rent.",
            )}
          </span>
        </li>
        <li>
          <b>{t("Gardez une réserve", "Keep cash in reserve")}</b>
          <span>
            {t(
              "Un rachat peut renverser la partie. Vendez des propriétés si vous devez payer plus que votre trésorerie.",
              "A buyout can change ownership. Sell properties if a payment exceeds your cash.",
            )}
          </span>
        </li>
        <li>
          <b>{t("Visez la victoire", "Winning the game")}</b>
          <span>
            {t(
              "Dernier joueur debout, trois collections complètes, une ligne complète ou les quatre plages : plusieurs routes mènent à la victoire selon les réglages. À la fin du temps, la fortune totale départage les joueurs.",
              "Win by being the last player standing, completing three city groups, owning a whole side or all four beaches, depending on the room settings. When time runs out, highest net worth wins.",
            )}
          </span>
        </li>
      </ol>
      {open && <LuckCardHelp config={config} />}
      <section className="help-dice" aria-labelledby="help-dice-heading">
        <h3 id="help-dice-heading">
          {t("Le tirage des dés", "How dice are rolled")}
        </h3>
        {mode === "secure" ? (
          <DiceExplanation />
        ) : (
          <p>
            {t(
              "Cette ancienne salle conserve ses dés drand : chaque lancer attend un signal public et sa signature vérifiée.",
              "This older room keeps its drand dice: each roll waits for a public beacon and a verified signature.",
            )}
          </p>
        )}
      </section>
      <button type="button" className="button primary" onClick={onClose}>
        {t("C’est parti", "Got it")}
        <Icon name="arrow" />
      </button>
    </dialog>
  );
}

function MatchClock({
  deadline,
  finished,
  pausedAt,
}: {
  deadline: number | null;
  finished: boolean;
  pausedAt: number | null;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (finished || deadline === null || pausedAt !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline, finished, pausedAt]);
  if (deadline === null) return null;
  const seconds = finished
    ? 0
    : Math.max(0, Math.ceil((deadline - (pausedAt ?? now)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const text = `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <time
      className="match-clock"
      dateTime={`PT${seconds}S`}
      title={t("Temps de partie restant", "Time remaining")}
    >
      {text}
    </time>
  );
}

// The deciding player's remaining time, as a bar under their name. The engine's
// deadline also holds the animations that open the decision, so the bar waits
// at full until the player's own window starts, then drains in real time.
// CSS runs the drain: no per-second re-render, and it stays smooth.
function TurnTimer({
  pending,
  config,
  pausedAt,
}: {
  pending: PublicState["pending"];
  config: GameConfig;
  pausedAt: number | null;
}) {
  const startedAt = useRef(pausedAt ?? Date.now());
  if (!pending) return <div className="player-timer" aria-hidden="true" />;
  const windowMs = decisionWindow(config, pending.kind);
  const delay = pending.deadline - windowMs - startedAt.current;
  return (
    <div className="player-timer" aria-hidden="true">
      <span
        className="player-timer-fill"
        style={
          {
            "--timer-window": `${windowMs}ms`,
            "--timer-delay": `${delay}ms`,
            animationPlayState: pausedAt !== null ? "paused" : "running",
          } as CSSProperties
        }
      />
    </div>
  );
}

type GameTool = "journal" | "proof" | "rules" | "room" | null;

// THESIS: The PC board fills the screen; the interface occupies its unused corners.
// OWN-WORLD: sky blue, ivory toy controls, four colored pawn identities, physical buttons.
// STORY: watch the board, make the current choice, open a tool only when needed.
// FIRST VIEWPORT: four corner players, discreet top controls, one context action at the bottom.
// FORM: the user's pinned isometric board-game reference; the scene remains the main surface.
function MatchView({
  game,
  credentials,
  room,
  config,
  selected,
  onSelect,
  zoom,
  onZoom,
  lowGraphics,
  onGraphicsChange,
  copied,
  copyRoom,
  onLeave,
  onHelp,
  debug,
}: {
  game: PublicState;
  credentials: RoomCredentials;
  room: ReturnType<typeof useRoom>;
  config: RoomConfig;
  selected: number | null;
  onSelect: (tile: number) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  lowGraphics: boolean;
  onGraphicsChange: (low: boolean) => void;
  copied: boolean;
  copyRoom: () => Promise<void>;
  onLeave: () => void;
  onHelp: () => void;
  debug: boolean;
}) {
  const { serverState, busy, history, reducedMotion } = useDirector();
  const [pauseOpen, setPauseOpen] = useState(game.pause?.kind === "paused");
  const soloMenuPause = useRef(game.pause?.kind === "paused");
  const soloObservedPause = useRef(game.pause?.kind === "paused");
  const cloudflarePing = useCloudflarePing(
    room.connection === "online",
    room.connection,
  );
  const networkPoint =
    cloudflarePing.status === "success"
      ? (cloudflarePing.value.colo ??
        (cloudflarePing.value.runtime === "local" ? t("Local", "Local") : "-"))
      : "-";
  const networkLatency =
    cloudflarePing.status === "success"
      ? `${cloudflarePing.value.latencyMs} ms`
      : "- ms";
  const pauseTrigger = useRef<HTMLButtonElement | null>(null);
  const [tool, setTool] = useState<GameTool>(null);
  const [rollAnchor, setRollAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [saleSelection, setSaleSelection] = useState<{
    gameId: string;
    pending: PublicState["pending"];
    tile: number;
  } | null>(null);
  const overlayTrigger = useRef<HTMLButtonElement | null>(null);
  const toolRef = useRef<HTMLElement | null>(null);
  const decidingSeat = game.pending?.seat ?? game.activeSeat;
  const authoritative = serverState ?? game;
  // This screen plays its own seat and any local players sharing it. Whoever
  // of them decides now is the seat it acts for; someone waiting acts for none.
  const own = room.you?.seat ?? null;
  const mySeats = deviceSeats(room.lobby, own);
  const humans = authoritative.players.filter(
    (player) => player.control === "human" && !player.bankrupt,
  );
  const pauseSeats = humans.filter((player) => mySeats.includes(player.seat));
  const pauseSeat = pauseSeats[0]?.seat ?? null;
  const solo = humans.length === 1;
  const pausedAt =
    authoritative.pause?.kind === "paused"
      ? authoritative.pause.startedAt
      : null;
  const pauseBlocked =
    room.pending ||
    room.leaving ||
    room.connection !== "online" ||
    (room.randomness !== null && room.randomness.status !== "resolved");
  const pauseAnnouncement = authoritative.pause
    ? `${authoritative.pause.kind}:${authoritative.pause.kind === "vote" ? authoritative.pause.deadline : authoritative.pause.startedAt}`
    : null;
  useEffect(() => {
    if (pauseAnnouncement && !solo) {
      setTool(null);
      setInspectorOpen(false);
      setPauseOpen(true);
    }
  }, [pauseAnnouncement, solo]);
  // Only this tab's menu lifecycle can automatically resume its solo pause.
  // Another tab may keep its menu closed without undoing the shared pause.
  useEffect(() => {
    if (
      !solo ||
      pauseSeat === null ||
      pauseBlocked ||
      authoritative.status !== "active"
    )
      return;
    if (authoritative.pause?.kind === "paused") {
      if (!soloMenuPause.current) return;
      soloObservedPause.current = true;
      if (!pauseOpen) {
        soloMenuPause.current = false;
        room.act({ type: "ResumeGame" }, pauseSeat);
      }
    } else if (soloObservedPause.current && !authoritative.pause) {
      soloObservedPause.current = false;
      soloMenuPause.current = false;
      setPauseOpen(false);
    } else if (
      pauseOpen &&
      !authoritative.pause &&
      authoritative.pending &&
      authoritative.pending.deadline > Date.now()
    ) {
      soloMenuPause.current = true;
      room.act({ type: "RequestPause" }, pauseSeat);
    }
  }, [solo, pauseSeat, pauseBlocked, pauseOpen, authoritative, room.act]);
  const openPauseMenu = () => {
    soloMenuPause.current = solo;
    setTool(null);
    setInspectorOpen(false);
    setPauseOpen(true);
  };
  const authoritativeSeat =
    authoritative.pending?.seat ?? authoritative.activeSeat;
  const controlSeat = mySeats.includes(authoritativeSeat)
    ? authoritativeSeat
    : own;
  const sharedScreen = mySeats.length > 1;
  const leader = own !== null && own === room.lobby?.hostSeat;
  const leaderName = room.lobby?.seats.find(
    (entry) => entry.seat === room.lobby?.hostSeat,
  )?.name;
  const askingToJoin = leader
    ? (room.lobby?.waiting.filter((member) => !member.approved).length ?? 0)
    : 0;
  const ownPlayer = game.players.find((player) => player.seat === controlSeat);
  const salePending =
    controlSeat !== null &&
    authoritative.status === "active" &&
    authoritative.pending?.kind === "sell" &&
    authoritative.pending.seat === controlSeat &&
    !authoritative.players.find((player) => player.seat === controlSeat)
      ?.bankrupt
      ? authoritative.pending
      : null;
  const saleTargets = salePending
    ? legalActions(authoritative, salePending.seat).flatMap((action) =>
        action.type === "Sell" ? [action.tile] : [],
      )
    : [];
  const saleBlocked =
    pausedAt !== null ||
    busy ||
    room.pending ||
    room.leaving ||
    room.connection !== "online" ||
    (room.randomness !== null && room.randomness.status !== "resolved");
  // A new decision or recovered snapshot requires a fresh, deliberate choice.
  const saleSelected =
    salePending &&
    !busy &&
    room.connection === "online" &&
    saleSelection?.gameId === authoritative.gameId &&
    saleSelection.pending === salePending &&
    saleTargets.includes(saleSelection.tile)
      ? saleSelection.tile
      : null;
  const decisionSelected = salePending ? saleSelected : selected;
  // Travel, festival and card choices are answered by clicking the board.
  const decisionState = serverState ?? game;
  const picking =
    pausedAt === null &&
    !busy &&
    controlSeat !== null &&
    (room.randomness === null || room.randomness.status === "resolved") &&
    decisionState.status === "active" &&
    decisionState.pending?.seat === controlSeat &&
    !ownPlayer?.bankrupt &&
    isBoardPick(decisionState);
  const pickTargets = useMemo(
    () =>
      picking && controlSeat !== null
        ? boardPickActions(decisionState, controlSeat).map(
            (action) => action.tile,
          )
        : null,
    [picking, decisionState, controlSeat],
  );
  const pickKey = boardPickKey(decisionState);
  const [pick, setPick] = useState<{
    key: string;
    tile: number;
    pending: PublicState["pending"];
  } | null>(null);
  const picked =
    pickTargets &&
    room.connection === "online" &&
    pick?.key === pickKey &&
    pick.pending === decisionState.pending &&
    pickTargets.includes(pick.tile)
      ? pick.tile
      : null;
  const diceToolLabel =
    config.randomnessMode === "drand"
      ? t("Dés et preuve", "Dice and proof")
      : t("À propos des dés", "About the dice");
  const toolsTitle =
    tool === "journal"
      ? t("Carnet de voyage", "Game log")
      : tool === "proof"
        ? diceToolLabel
        : tool === "rules"
          ? t("Réglages de la partie", "Game settings")
          : t("Votre salle", "Your room");
  const journalEntries = history
    .map((event, index) => ({ content: eventText(event, game), key: index }))
    .filter((item) => item.content !== null)
    .slice(-40)
    .reverse();
  function showTool(
    next: Exclude<GameTool, null>,
    trigger?: HTMLButtonElement,
  ) {
    overlayTrigger.current = trigger ?? null;
    setTool((current) => (current === next ? null : next));
    setInspectorOpen(false);
  }
  function closeTools() {
    setTool(null);
    setInspectorOpen(false);
    overlayTrigger.current?.focus();
  }
  function inspectTile(tile: number) {
    if (salePending) {
      if (saleBlocked || !saleTargets.includes(tile)) return;
      setSaleSelection({
        gameId: authoritative.gameId,
        pending: salePending,
        tile,
      });
      setInspectorOpen(false);
      setTool(null);
      return;
    }
    overlayTrigger.current = null;
    onSelect(tile);
    setInspectorOpen(true);
    setTool(null);
  }
  function choosePick(tile: number) {
    if (!saleBlocked && pickTargets?.includes(tile))
      setPick({ key: pickKey, tile, pending: decisionState.pending });
  }
  function selectOnBoard(tile: number) {
    // While choosing, other spaces are inert so a misclick never opens a panel.
    if (pickTargets) choosePick(tile);
    else inspectTile(tile);
  }
  useEffect(() => {
    setSaleSelection((previous) =>
      previous &&
      (previous.gameId !== authoritative.gameId ||
        previous.pending !== salePending ||
        room.connection !== "online" ||
        busy)
        ? null
        : previous,
    );
  }, [authoritative.gameId, salePending, room.connection, busy]);
  useEffect(() => {
    setPick((previous) =>
      previous &&
      (previous.key !== pickKey ||
        previous.pending !== decisionState.pending ||
        room.connection !== "online" ||
        busy)
        ? null
        : previous,
    );
  }, [pickKey, decisionState.pending, room.connection, busy]);
  useEffect(() => {
    if (salePending || picking) {
      setInspectorOpen(false);
      setTool(null);
    }
  }, [salePending, picking]);
  useEffect(() => {
    if (!tool) return;
    const frame = requestAnimationFrame(() => {
      toolRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [tool]);
  useEffect(() => {
    const closeOverlays = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTool(null);
        setInspectorOpen(false);
        overlayTrigger.current?.focus();
      }
    };
    const fullscreenChanged = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener("keydown", closeOverlays);
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => {
      window.removeEventListener("keydown", closeOverlays);
      document.removeEventListener("fullscreenchange", fullscreenChanged);
    };
  }, []);
  function toggleFullscreen() {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }
  return (
    <>
      <div className="board-stage">
        <SceneBoundary
          fallback={
            <BoardFallback
              state={game}
              onSelect={selectOnBoard}
              targets={pickTargets}
              picked={picked}
              saleTargets={salePending ? saleTargets : undefined}
              saleSelected={saleSelected}
              saleBlocked={saleBlocked}
            />
          }
        >
          <Suspense
            fallback={
              <div className="scene-loading">
                <span className="spinner" />
                {t("Votre plateau prend place…", "Loading board…")}
              </div>
            }
          >
            <BoardScene
              state={game}
              selected={decisionSelected}
              onSelect={selectOnBoard}
              targets={pickTargets}
              picked={picked}
              pickKey={pickKey}
              pickSeat={controlSeat ?? undefined}
              zoom={zoom}
              lowGraphics={lowGraphics}
              onRollAnchor={setRollAnchor}
              saleSeat={salePending ? salePending.seat : undefined}
              saleBlocked={saleBlocked}
            />
          </Suspense>
        </SceneBoundary>
      </div>

      <CardMoment obscured={pauseOpen} />

      <header className="match-topbar">
        <Logo small />
        <div className="match-time">
          {game.config.roundLimit < 10_000 && (
            <span>
              {t(
                `Manche ${game.round}/${game.config.roundLimit}`,
                `Round ${game.round}/${game.config.roundLimit}`,
              )}
            </span>
          )}
          <MatchClock
            deadline={authoritative.matchDeadline}
            finished={authoritative.status === "finished"}
            pausedAt={pausedAt}
          />
          {pausedAt !== null && (
            <button
              type="button"
              className="text-button"
              onClick={openPauseMenu}
            >
              {t("Partie en pause", "Game paused")}
            </button>
          )}
        </div>
        {/* Only a problem is worth reading: a healthy connection stays silent. */}
        <span
          className="match-connection"
          role="status"
          data-state={room.connection}
        >
          {room.connection !== "online" && (
            <>
              <span className="connection-dot" data-state={room.connection} />
              {room.connection === "offline"
                ? t("Hors ligne", "Offline")
                : t("Reconnexion…", "Reconnecting…")}
            </>
          )}
        </span>
      </header>

      <nav
        className="game-tools"
        aria-label={t("Outils de la partie", "Game tools")}
      >
        <button
          type="button"
          className="game-tool-button"
          aria-label={t("Carnet de voyage", "Game log")}
          title={t("Carnet de voyage", "Game log")}
          aria-expanded={tool === "journal"}
          aria-controls="game-tool-panel"
          onClick={(event) => showTool("journal", event.currentTarget)}
        >
          <Icon name="journal" size={18} />
        </button>
        <button
          type="button"
          className={`game-tool-button ${room.randomness?.proof?.verified ? "proof-verified" : ""}`}
          aria-label={diceToolLabel}
          title={diceToolLabel}
          aria-expanded={tool === "proof"}
          onClick={(event) => showTool("proof", event.currentTarget)}
        >
          <Icon
            name={config.randomnessMode === "drand" ? "shield" : "dice"}
            size={18}
          />
        </button>
        <button
          type="button"
          className="game-tool-button"
          aria-label={t("Réglages de la partie", "Game settings")}
          title={t("Réglages de la partie", "Game settings")}
          aria-expanded={tool === "rules"}
          onClick={(event) => showTool("rules", event.currentTarget)}
        >
          <Icon name="settings" size={18} />
        </button>
        <button
          type="button"
          className="game-tool-button"
          aria-label={
            askingToJoin
              ? t(
                  `Inviter des joueurs · ${askingToJoin} demande${askingToJoin > 1 ? "s" : ""} d’entrée`,
                  `Invite players · ${askingToJoin} asking to join`,
                )
              : t("Inviter des joueurs", "Invite players")
          }
          title={t("Inviter des joueurs", "Invite players")}
          aria-expanded={tool === "room"}
          onClick={(event) => showTool("room", event.currentTarget)}
        >
          <Icon name="people" size={18} />
          {askingToJoin > 0 && (
            <span className="tool-badge" aria-hidden="true">
              {askingToJoin}
            </span>
          )}
        </button>
        <button
          type="button"
          className="game-tool-button"
          aria-label={t("Comment jouer", "How to play")}
          title={t("Comment jouer", "How to play")}
          onClick={onHelp}
        >
          <Icon name="help" size={18} />
        </button>
        <button
          type="button"
          className="game-tool-button"
          aria-label={
            fullscreen
              ? t("Quitter le plein écran", "Exit fullscreen")
              : t("Plein écran", "Fullscreen")
          }
          title={
            fullscreen
              ? t("Quitter le plein écran", "Exit fullscreen")
              : t("Plein écran", "Fullscreen")
          }
          onClick={toggleFullscreen}
        >
          <Icon name="fullscreen" size={17} />
        </button>
        <button
          ref={pauseTrigger}
          type="button"
          className="game-tool-button"
          aria-label={t("Menu pause", "Pause menu")}
          title={t("Menu pause", "Pause menu")}
          aria-haspopup="dialog"
          aria-expanded={pauseOpen}
          onClick={openPauseMenu}
        >
          <Icon name="pause" size={18} />
        </button>
      </nav>

      <section
        className="player-roster"
        aria-label={t("Joueurs de la partie", "Players")}
      >
        {game.players.map((player) => {
          const active =
            decidingSeat === player.seat && game.status === "active";
          const presence = room.lobby?.seats.find(
            (entry) => entry.seat === player.seat,
          );
          return (
            <motion.article
              key={player.seat}
              data-seat={player.seat}
              className={`player-card ${active ? "active" : ""} ${player.bankrupt ? "bankrupt" : ""}`}
              style={
                {
                  "--player-color": PLAYER_COLORS[player.seat],
                } as CSSProperties
              }
              animate={{ opacity: player.bankrupt ? 0.7 : 1 }}
              transition={{ duration: reducedMotion ? 0 : 0.2 }}
            >
              <PlayerAvatar seat={player.seat} />
              <div className="player-card-body">
                <div className="player-name-row">
                  <strong>{player.name}</strong>
                  {(mySeats.includes(player.seat) ||
                    player.bankrupt ||
                    player.control === "bot" ||
                    !presence?.online) && (
                    <span>
                      {player.seat === own
                        ? t("Vous", "You")
                        : player.bankrupt
                          ? t("Faillite", "Bankrupt")
                          : mySeats.includes(player.seat)
                            ? t("Ce PC", "This PC")
                            : player.control === "bot"
                              ? "Bot"
                              : t("Absent", "Away")}
                    </span>
                  )}
                </div>
                <TurnTimer
                  // A new decision restarts the bar, even for the same seat.
                  key={active ? game.pending?.deadline : "idle"}
                  pending={active ? game.pending : null}
                  config={game.config}
                  pausedAt={pausedAt}
                />
                <div
                  className="player-cash"
                  title={t(
                    `Fortune ${money(netWorth(game, player.seat))} · ${player.properties.length} propriété${player.properties.length > 1 ? "s" : ""}`,
                    `Net worth ${money(netWorth(game, player.seat))} · ${player.properties.length} ${player.properties.length === 1 ? "property" : "properties"}`,
                  )}
                >
                  <span className="coin-symbol" aria-hidden="true">
                    ●
                  </span>
                  <MoneyCounter value={player.cash} />
                </div>
              </div>
              {player.heldCards.length > 0 && (
                <span
                  className="player-held-cards"
                  title={player.heldCards.map(cardName).join(" · ")}
                >
                  {t(
                    `${player.heldCards.length} carte${player.heldCards.length > 1 ? "s" : ""}`,
                    `${player.heldCards.length} card${player.heldCards.length === 1 ? "" : "s"}`,
                  )}
                </span>
              )}
            </motion.article>
          );
        })}
      </section>

      <AnimatePresence mode="wait">
        {game.status === "finished" && game.result && !busy ? (
          <motion.section
            key="finished"
            className="end-panel match-end-panel"
            aria-labelledby="winner-heading"
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.35 }}
          >
            <MatchResults
              players={game.players}
              result={game.result}
              leader={leader}
              leaderName={leaderName}
              disabled={room.connection !== "online"}
              onLobby={room.returnToLobby}
              onLeave={onLeave}
              onJournal={(button) => showTool("journal", button)}
              leaving={room.leaving}
            />
          </motion.section>
        ) : (
          <motion.div
            key="decision"
            className="contextual-action"
            style={
              rollAnchor
                ? ({
                    "--roll-x": `${rollAnchor.x}px`,
                    "--roll-y": `${rollAnchor.y}px`,
                  } as CSSProperties)
                : undefined
            }
            data-sale={Boolean(salePending && !busy)}
            initial={false}
            animate={{ opacity: 1 }}
          >
            {own === null && (
              <div className="spectator-note">
                <WaitingNotice
                  lobby={room.lobby}
                  member={room.you?.member ?? null}
                />
              </div>
            )}
            <DecisionPanel
              state={serverState ?? game}
              seat={controlSeat}
              playerName={
                sharedScreen && controlSeat !== null
                  ? authoritative.players.find(
                      (player) => player.seat === controlSeat,
                    )?.name
                  : undefined
              }
              act={(action) =>
                room.act(
                  action,
                  controlSeat !== null && controlSeat !== own
                    ? controlSeat
                    : undefined,
                )
              }
              blocked={saleBlocked}
              randomness={room.randomness}
              obscured={pauseOpen || pausedAt !== null}
              selected={decisionSelected}
              onSelect={salePending ? inspectTile : onSelect}
              picked={picked}
              onPick={choosePick}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {inspectorOpen && (
        <CityCard
          state={game}
          seat={controlSeat}
          selected={selected}
          onClose={closeTools}
        />
      )}
      <AnimatePresence>
        {tool && (
          <motion.section
            id="game-tool-panel"
            ref={toolRef}
            key={tool}
            className={`tool-drawer${tool === "journal" ? " tool-drawer--journal" : tool === "rules" ? " tool-drawer--rules" : ""}`}
            aria-labelledby="tool-title"
            initial={reducedMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
          >
            <div className="tool-drawer-head">
              <h2 id="tool-title">{toolsTitle}</h2>
              <button
                type="button"
                className="icon-button"
                aria-label={t("Fermer les outils", "Close tools")}
                onClick={closeTools}
              >
                <Icon name="close" size={17} />
              </button>
            </div>
            {tool === "journal" && (
              <div className="journal">
                <p className="held-cards-note">
                  {ownPlayer?.heldCards.length
                    ? t(
                        `Vos cartes : ${ownPlayer.heldCards.map(cardName).join(" · ")}`,
                        `Your cards: ${ownPlayer.heldCards.map(cardName).join(" · ")}`,
                      )
                    : t(
                        "Toutes les actions récentes de la partie.",
                        "Recent game actions.",
                      )}
                </p>
                <ol>
                  {journalEntries.map((item) => (
                    <li key={item.key}>{item.content}</li>
                  ))}
                </ol>
                {journalEntries.length === 0 && (
                  <p>
                    {t(
                      "Lancez les dés pour commencer.",
                      "Roll the dice to start.",
                    )}
                  </p>
                )}
              </div>
            )}
            {tool === "proof" && (
              <RandomnessPanel
                value={room.randomness}
                mode={config.randomnessMode}
                onHelp={() => {
                  closeTools();
                  onHelp();
                }}
                expanded
              />
            )}
            {tool === "rules" && (
              <div className="match-rules">
                <p className="field-note">
                  {t(
                    "Les réglages sont fixés pour toute la durée de cette partie.",
                    "Settings are fixed for the duration of this game.",
                  )}
                </p>
                <RoomSettingsFields
                  config={config}
                  disabled
                  onChange={() => {}}
                />
              </div>
            )}
            {tool === "room" && (
              <div className="room-tool">
                <span className="small-label">
                  {t("Code de votre salle", "Room code")}
                </span>
                <div className="room-tool-code">
                  <strong>{credentials.roomCode}</strong>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void copyRoom()}
                  >
                    <Icon name={copied ? "check" : "copy"} size={16} />
                    {copied
                      ? t("Invitation copiée", "Invite copied")
                      : t("Copier l’invitation", "Copy invite")}
                  </button>
                </div>
                <WaitingRoom
                  lobby={room.lobby}
                  // The match knows the real bots: a seat a bot only covers
                  // for an absent person stays theirs.
                  bots={
                    authoritative.status === "active"
                      ? authoritative.players.filter(
                          (player) =>
                            player.control === "bot" && !player.bankrupt,
                        )
                      : []
                  }
                  leader={leader}
                  disabled={room.connection !== "online"}
                  onAdmit={room.admit}
                  onDeny={room.deny}
                  onReplaceBot={room.replaceBot}
                />
                {leader ? (
                  <div className="leader-tools">
                    <h3>{t("Vous menez la salle", "You lead this room")}</h3>
                    <RoomLock
                      locked={room.lobby?.locked ?? false}
                      pending={room.pending}
                      disabled={room.connection !== "online"}
                      onChange={room.lock}
                    />
                    <ReturnToLobby
                      finished={game.status === "finished"}
                      disabled={room.connection !== "online"}
                      onConfirm={() => {
                        closeTools();
                        room.returnToLobby();
                      }}
                    />
                  </div>
                ) : (
                  <p className="leader-note">
                    <Icon name="crown" size={14} />
                    {t(
                      `Chef de salle : ${leaderName ?? "-"}`,
                      `Room leader: ${leaderName ?? "-"}`,
                    )}
                  </p>
                )}
                {room.lobby && (
                  <RoomLeaderPicker
                    lobby={room.lobby}
                    leader={leader}
                    disabled={
                      room.pending ||
                      room.leaving ||
                      room.connection !== "online"
                    }
                    onTransferHost={room.transferHost}
                  />
                )}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      <span
        className="match-network"
        role="status"
        aria-live="off"
        title={
          cloudflarePing.status === "success"
            ? t(
                "Dernière mesure du ping Cloudflare. Détails dans Débogage.",
                "Last Cloudflare ping measurement. Details in Debug.",
              )
            : t(
                "Ping Cloudflare indisponible. Détails dans Débogage.",
                "Cloudflare ping unavailable. Details in Debug.",
              )
        }
      >
        {networkPoint} · {networkLatency}
      </span>
      {pauseOpen && (
        <PauseMenu
          game={authoritative}
          mySeats={mySeats}
          blocked={pauseBlocked}
          solo={solo}
          error={room.error}
          onRequestPause={() => {
            if (pauseSeat !== null)
              room.act({ type: "RequestPause" }, pauseSeat);
          }}
          onVote={(seat, accept) =>
            room.act({ type: "VotePause", accept }, seat)
          }
          onResume={() => {
            if (pauseSeat !== null) room.act({ type: "ResumeGame" }, pauseSeat);
            setPauseOpen(false);
            pauseTrigger.current?.focus();
          }}
          onClose={() => {
            setPauseOpen(false);
            pauseTrigger.current?.focus();
          }}
          onLeave={() => {
            setPauseOpen(false);
            onLeave();
          }}
          zoom={zoom}
          onZoom={onZoom}
          lowGraphics={lowGraphics}
          onGraphicsChange={onGraphicsChange}
          connection={room.connection}
          ping={cloudflarePing}
          roomDebug={room.roomDebug}
          ownSeat={own}
          onDebugActiveChange={room.setDebugActive}
          bank={{
            received: authoritative.bankReceived,
            paidOut: authoritative.bankPaidOut,
            balance: authoritative.bankReceived - authoritative.bankPaidOut,
          }}
        />
      )}
      {debug && (
        <div id="frame-monitor" className="frame-monitor">
          {t(
            "Scène au repos · rendu à la demande",
            "Scene idle · on-demand rendering",
          )}
        </div>
      )}
    </>
  );
}

function App() {
  useLocale();
  const [invitationCode, setInvitationCode] = useState<string | null>(
    () =>
      new URLSearchParams(window.location.search)
        .get("room")
        ?.trim()
        .toUpperCase() ?? null,
  );
  const invalidInvitation =
    invitationCode !== null &&
    !RoomCodeSchema.safeParse(invitationCode).success;
  const [credentials, setCredentials] = useState<RoomCredentials | null>(() => {
    const saved = readCredentials();
    return invitationCode !== null && saved?.roomCode !== invitationCode
      ? null
      : saved;
  });
  const [name, setName] = useState(
    () => localStorage.getItem("polytour-name") ?? "",
  );
  const [joinCode, setJoinCode] = useState("");
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const entering = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Null follows the active pawn; an explicit inspection stays pinned.
  const [selected, setSelected] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [lowGraphics, setLowGraphics] = useState(() => {
    try {
      return localStorage.getItem("polytour.lowGraphics") === "true";
    } catch {
      return false;
    }
  });
  function changeGraphics(low: boolean) {
    setLowGraphics(low);
    try {
      localStorage.setItem("polytour.lowGraphics", String(low));
    } catch {
      // The local choice still works when browser storage is unavailable.
    }
  }
  const { serverState, viewState, reducedMotion } = useDirector();
  const room = useRoom(credentials);
  const serverConfigKey = room.lobby ? JSON.stringify(room.lobby.config) : null;
  const activePosition = viewState?.players.find(
    (player) => player.seat === viewState.activeSeat,
  )?.position;
  useEffect(() => {
    if (serverConfigKey)
      setConfig(RoomConfigSchema.parse(JSON.parse(serverConfigKey) as unknown));
  }, [serverConfigKey]);
  const settingsDirty =
    serverConfigKey !== null && JSON.stringify(config) !== serverConfigKey;
  // Play opens a lobby with three bots; a code joins a friend's room instead.
  async function enter(join = false) {
    if (entering.current) return;
    const cleanName = name.trim();
    const code = (invitationCode ?? joinCode).trim().toUpperCase();
    if (!cleanName) {
      setFormError(
        t(
          "Choisissez un nom pour prendre place sur le plateau.",
          "Enter a player name.",
        ),
      );
      document.getElementById("player-name")?.focus();
      return;
    }
    if (join && !RoomCodeSchema.safeParse(code).success) {
      setFormError(
        t(
          "Le code de salle contient six lettres ou chiffres.",
          "Room codes contain six letters or digits.",
        ),
      );
      return;
    }
    entering.current = true;
    setLoading(true);
    setFormError(null);
    try {
      const entered = await enterRoom(
        cleanName,
        join ? config : { ...config, randomnessMode: "secure" },
        join ? code : undefined,
        join ? 0 : 3,
      );
      localStorage.setItem("polytour-name", cleanName);
      director.reset(null);
      setCredentials(entered);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?room=${entered.roomCode}`,
      );
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : t(
              "Impossible d’ouvrir la partie. Réessayez.",
              "Could not open the game. Try again.",
            ),
      );
    } finally {
      entering.current = false;
      setLoading(false);
    }
  }
  async function leave(): Promise<boolean> {
    if (!(await room.leave())) return false;
    forgetCredentials();
    setCredentials(null);
    setInvitationCode(null);
    setJoinCode("");
    setFormError(null);
    setConfig((current) => ({ ...current, randomnessMode: "secure" }));
    director.reset(null);
    setSelected(null);
    window.history.replaceState(null, "", window.location.pathname);
    return true;
  }
  async function copyRoom() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}?room=${credentials.roomCode}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }
  const game = viewState ?? serverState;
  const isGame = credentials && game;
  const debug = new URLSearchParams(window.location.search).has("debug");
  // Room controls stay steady while a quick change awaits its answer: the
  // room hook already drops a second command until the first is answered.
  const roomOffline = room.leaving || room.connection !== "online";
  const starting = room.pendingOp === "start";
  const previewConfig: GameConfig = {
    ...config,
    gameId: "preview",
    boardRule: room.lobby?.boardRule ?? "country",
    economyRule: room.lobby?.economyRule ?? "reference",
    hotelPurchaseRule: room.lobby?.hotelPurchaseRule ?? "staged-hotels",
    sellBackPercent: room.lobby?.sellBackPercent ?? 100,
    worldTourRule: room.lobby?.worldTourRule ?? "free-and-own",
    fourResortRent: room.lobby?.fourResortRent ?? true,
    buildAfterBuyout: room.lobby?.buildAfterBuyout ?? true,
    resortFestivals: room.lobby ? resortFestivals(room.lobby) : false,
  };
  const you = room.you?.seat ?? null;
  const leader = you !== null && you === room.lobby?.hostSeat;
  const leaderName = room.lobby?.seats.find(
    (entry) => entry.seat === room.lobby?.hostSeat,
  )?.name;
  const seated =
    room.lobby?.seats.filter((seat) => seat.control !== null).length ?? 0;
  return (
    <main
      className={isGame ? "game-shell" : "lobby-shell"}
      data-reduced-motion={reducedMotion}
    >
      {!isGame && (
        <header className="topbar">
          <span className="brand-button">
            <Logo small={Boolean(isGame)} />
          </span>
          <div className="topbar-right">
            <span className="prototype-tag">Prototype</span>
            <GraphicsToggle
              lowGraphics={lowGraphics}
              onChange={changeGraphics}
              compact
            />
            <LanguagePicker />
            <button
              type="button"
              className="text-button help-button"
              onClick={() => setHelpOpen(true)}
            >
              <Icon name="help" size={18} />
              <span>{t("Comment jouer", "How to play")}</span>
            </button>
            {(credentials || invitationCode !== null) && (
              <ActionButton
                type="button"
                className="text-button"
                disabled={loading || room.leaving}
                onClick={() => void leave()}
              >
                {room.leaving
                  ? t("Départ en cours…", "Leaving…")
                  : t("Quitter", "Leave")}
              </ActionButton>
            )}
          </div>
        </header>
      )}
      {!credentials ? (
        <section
          className={`welcome-grid${invitationCode !== null ? " invitation-entry" : ""}`}
        >
          {invitationCode !== null ? (
            <InvitationEntry
              name={name}
              onName={setName}
              onJoin={() => void enter(true)}
              loading={loading}
              error={formError}
              invalid={invalidInvitation}
            />
          ) : (
            <div className="welcome-copy">
              <span className="travel-stamp">
                <Icon name="people" size={17} />
                {t("4 places · amis ou bots", "4 seats · friends or bots")}
              </span>
              <h1>{t("Nouvelle partie", "New game")}</h1>
              <p className="welcome-intro">
                {t(
                  "Achetez. Construisez. Améliorez. Encaissez.",
                  "Buy. Build. Upgrade. Collect.",
                )}
              </p>
              <div className="welcome-form">
                <label htmlFor="player-name">
                  {t("Votre nom de joueur", "Player name")}
                </label>
                <input
                  id="player-name"
                  value={name}
                  maxLength={24}
                  autoComplete="nickname"
                  placeholder={t("Votre pseudo", "Your nickname")}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void enter();
                  }}
                />
                <ActionButton
                  type="button"
                  className="button primary welcome-play"
                  disabled={loading}
                  onClick={() => void enter()}
                >
                  {loading ? (
                    <span className="spinner" />
                  ) : (
                    <Icon name="dice" size={24} />
                  )}
                  {loading
                    ? t("Préparation du salon…", "Preparing the lobby…")
                    : t("Jouer", "Play")}
                  <Icon name="arrow" />
                </ActionButton>
                <div className="join-form">
                  <label htmlFor="room-code">
                    {t("Vous avez un code ?", "Have a room code?")}
                  </label>
                  <div>
                    <input
                      id="room-code"
                      className="code-input"
                      value={joinCode}
                      maxLength={6}
                      placeholder="ABCD23"
                      autoCapitalize="characters"
                      spellCheck={false}
                      onChange={(event) =>
                        setJoinCode(event.target.value.toUpperCase())
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void enter(true);
                      }}
                    />
                    <ActionButton
                      type="button"
                      className="button ink"
                      disabled={loading}
                      onClick={() => void enter(true)}
                    >
                      {t("Rejoindre", "Join")}
                      <Icon name="arrow" size={18} />
                    </ActionButton>
                  </div>
                </div>
                {formError && (
                  <p className="error-message" role="alert">
                    {formError}
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="welcome-world">
            <div className="welcome-board-preview">
              <SceneBoundary
                fallback={
                  <BoardFallback
                    state={null}
                    config={previewConfig}
                    onSelect={setSelected}
                  />
                }
              >
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <span className="spinner" />
                      {t("Chargement du plateau…", "Loading board…")}
                    </div>
                  }
                >
                  <BoardScene
                    state={null}
                    config={previewConfig}
                    selected={null}
                    onSelect={setSelected}
                    preview
                    lowGraphics={lowGraphics}
                  />
                </Suspense>
              </SceneBoundary>
            </div>
            {invitationCode === null && (
              <div className="welcome-quick-settings">
                <span className="welcome-setup-title">
                  {t("Réglages rapides", "Quick settings")}
                </span>
                <QuickSettings config={config} onChange={setConfig} />
              </div>
            )}
          </div>
        </section>
      ) : !game ? (
        <section className="room-lobby">
          <div className="room-lobby-main">
            <span className="travel-stamp">
              <Icon name="people" size={17} />
              {t("Salle de jeu", "Game room")}
            </span>
            <h1>{t("Joueurs", "Players")}</h1>
            <p className="welcome-intro">
              {t(
                "De 2 à 4 joueurs. Vos amis prennent la place d’un bot en entrant ce code ; un joueur assis à côté de vous peut jouer sur ce PC.",
                "2 to 4 players. Friends take a bot’s seat by entering this code; someone next to you can play on this PC.",
              )}
            </p>
            <div className="room-code-block">
              <div>
                <span>{t("Code de la salle", "Room code")}</span>
                <strong>{credentials.roomCode}</strong>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => void copyRoom()}
              >
                <Icon name={copied ? "check" : "copy"} />
                {copied
                  ? t("Lien copié", "Link copied")
                  : t("Copier l’invitation", "Copy invite")}
              </button>
            </div>
            <LobbySeats
              lobby={room.lobby}
              you={you}
              leader={leader}
              disabled={roomOffline}
              onAddBot={room.addBot}
              onRemoveBot={room.removeBot}
              onAddLocal={room.addLocal}
              onRemoveLocal={room.removeLocal}
              onTransferHost={room.transferHost}
            />
            <WaitingRoom
              lobby={room.lobby}
              leader={leader}
              disabled={roomOffline}
              onAdmit={room.admit}
              onDeny={room.deny}
              onReplaceBot={room.replaceBot}
            />
            {leader && (
              <RoomLock
                locked={room.lobby?.locked ?? false}
                pending={room.pending}
                disabled={roomOffline}
                onChange={room.lock}
              />
            )}
            {leader && (
              <>
                <p className="lobby-count" role="status">
                  {seated < ECONOMY.minimumPlayers
                    ? t(
                        "Il faut au moins 2 joueurs : ajoutez un bot ou invitez un ami.",
                        "At least 2 players are needed: add a bot or invite a friend.",
                      )
                    : seated < ECONOMY.maximumPlayers
                      ? t(
                          `Partie à ${seated} joueurs. Les places libres resteront vides.`,
                          `${seated}-player game. Open seats will stay empty.`,
                        )
                      : t("Partie à 4 joueurs.", "4-player game.")}
                </p>
                <ActionButton
                  type="button"
                  className="button primary welcome-play"
                  disabledReason={
                    starting
                      ? undefined
                      : roomOffline
                        ? t(
                            "Reconnectez-vous au serveur avant de démarrer.",
                            "Reconnect to the server before starting.",
                          )
                        : settingsDirty
                          ? t(
                              "Les réglages s’enregistrent à la fermeture de leur fenêtre.",
                              "Settings save when their window closes.",
                            )
                          : t(
                              "Ajoutez un bot ou invitez un ami : il faut au moins 2 joueurs.",
                              "Add a bot or invite a friend: at least 2 players are needed.",
                            )
                  }
                  disabled={
                    roomOffline ||
                    starting ||
                    settingsDirty ||
                    seated < ECONOMY.minimumPlayers
                  }
                  onClick={() => room.start(false)}
                >
                  <Icon name="dice" />
                  {starting
                    ? t("Le plateau se prépare…", "Preparing board…")
                    : t("Démarrer la partie", "Start game")}
                  <Icon name="arrow" />
                </ActionButton>
              </>
            )}
            {!leader && you !== null && (
              <p className="waiting-host">
                <span className="spinner" />
                {t(
                  `En attente du démarrage par ${leaderName ?? "le chef de salle"}.`,
                  `Waiting for ${leaderName ?? "the room leader"} to start.`,
                )}
              </p>
            )}
            {you === null && room.you && (
              <WaitingNotice lobby={room.lobby} member={room.you.member} />
            )}
            <RoomSettings
              config={config}
              disabled={!leader || roomOffline}
              onChange={setConfig}
              save={
                leader
                  ? {
                      dirty: settingsDirty,
                      onSave: () => room.settings(config),
                    }
                  : undefined
              }
            />
          </div>
          <div className="room-preview">
            <SceneBoundary
              fallback={
                <BoardFallback
                  state={null}
                  config={previewConfig}
                  onSelect={setSelected}
                />
              }
            >
              <Suspense
                fallback={
                  <div className="scene-loading">
                    {t("Préparation du plateau…", "Preparing board…")}
                  </div>
                }
              >
                <BoardScene
                  state={null}
                  config={previewConfig}
                  selected={null}
                  onSelect={setSelected}
                  preview
                  lowGraphics={lowGraphics}
                />
              </Suspense>
            </SceneBoundary>
          </div>
        </section>
      ) : (
        <MatchView
          game={game}
          credentials={credentials}
          room={room}
          config={config}
          selected={selected ?? activePosition ?? null}
          onSelect={setSelected}
          zoom={zoom}
          onZoom={setZoom}
          lowGraphics={lowGraphics}
          onGraphicsChange={changeGraphics}
          copied={copied}
          copyRoom={copyRoom}
          onLeave={() => void leave()}
          onHelp={() => setHelpOpen(true)}
          debug={debug}
        />
      )}
      {credentials && !game && (
        <div className="lobby-connection" role="status">
          <span className="connection-dot" data-state={room.connection} />
          {room.connection === "online"
            ? t("Salle connectée", "Room connected")
            : t("Connexion à votre salle…", "Connecting to your room…")}
        </div>
      )}
      {room.error && (
        <div className="network-error" role="alert">
          <span>{room.error}</span>
          {room.connection !== "online" && (
            <ActionButton
              type="button"
              className="text-button"
              onClick={room.reconnect}
              disabled={room.leaving}
              disabledReason={t(
                "Vous quittez la salle. Veuillez patienter.",
                "You are leaving the room. Please wait.",
              )}
            >
              {t("Reconnecter", "Reconnect")}
            </ActionButton>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={t("Fermer le message", "Dismiss message")}
            onClick={room.clearError}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      <Help
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        mode={config.randomnessMode}
        config={game?.config ?? previewConfig}
      />
      {!isGame && (
        <footer className="lobby-footer">
          <span>{t("Crée par Poli & GJJS", "Made by Poli & GJJS")}</span>
          <a
            href="https://github.com/Rusutsu-Studios/Polytour/"
            target="_blank"
            rel="noopener"
          >
            {t("Voir sur GitHub", "View on GitHub")}
          </a>
          <Changelog />
        </footer>
      )}
    </main>
  );
}
export default App;
