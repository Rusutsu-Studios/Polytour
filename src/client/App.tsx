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
import { BOARD, ECONOMY, ruleEconomy } from "../shared/board/index.js";
import type {
  GameConfig,
  GameEvent,
  PlayerState,
  PublicState,
  Seat,
  WinKind,
} from "../shared/engine/index.js";
import {
  economyRule,
  decisionWindow,
  getProperty,
  legalActions,
  netWorth,
  propertyRefund,
  propertyRent,
} from "../shared/engine/index.js";
import type {
  LobbyState,
  RandomnessStatus,
  RoomConfig,
  RoomCredentials,
} from "../shared/protocol/index.js";
import { RoomConfigSchema } from "../shared/protocol/index.js";
import { director, useDirector } from "./director/director.js";
import { translate as t, useLocale } from "./i18n.js";
import {
  enterRoom,
  forgetCredentials,
  readCredentials,
  useRoom,
} from "./net/room.js";
import {
  fullMoney,
  levelName,
  money,
  PLAYER_COLORS,
  PLAYER_SYMBOLS,
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
import CityCard from "./ui/CityCard.js";
import { cardName } from "./ui/chance-display.js";
import DecisionPanel from "./ui/DecisionPanel.js";
import Icon from "./ui/Icon.js";
import { QuickSettings } from "./ui/RoomSettings.js";
import RoomSettings from "./ui/SettingsDialog.js";
import "./App.css";

const BoardScene = lazy(() => import("./scene/BoardScene.js"));
const DEFAULT_CONFIG = RoomConfigSchema.parse({});
function LanguagePicker() {
  const { locale, setLocale } = useLocale();
  return (
    <label className="language-picker">
      <span className="sr-only">Langue / Language</span>
      <select
        value={locale}
        onChange={(event) =>
          setLocale(event.currentTarget.value === "en" ? "en" : "fr")
        }
      >
        <option value="fr">Français</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
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
  const { speed, reducedMotion } = useDirector();
  useEffect(() => {
    if (reducedMotion) {
      setDisplay(value);
      previous.current = value;
      return;
    }
    const controls = animate(previous.current, value, {
      duration: 0.45 / speed,
      ease: "easeOut",
      onUpdate: (amount) => setDisplay(Math.round(amount)),
    });
    previous.current = value;
    return () => controls.stop();
  }, [value, speed, reducedMotion]);
  return <>{fullMoney(display)}</>;
}

function PlayerAvatar({ seat }: { seat: Seat }) {
  return (
    <div
      className="player-avatar"
      aria-hidden="true"
      style={{ "--player-color": PLAYER_COLORS[seat] } as CSSProperties}
    >
      <i className="avatar-head">
        <i className="avatar-cap" />
        <i className="avatar-eyes" />
      </i>
      <i className="avatar-body" />
      <span>{PLAYER_SYMBOLS[seat]}</span>
    </div>
  );
}

// Four table places, like the cards of a tabletop lobby: the host fills an
// open place with a bot by clicking it, and can send that bot away again.
function LobbySeats({
  lobby,
  you,
  host,
  disabled,
  onAddBot,
  onRemoveBot,
}: {
  lobby: LobbyState | null;
  you: Seat;
  host: boolean;
  disabled: boolean;
  onAddBot: (seat: Seat) => void;
  onRemoveBot: (seat: Seat) => void;
}) {
  return (
    <ul className="lobby-seats">
      {([0, 1, 2, 3] as const).map((seat) => {
        const player = lobby?.seats.find((item) => item.seat === seat);
        const style = {
          "--player-color": PLAYER_COLORS[seat],
        } as CSSProperties;
        if (!player?.control)
          return (
            <li key={seat} className="lobby-seat empty" style={style}>
              {host ? (
                <button
                  type="button"
                  className="seat-open"
                  disabled={disabled}
                  aria-label={t(
                    `Ajouter un bot à la place ${seat + 1}`,
                    `Add a bot to seat ${seat + 1}`,
                  )}
                  onClick={() => onAddBot(seat)}
                >
                  <span className="seat-plus" aria-hidden="true">
                    +
                  </span>
                  <strong>{t("Ajouter un bot", "Add a bot")}</strong>
                  <span>{t("ou attendez un ami", "or wait for a friend")}</span>
                </button>
              ) : (
                <div className="seat-open">
                  <span className="seat-plus" aria-hidden="true">
                    {PLAYER_SYMBOLS[seat]}
                  </span>
                  <strong>{t("Place libre", "Open seat")}</strong>
                  <span>
                    {t("En attente d’un joueur", "Waiting for a player")}
                  </span>
                </div>
              )}
            </li>
          );
        return (
          <li
            key={seat}
            className={`lobby-seat filled ${player.control}`}
            style={style}
          >
            <PlayerAvatar seat={seat} />
            <strong>{player.name}</strong>
            <span className="seat-status">
              {player.control === "bot"
                ? "Bot"
                : !player.online
                  ? t("Connexion…", "Connecting…")
                  : seat === you
                    ? t("Vous", "You")
                    : t("En ligne", "Online")}
            </span>
            {seat === lobby?.hostSeat && (
              <span className="host-label">{t("Hôte", "Host")}</span>
            )}
            {host && player.control === "bot" && (
              <button
                type="button"
                className="seat-remove"
                disabled={disabled}
                aria-label={t(
                  `Retirer le bot ${player.name}`,
                  `Remove bot ${player.name}`,
                )}
                onClick={() => onRemoveBot(seat)}
              >
                <Icon name="close" size={15} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
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
      "You own all four resorts.",
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
  onReplay,
  onLeave,
  onJournal,
}: {
  players: readonly PlayerState[];
  result: NonNullable<PublicState["result"]>;
  onReplay: () => void;
  onLeave: () => void;
  onJournal: (button: HTMLButtonElement) => void;
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
            <span className="standing-symbol" aria-hidden="true">
              {PLAYER_SYMBOLS[standing.seat]}
            </span>
            <b>
              {players.find((player) => player.seat === standing.seat)?.name}
            </b>
            <strong>{money(standing.netWorth)}</strong>
          </li>
        ))}
      </ol>
      <button type="button" className="button primary" onClick={onReplay}>
        {t("Rejouer avec des bots", "Play again with bots")}
        <Icon name="arrow" />
      </button>
      <button type="button" className="button secondary" onClick={onLeave}>
        {t("Nouvelle salle entre amis", "New room with friends")}
      </button>
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
}: {
  state: PublicState | null;
  onSelect: (tile: number) => void;
  saleTargets?: readonly number[];
  saleSelected?: number | null;
  saleBlocked?: boolean;
}) {
  return (
    <section
      className="flat-board"
      data-sale-active={saleTargets !== undefined}
      aria-label={t("Plateau accessible", "Accessible board")}
    >
      <p className="flat-board-note">
        {t("Vue légère du plateau", "Simple board view")}
      </p>
      {BOARD.map((tile) => (
        <button
          type="button"
          key={tile.index}
          style={{ "--tile-color": tileColor(tile.index) } as CSSProperties}
          data-sale={saleTargets?.includes(tile.index) || undefined}
          aria-pressed={
            saleTargets?.includes(tile.index)
              ? saleSelected === tile.index
              : undefined
          }
          aria-label={
            state && saleTargets?.includes(tile.index)
              ? t(
                  `Choisir ${tileName(tile.index)} à vendre · ${money(propertyRefund(state, tile.index))}`,
                  `Select ${tileName(tile.index)} to sell · ${money(propertyRefund(state, tile.index))}`,
                )
              : undefined
          }
          disabled={
            saleTargets !== undefined &&
            (saleBlocked || !saleTargets.includes(tile.index))
          }
          onClick={() => onSelect(tile.index)}
        >
          <span>{tileName(tile.index)}</span>
          <b>
            {state && saleTargets?.includes(tile.index)
              ? `+${money(propertyRefund(state, tile.index))}`
              : state && getProperty(state, tile.index)?.owner != null
                ? PLAYER_SYMBOLS[getProperty(state, tile.index)?.owner ?? 0]
                : tilePrice(tile.index, state) != null
                  ? money(tilePrice(tile.index, state) ?? 0)
                  : TILE_ICONS[tile.kind]}
          </b>
        </button>
      ))}
    </section>
  );
}

function eventText(event: GameEvent, state: PublicState): string | null {
  const name =
    "seat" in event
      ? (state.players.find((player) => player.seat === event.seat)?.name ??
        t("Un joueur", "A player"))
      : "";
  switch (event.type) {
    case "DiceRolled":
      return t(
        `${name} lance ${event.dice[0]} + ${event.dice[1]}${event.isDouble ? " · double !" : ""}`,
        `${name} rolls ${event.dice[0]} + ${event.dice[1]}${event.isDouble ? " · doubles!" : ""}`,
      );
    case "PropertyBought":
      return t(
        `${name} achète ${tileName(event.tile)} · ${money(event.amount)}`,
        `${name} buys ${tileName(event.tile)} · ${money(event.amount)}`,
      );
    case "PropertyUpgraded":
      return t(
        `${name} construit à ${tileName(event.tile)} · ${levelName(event.level)}`,
        `${name} builds in ${tileName(event.tile)} · ${levelName(event.level)}`,
      );
    case "BoughtOut":
      return t(
        `${name} rachète ${tileName(event.tile)} · ${money(event.amount)}`,
        `${name} buys out ${tileName(event.tile)} · ${money(event.amount)}`,
      );
    case "PropertySold":
      return t(
        `${name} vend ${tileName(event.tile)} · ${money(event.amount)}`,
        `${name} sells ${tileName(event.tile)} · ${money(event.amount)}`,
      );
    case "RentPaid":
      return t(
        `${name} paie ${money(event.amount)} à ${state.players.find((player) => player.seat === event.owner)?.name}`,
        `${name} pays ${money(event.amount)} to ${state.players.find((player) => player.seat === event.owner)?.name}`,
      );
    case "SalaryPaid":
      return t(
        `${name} reçoit ${money(event.amount)} au départ`,
        `${name} receives ${money(event.amount)} at Start`,
      );
    case "CardDrawn":
      return t(
        `${name} tire « ${cardName(event.card)} »`,
        `${name} draws “${cardName(event.card)}”`,
      );
    case "CardUsed":
      return t(
        `${name} joue « ${cardName(event.card)} »`,
        `${name} plays “${cardName(event.card)}”`,
      );
    case "PlayerBankrupt":
      return t(`${name} fait faillite`, `${name} goes bankrupt`);
    case "SentToIsland":
      return t(`${name} séjourne sur l’île`, `${name} arrives on the island`);
    case "LeftIsland":
      return t(`${name} quitte l’île`, `${name} leaves the island`);
    case "ChampionshipChanged":
      return event.host
        ? t(
            `Championnat à ${tileName(event.host.tile)} · loyers ×${event.host.multiplier}`,
            `Championship in ${tileName(event.host.tile)} · rent ×${event.host.multiplier}`,
          )
        : null;
    case "MoneyTransferred":
      return t(
        `${event.from === null ? "La banque" : state.players.find((player) => player.seat === event.from)?.name} verse ${money(event.amount)} à ${event.to === null ? "la banque" : state.players.find((player) => player.seat === event.to)?.name}`,
        `${event.from === null ? "The bank" : state.players.find((player) => player.seat === event.from)?.name} pays ${money(event.amount)} to ${event.to === null ? "the bank" : state.players.find((player) => player.seat === event.to)?.name}`,
      );
    case "GameOver":
      return t(
        `${state.players.find((player) => player.seat === event.winner)?.name} remporte la partie`,
        `${state.players.find((player) => player.seat === event.winner)?.name} wins the game`,
      );
    default:
      return null;
  }
}

function RandomnessPanel({
  value,
  mode,
  expanded = false,
}: {
  value: RandomnessStatus | null;
  mode: RoomConfig["randomnessMode"];
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
          <p>
            {t(
              "Chaque lancer utilise de nouveaux octets aléatoires générés par le serveur Cloudflare. Chaque face a une chance sur six, avec la même méthode pour tous les joueurs. Aucun avantage payant ne modifie les dés.",
              "Each roll uses fresh random bytes generated by the Cloudflare server. Each face has a one-in-six chance, using the same method for every player. Paid bonuses cannot change the dice.",
            )}
          </p>
          {proof && (
            <p className="proof-result">
              {t(
                `Dernier lancer : ${proof.dice[0]} + ${proof.dice[1]}`,
                `Last roll: ${proof.dice[0]} + ${proof.dice[1]}`,
              )}
            </p>
          )}
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
function Help({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="help-dialog"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="help-top">
        <h2>{t("Votre premier tour", "How to play")}</h2>
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
              "Dernier joueur debout, trois collections complètes, une ligne complète ou les quatre stations : plusieurs routes mènent à la victoire selon les réglages. À la fin du temps, la fortune totale départage les joueurs.",
              "Win by being the last player standing, completing three city groups, owning a whole side or all four resorts, depending on the room settings. When time runs out, highest net worth wins.",
            )}
          </span>
        </li>
      </ol>
      <p className="field-note">
        {t(
          "Tous les joueurs ont les mêmes règles. Aucun bonus payant. Les valeurs de départ sont celles fournies ; cette première version conserve une économie de loyers à ajuster.",
          "The same rules apply to every player, with no paid bonuses. Starting values follow the selected settings; prototype rents are still being tuned.",
        )}
      </p>
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
}: {
  deadline: number | null;
  finished: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (finished || deadline === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline, finished]);
  if (deadline === null) return null;
  const seconds = finished
    ? 0
    : Math.max(0, Math.ceil((deadline - now) / 1000));
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
}: {
  pending: PublicState["pending"];
  config: GameConfig;
}) {
  if (!pending) return <div className="player-timer" aria-hidden="true" />;
  const windowMs = decisionWindow(config, pending.kind);
  const delay = pending.deadline - windowMs - Date.now();
  return (
    <div className="player-timer" aria-hidden="true">
      <span
        className="player-timer-fill"
        style={
          {
            "--timer-window": `${windowMs}ms`,
            "--timer-delay": `${delay}ms`,
          } as CSSProperties
        }
      />
    </div>
  );
}

type GameTool = "journal" | "proof" | "view" | "room" | null;

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
  copied,
  copyRoom,
  onLeave,
  onHelp,
  onReplay,
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
  copied: boolean;
  copyRoom: () => Promise<void>;
  onLeave: () => void;
  onHelp: () => void;
  onReplay: () => void;
  debug: boolean;
}) {
  const { serverState, busy, speed, history, reducedMotion } = useDirector();
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
  const ownPlayer = game.players.find(
    (player) => player.seat === credentials.seat,
  );
  const authoritative = serverState ?? game;
  const salePending =
    authoritative.status === "active" &&
    authoritative.pending?.kind === "sell" &&
    authoritative.pending.seat === credentials.seat &&
    !authoritative.players.find((player) => player.seat === credentials.seat)
      ?.bankrupt
      ? authoritative.pending
      : null;
  const saleTargets = salePending
    ? legalActions(authoritative, credentials.seat).flatMap((action) =>
        action.type === "Sell" ? [action.tile] : [],
      )
    : [];
  const saleBlocked =
    busy ||
    room.pending ||
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
    !busy &&
    (room.randomness === null || room.randomness.status === "resolved") &&
    decisionState.status === "active" &&
    decisionState.pending?.seat === credentials.seat &&
    !ownPlayer?.bankrupt &&
    isBoardPick(decisionState);
  const pickTargets = useMemo(
    () =>
      picking
        ? boardPickActions(decisionState, credentials.seat).map(
            (action) => action.tile,
          )
        : null,
    [picking, decisionState, credentials.seat],
  );
  const pickKey = boardPickKey(decisionState);
  const [pick, setPick] = useState<{ key: string; tile: number } | null>(null);
  const picked =
    pickTargets && pick?.key === pickKey && pickTargets.includes(pick.tile)
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
        : tool === "view"
          ? t("Vue et animations", "View and animation")
          : t("Votre salle", "Your room");
  const latestAction = history
    .map((event) => eventText(event, game))
    .filter((text): text is string => text !== null)
    .at(-1);
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
    if (pickTargets?.includes(tile)) setPick({ key: pickKey, tile });
  }
  function selectOnBoard(tile: number) {
    // While choosing, other spaces are inert so a misclick never opens a panel.
    if (pickTargets) choosePick(tile);
    else inspectTile(tile);
  }
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
              onSelect={inspectTile}
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
              onSelect={inspectTile}
              zoom={zoom}
              onRollAnchor={setRollAnchor}
              saleSeat={salePending ? credentials.seat : undefined}
              saleBlocked={saleBlocked}
            />
          </Suspense>
        </SceneBoundary>
      </div>

      <CardMoment />

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
            deadline={game.matchDeadline}
            finished={game.status === "finished"}
          />
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
          aria-label={t("Explorer le plateau", "Inspect the board")}
          title={t("Explorer le plateau", "Inspect the board")}
          aria-expanded={inspectorOpen}
          onClick={(event) => {
            overlayTrigger.current = event.currentTarget;
            setInspectorOpen((value) => !value);
            setTool(null);
          }}
        >
          <Icon name="search" size={18} />
        </button>
        <button
          type="button"
          className="game-tool-button"
          aria-label={t("Vue et animations", "View and animation")}
          title={t("Vue et animations", "View and animation")}
          aria-expanded={tool === "view"}
          onClick={(event) => showTool("view", event.currentTarget)}
        >
          <Icon name="settings" size={18} />
        </button>
        <button
          type="button"
          className="game-tool-button"
          aria-label={t(
            "Inviter et voir les réglages",
            "Invite and view settings",
          )}
          title={t("Inviter et voir les réglages", "Invite and view settings")}
          aria-expanded={tool === "room"}
          onClick={(event) => showTool("room", event.currentTarget)}
        >
          <Icon name="people" size={18} />
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
          type="button"
          className="game-tool-button"
          aria-label={t("Quitter la partie", "Leave game")}
          title={t("Quitter la partie", "Leave game")}
          onClick={onLeave}
        >
          <Icon name="exit" size={18} />
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
              transition={{ duration: reducedMotion ? 0 : 0.2 / speed }}
            >
              <PlayerAvatar seat={player.seat} />
              <div className="player-card-body">
                <div className="player-name-row">
                  <strong>{player.name}</strong>
                  {(player.seat === credentials.seat ||
                    player.bankrupt ||
                    player.control === "bot" ||
                    !presence?.online) && (
                    <span>
                      {player.seat === credentials.seat
                        ? t("Vous", "You")
                        : player.bankrupt
                          ? t("Faillite", "Bankrupt")
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
            transition={{ duration: 0.35 / speed }}
          >
            <MatchResults
              players={game.players}
              result={game.result}
              onReplay={onReplay}
              onLeave={onLeave}
              onJournal={(button) => showTool("journal", button)}
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
            <DecisionPanel
              state={serverState ?? game}
              seat={credentials.seat}
              act={room.act}
              blocked={room.pending || room.connection !== "online"}
              randomness={room.randomness}
              selected={decisionSelected}
              onSelect={salePending ? inspectTile : onSelect}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {inspectorOpen && (
        <CityCard
          state={game}
          seat={credentials.seat}
          selected={selected}
          onSelect={onSelect}
          onClose={closeTools}
        />
      )}
      <AnimatePresence>
        {tool && (
          <motion.section
            ref={toolRef}
            key={tool}
            className="tool-drawer"
            aria-labelledby="tool-title"
            initial={reducedMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 / speed }}
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
                  {history
                    .map((event, index) => ({
                      text: eventText(event, game),
                      key: index,
                    }))
                    .filter((item) => item.text)
                    .slice(-40)
                    .reverse()
                    .map((item) => (
                      <li key={item.key}>{item.text}</li>
                    ))}
                </ol>
                {!latestAction && (
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
                expanded
              />
            )}
            {tool === "view" && (
              <div className="view-settings">
                <LanguagePicker />
                <label htmlFor="animation-speed">
                  {t("Vitesse des animations", "Animation speed")}
                  <select
                    id="animation-speed"
                    value={speed}
                    onChange={(event) =>
                      director.setSpeed(
                        Number(event.target.value) as 1 | 1.5 | 2,
                      )
                    }
                  >
                    <option value={1}>
                      {t("1× · Prendre le temps", "1× · Normal")}
                    </option>
                    <option value={1.5}>
                      {t("1,5× · Classique", "1.5× · Faster")}
                    </option>
                    <option value={2}>
                      {t("2× · Partie rapide", "2× · Fast")}
                    </option>
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={reducedMotion}
                    onChange={(event) =>
                      director.setReducedMotion(event.target.checked)
                    }
                  />
                  {t("Réduire les animations", "Reduce motion")}
                </label>
                <div className="zoom-control">
                  <span>{t("Taille du plateau", "Board size")}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Dézoomer le plateau", "Zoom out")}
                    disabled={zoom <= 0.8}
                    onClick={() => onZoom(Math.max(0.8, zoom - 0.1))}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => onZoom(1)}
                  >
                    {t("Recentrer", "Reset view")}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Zoomer le plateau", "Zoom in")}
                    disabled={zoom >= 1.3}
                    onClick={() => onZoom(Math.min(1.3, zoom + 0.1))}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!busy}
                  onClick={director.skip}
                >
                  {t("Terminer l’animation en cours", "Skip current animation")}
                </button>
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
                <p className="field-note">
                  {t(
                    "Les réglages sont fixés pour toute la durée de cette partie.",
                    "Settings are fixed for the duration of this game.",
                  )}
                </p>
                <RoomSettings config={config} disabled onChange={() => {}} />
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      <div className="match-caption">
        <span>{latestAction}</span>
        <button
          type="button"
          className="text-button"
          disabled={!busy}
          onClick={director.skip}
        >
          {busy ? t("Passer l’animation ↗", "Skip animation ↗") : ""}
        </button>
      </div>
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
  const initialCode =
    new URLSearchParams(window.location.search).get("room")?.toUpperCase() ??
    "";
  const [credentials, setCredentials] = useState<RoomCredentials | null>(() => {
    const saved = readCredentials();
    return initialCode && saved?.roomCode !== initialCode ? null : saved;
  });
  const [name, setName] = useState(
    () => localStorage.getItem("polytour-name") ?? "",
  );
  const [joinCode, setJoinCode] = useState(initialCode);
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const entering = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  // Null follows the active pawn; an explicit inspection stays pinned.
  const [selected, setSelected] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const { serverState, viewState } = useDirector();
  const room = useRoom(credentials);
  useEffect(() => {
    if (
      !autoStart ||
      room.lobby?.status !== "lobby" ||
      room.connection !== "online" ||
      room.pending
    )
      return;
    setAutoStart(false);
    room.start(true);
  }, [autoStart, room.lobby, room.connection, room.pending, room.start]);
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
  async function enter(solo: boolean, join = false) {
    if (entering.current) return;
    const cleanName = name.trim();
    const code = joinCode.trim().toUpperCase();
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
    if (join && !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) {
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
      );
      localStorage.setItem("polytour-name", cleanName);
      director.reset(null);
      setCredentials(entered);
      setAutoStart(solo);
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
  function leave() {
    forgetCredentials();
    setCredentials(null);
    setAutoStart(false);
    setConfig((current) => ({ ...current, randomnessMode: "secure" }));
    director.reset(null);
    setSelected(null);
    window.history.replaceState(null, "", window.location.pathname);
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
  const blockActions = room.pending || room.connection !== "online";
  const host = credentials?.seat === room.lobby?.hostSeat;
  const seated =
    room.lobby?.seats.filter((seat) => seat.control !== null).length ?? 0;
  return (
    <main className={isGame ? "game-shell" : "lobby-shell"}>
      {!isGame && (
        <header className="topbar">
          <span className="brand-button">
            <Logo small={Boolean(isGame)} />
          </span>
          <div className="topbar-right">
            <span className="prototype-tag">Prototype</span>
            <LanguagePicker />
            <button
              type="button"
              className="text-button help-button"
              onClick={() => setHelpOpen(true)}
            >
              <Icon name="help" size={18} />
              <span>{t("Comment jouer", "How to play")}</span>
            </button>
            {credentials && (
              <button type="button" className="text-button" onClick={leave}>
                {t("Quitter", "Leave")}
              </button>
            )}
          </div>
        </header>
      )}
      {!credentials ? (
        <section className="welcome-grid">
          <div className="welcome-copy">
            <span className="travel-stamp">
              <Icon name="people" size={17} />
              {t("4 places · amis ou bots", "4 seats · friends or bots")}
            </span>
            <h1>{t("Nouvelle partie", "New game")}</h1>
            <p className="welcome-intro">
              {t(
                "Achetez les villes où vous vous arrêtez, construisez et encaissez les loyers.",
                "Buy the cities you land on, build and collect rent.",
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
                  if (event.key === "Enter") void enter(true);
                }}
              />
              <button
                type="button"
                className="button primary welcome-play"
                disabled={loading}
                onClick={() => void enter(true)}
              >
                {loading ? (
                  <span className="spinner" />
                ) : (
                  <Icon name="dice" size={24} />
                )}
                {loading
                  ? t("Préparation du plateau…", "Preparing board…")
                  : t("Jouer avec 3 bots", "Play with 3 bots")}
                <Icon name="arrow" />
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={loading}
                onClick={() => void enter(false)}
              >
                <Icon name="people" />
                {t("Créer une salle entre amis", "Create a room with friends")}
              </button>
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
                      if (event.key === "Enter") void enter(false, true);
                    }}
                  />
                  <button
                    type="button"
                    className="button ink"
                    disabled={loading}
                    onClick={() => void enter(false, true)}
                  >
                    {t("Rejoindre", "Join")}
                    <Icon name="arrow" size={18} />
                  </button>
                </div>
              </div>
              {formError && (
                <p className="error-message" role="alert">
                  {formError}
                </p>
              )}
              <RoomSettings config={config} onChange={setConfig} />
            </div>
          </div>
          <div className="welcome-world">
            <div className="welcome-board-preview">
              <SceneBoundary
                fallback={<BoardFallback state={null} onSelect={setSelected} />}
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
                    selected={null}
                    onSelect={setSelected}
                    preview
                  />
                </Suspense>
              </SceneBoundary>
            </div>
            <div className="welcome-quick-settings">
              <span className="welcome-setup-title">
                {t("Réglages rapides", "Quick settings")}
              </span>
              <QuickSettings config={config} onChange={setConfig} />
            </div>
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
                "De 2 à 4 joueurs. Invitez vos amis avec ce code ou cliquez sur une place libre pour ajouter un bot.",
                "2 to 4 players. Invite friends using this code, or click an open seat to add a bot.",
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
              you={credentials.seat}
              host={host}
              disabled={blockActions}
              onAddBot={room.addBot}
              onRemoveBot={room.removeBot}
            />
            {host && (
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
                <button
                  type="button"
                  className="button primary welcome-play"
                  disabled={
                    blockActions ||
                    settingsDirty ||
                    seated < ECONOMY.minimumPlayers
                  }
                  onClick={() => room.start(false)}
                >
                  <Icon name="dice" />
                  {room.pending
                    ? t("Le plateau se prépare…", "Preparing board…")
                    : t("Démarrer la partie", "Start game")}
                  <Icon name="arrow" />
                </button>
              </>
            )}
            {!host && (
              <p className="waiting-host">
                <span className="spinner" />
                {t(
                  "En attente du démarrage par l’hôte.",
                  "Waiting for the host to start.",
                )}
              </p>
            )}
            <RoomSettings
              config={config}
              disabled={!host || blockActions}
              onChange={setConfig}
              save={
                host
                  ? {
                      dirty: settingsDirty,
                      onSave: () => room.settings(config),
                    }
                  : undefined
              }
            />
            {host && settingsDirty && (
              <p className="field-note settings-unsaved" role="status">
                {t(
                  "Enregistrez vos réglages ci-dessus avant de démarrer. Vos modifications restent un brouillon jusque-là.",
                  "Save your settings before starting. Changes remain a draft until saved.",
                )}
              </p>
            )}
          </div>
          <div className="room-preview">
            <SceneBoundary
              fallback={<BoardFallback state={null} onSelect={setSelected} />}
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
                  selected={null}
                  onSelect={setSelected}
                  preview
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
          copied={copied}
          copyRoom={copyRoom}
          onLeave={leave}
          onHelp={() => setHelpOpen(true)}
          onReplay={() => {
            leave();
            void enter(true);
          }}
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
            <button
              type="button"
              className="text-button"
              onClick={room.reconnect}
            >
              {t("Reconnecter", "Reconnect")}
            </button>
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
      <Help open={helpOpen} onClose={() => setHelpOpen(false)} />
      {!isGame && (
        <footer className="lobby-footer">
          <span>
            {t("2 à 4 joueurs · 32 cases", "2 to 4 players · 32 spaces")}
          </span>
          <span>{t("Aucun bonus payant", "No paid bonuses")}</span>
        </footer>
      )}
    </main>
  );
}
export default App;
