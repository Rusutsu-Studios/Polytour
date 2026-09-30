import {
  AnimatePresence,
  animate,
  motion,
  useReducedMotion,
} from "motion/react";
import type { CSSProperties, ErrorInfo, ReactNode } from "react";
import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { BOARD, ECONOMY } from "../shared/board/index.js";
import type {
  Action,
  GameEvent,
  PublicState,
  Seat,
} from "../shared/engine/index.js";
import {
  actionCost,
  getProperty,
  legalActions,
  netWorth,
  propertyRent,
} from "../shared/engine/index.js";
import type {
  RandomnessStatus,
  RoomConfig,
  RoomCredentials,
} from "../shared/protocol/index.js";
import { RoomConfigSchema } from "../shared/protocol/index.js";
import { director, useDirector } from "./director/director.js";
import {
  enterRoom,
  forgetCredentials,
  readCredentials,
  useRoom,
} from "./net/room.js";
import {
  LEVEL_NAMES,
  money,
  PLAYER_COLORS,
  PLAYER_LABELS,
  PLAYER_SYMBOLS,
  TILE_ICONS,
  TILE_NAMES,
  tileColor,
  tilePrice,
} from "./ui/board-display.js";
import Icon from "./ui/Icon.js";
import "./App.css";

const BoardScene = lazy(() => import("./scene/BoardScene.js"));
const DEFAULT_CONFIG = RoomConfigSchema.parse({});
const CARD_NAMES: Record<string, string> = {
  "Grand Tour": "Grand tour",
  Stranded: "Naufrage",
  "Jet Set": "Jet-set",
  "Stadium Call": "À vous le festival",
  Windfall: "Bonne fortune",
  "Parking Fine": "Stationnement",
  Birthday: "Anniversaire",
  Audit: "Contrôle fiscal",
  "Guardian Angel": "Ange gardien",
  Coupon: "Bon de réduction",
  Earthquake: "Tremblement de terre",
  "Land Swap": "Échange de terrain",
  Detour: "Détour",
  Contractor: "Coup de pouce",
  Jailbreak: "Liberté",
  Charity: "Solidarité",
};

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
  return <>{money(display)}</>;
}

function RoomSettings({
  config,
  onChange,
  disabled = false,
  save,
}: {
  config: RoomConfig;
  onChange: (config: RoomConfig) => void;
  disabled?: boolean;
  save?: { dirty: boolean; onSave: () => void };
}) {
  const toggles = [
    ["lineMonopoly", "Victoire par ligne complète"],
    ["tripleMonopoly", "Victoire par trois collections"],
    ["hotelsDirectly", "Hôtels directement achetables"],
    ["extraRollOnDouble", "Rejouer après un double"],
    ["botCanBuild", "Les bots peuvent construire"],
    ["giftCanBankrupt", "Les cadeaux peuvent causer une faillite"],
  ] as const;
  return (
    <details className="settings-disclosure">
      <summary>
        Réglages de la partie <span>Personnaliser</span>
      </summary>
      <div className="settings-fields">
        <label>
          Capital de départ{" "}
          <span className="amount-caption">{money(config.startingCash)}</span>
          <input
            type="number"
            min={0}
            max={10_000_000}
            step={10_000}
            value={config.startingCash}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...config,
                startingCash: Math.max(
                  0,
                  Math.min(10_000_000, Math.round(Number(event.target.value))),
                ),
              })
            }
          />
        </label>
        <label>
          Salaire au départ{" "}
          <span className="amount-caption">{money(config.startSalary)}</span>
          <input
            type="number"
            min={0}
            max={1_000_000}
            step={10_000}
            value={config.startSalary}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...config,
                startSalary: Math.max(
                  0,
                  Math.min(1_000_000, Math.round(Number(event.target.value))),
                ),
              })
            }
          />
        </label>
        <label>
          Durée de partie
          <select
            value={config.timeLimitMinutes}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...config,
                timeLimitMinutes: Number(event.target.value) as 20 | 60 | 120,
              })
            }
          >
            {[20, 60, 120].map((value) => (
              <option key={value} value={value}>
                {value} minutes
              </option>
            ))}
          </select>
        </label>
        <label>
          Festivals initiaux
          <input
            type="number"
            min={0}
            max={20}
            step={1}
            value={config.festivalCount}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...config,
                festivalCount: Math.max(
                  0,
                  Math.min(20, Math.round(Number(event.target.value))),
                ),
              })
            }
          />
        </label>
        <label>
          Temps de décision
          <select
            value={config.decisionSeconds}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...config,
                decisionSeconds: Number(event.target.value),
              })
            }
          >
            {[15, 30, 45, 60].map((value) => (
              <option key={value} value={value}>
                {value} secondes
              </option>
            ))}
          </select>
        </label>
        <label>
          Lancers de dés
          <select
            value={config.randomnessMode}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...config,
                randomnessMode: event.target
                  .value as RoomConfig["randomnessMode"],
              })
            }
          >
            <option value="drand">Vérifiables · drand</option>
            <option value="secure">Rapides · crypto serveur</option>
          </select>
        </label>
        {toggles.map(([key, label]) => (
          <label className="checkbox-label wide-field" key={key}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={config[key]}
              onChange={(event) =>
                onChange({ ...config, [key]: event.target.checked })
              }
            />
            {label}
          </label>
        ))}
        <p className="field-note wide-field">
          drand fixe un signal public futur pour chaque lancer et attend sa
          signature vérifiée. Les valeurs de départ suivent les réglages fournis
          ; les loyers et effets restent une première économie à ajuster.
        </p>
        {save && (
          <button
            type="button"
            className="button ink wide-field"
            disabled={disabled || !save.dirty}
            onClick={save.onSave}
          >
            {save.dirty ? "Enregistrer les réglages" : "Réglages enregistrés"}
          </button>
        )}
      </div>
    </details>
  );
}

function BoardFallback({
  state,
  onSelect,
}: {
  state: PublicState | null;
  onSelect: (tile: number) => void;
}) {
  return (
    <section className="flat-board" aria-label="Plateau accessible">
      <p className="flat-board-note">Vue légère du plateau</p>
      {BOARD.map((tile) => (
        <button
          type="button"
          key={tile.index}
          style={{ "--tile-color": tileColor(tile.index) } as CSSProperties}
          onClick={() => onSelect(tile.index)}
        >
          <span>{TILE_NAMES[tile.index]}</span>
          <b>
            {state && getProperty(state, tile.index)?.owner != null
              ? PLAYER_SYMBOLS[getProperty(state, tile.index)?.owner ?? 0]
              : tilePrice(tile.index) != null
                ? money(tilePrice(tile.index) ?? 0)
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
        "Un joueur")
      : "";
  switch (event.type) {
    case "DiceRolled":
      return `${name} lance ${event.dice[0]} + ${event.dice[1]}${event.isDouble ? " · double !" : ""}`;
    case "PropertyBought":
      return `${name} achète ${TILE_NAMES[event.tile]} · ${money(event.amount)}`;
    case "PropertyUpgraded":
      return `${name} construit à ${TILE_NAMES[event.tile]} · ${LEVEL_NAMES[event.level]}`;
    case "BoughtOut":
      return `${name} rachète ${TILE_NAMES[event.tile]} · ${money(event.amount)}`;
    case "PropertySold":
      return `${name} vend ${TILE_NAMES[event.tile]} · ${money(event.amount)}`;
    case "RentPaid":
      return `${name} paie ${money(event.amount)} à ${state.players.find((player) => player.seat === event.owner)?.name}`;
    case "SalaryPaid":
      return `${name} reçoit ${money(event.amount)} au départ`;
    case "CardDrawn":
      return `${name} tire « ${CARD_NAMES[event.card] ?? event.card} »`;
    case "CardUsed":
      return `${name} joue « ${CARD_NAMES[event.card] ?? event.card} »`;
    case "PlayerBankrupt":
      return `${name} fait faillite`;
    case "SentToIsland":
      return `${name} séjourne sur l’île`;
    case "LeftIsland":
      return `${name} quitte l’île`;
    case "ChampionshipChanged":
      return event.host
        ? `Festival à ${TILE_NAMES[event.host.tile]} · loyers ×${event.host.multiplier}`
        : null;
    case "MoneyTransferred":
      return `${event.from === null ? "La banque" : state.players.find((player) => player.seat === event.from)?.name} verse ${money(event.amount)} à ${event.to === null ? "la banque" : state.players.find((player) => player.seat === event.to)?.name}`;
    case "GameOver":
      return `${state.players.find((player) => player.seat === event.winner)?.name} remporte la partie`;
    default:
      return null;
  }
}
const DECISIONS: Record<
  NonNullable<PublicState["pending"]>["kind"],
  { title: string; text: string }
> = {
  roll: {
    title: "À vous de jouer !",
    text: "Lancez les dés et voyez où le voyage vous mène.",
  },
  buy: {
    title: "Une nouvelle adresse ?",
    text: "Achetez le terrain ou arrivez directement avec un bâtiment.",
  },
  build: {
    title: "Votre ville grandit",
    text: "Développez cette adresse pour augmenter ses loyers.",
  },
  buyout: {
    title: "Changez les règles du jeu",
    text: "Rachetez cette propriété à son propriétaire, ou poursuivez le voyage.",
  },
  island: {
    title: "Une pause sur l’île",
    text: "Tentez un double pour repartir, ou payez votre traversée.",
  },
  travel: {
    title: "Le monde vous attend",
    text: "Choisissez votre prochaine destination sur le plateau.",
  },
  host: {
    title: "Faites venir le festival",
    text: "Choisissez une de vos villes. Son loyer sera multiplié.",
  },
  "card-target": {
    title: "À vous de choisir",
    text: "Sélectionnez la ville qui recevra l’effet de votre carte.",
  },
  "rent-card": {
    title: "Une carte dans votre manche",
    text: "Utilisez une protection ou réglez le loyer.",
  },
  sell: {
    title: "Retrouvez de la trésorerie",
    text: "Vendez une propriété pour couvrir votre dette.",
  },
};
function actionLabel(action: Action, state: PublicState) {
  switch (action.type) {
    case "Roll":
      return "Lancer les dés";
    case "Decline":
      return state.pending?.kind === "rent-card"
        ? "Payer le loyer"
        : state.pending?.kind === "sell"
          ? "Déclarer faillite"
          : "Passer";
    case "PayIsland":
      return `Quitter l’île · ${money(ECONOMY.islandReleaseFee)}`;
    case "Buy":
      return `${LEVEL_NAMES[action.level]} · ${money(actionCost(state, action))}`;
    case "Build":
      return `${LEVEL_NAMES[action.level]} · ${money(actionCost(state, action))}`;
    case "Buyout":
      return `Racheter · ${state.pending?.kind === "buyout" ? money(state.pending.price) : ""}`;
    case "Travel":
      return "Voyager ici";
    case "ChooseHost":
      return "Accueillir le festival";
    case "ChooseTarget":
      return "Choisir cette ville";
    case "Sell":
      return "Vendre cette propriété";
    case "UseRentCard":
      return CARD_NAMES[action.card] ?? action.card;
  }
}

function DecisionPanel({
  state,
  seat,
  act,
  blocked,
  randomness,
  selected,
  onSelect,
}: {
  state: PublicState;
  seat: Seat;
  act: (action: Action) => void;
  blocked: boolean;
  randomness: RandomnessStatus | null;
  selected: number | null;
  onSelect: (tile: number) => void;
}) {
  const { busy } = useDirector();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const pending = state.pending;
  const decisionSeat = pending?.seat ?? state.activeSeat;
  const ownTurn =
    decisionSeat === seat &&
    !state.players.find((player) => player.seat === seat)?.bankrupt;
  const active = state.players.find((player) => player.seat === decisionSeat);
  const rngBusy = randomness != null && randomness.status !== "resolved";
  const actions = ownTurn ? legalActions(state, seat) : [];
  const destinations = actions.filter(
    (action): action is Extract<Action, { tile: number }> => "tile" in action,
  );
  const destination =
    destinations.find((action) => action.tile === selected) ?? destinations[0];
  const others = actions.filter((action) => !("tile" in action));
  const countdown = pending
    ? Math.max(0, Math.ceil((pending.deadline - now) / 1000))
    : 0;
  const description = pending ? DECISIONS[pending.kind] : DECISIONS.roll;
  const decisionTile =
    pending && "tile" in pending ? pending.tile : destination?.tile;
  const decisionProperty =
    decisionTile !== undefined ? getProperty(state, decisionTile) : undefined;
  const decisionOwner =
    decisionProperty?.owner != null
      ? state.players.find((player) => player.seat === decisionProperty.owner)
      : undefined;
  const decisionRent =
    decisionProperty && decisionTile !== undefined
      ? propertyRent(state, decisionTile)
      : null;
  return (
    <section
      className={`decision-panel ${ownTurn ? "your-turn" : ""}`}
      aria-labelledby="decision-heading"
      aria-live="polite"
    >
      <div className="decision-kicker">
        <span
          className="player-symbol"
          style={{ color: PLAYER_COLORS[decisionSeat] }}
        >
          {PLAYER_SYMBOLS[decisionSeat]}
        </span>
        <span>
          {ownTurn
            ? pending?.kind === "sell"
              ? "Votre dette à régler"
              : "À vous de décider"
            : `Décision de ${active?.name ?? "…"}`}
        </span>
        {pending && !rngBusy && (
          <span
            className="decision-timer"
            role="timer"
            aria-label={`${countdown} secondes restantes`}
          >
            {countdown}s
          </span>
        )}
      </div>
      <h2 id="decision-heading">
        {busy
          ? "Le voyage continue…"
          : rngBusy
            ? randomness.status === "error"
              ? "Le signal se fait attendre"
              : "Les dés attendent leur signal"
            : ownTurn
              ? description.title
              : `${active?.name} joue`}
      </h2>
      <p>
        {busy
          ? "Le plateau vous montre les dernières actions."
          : rngBusy
            ? "Le tour drand est fixé. Le serveur attend sa publication puis vérifie sa signature."
            : ownTurn
              ? description.text
              : active?.control === "bot"
                ? "Votre adversaire réfléchit. Votre prochain tour arrive."
                : "Vous pouvez explorer les villes pendant son tour."}
      </p>
      {decisionTile !== undefined && !busy && !rngBusy && (
        <div className="decision-property">
          <strong>{TILE_NAMES[decisionTile]}</strong>
          <span>
            {decisionOwner
              ? `${PLAYER_SYMBOLS[decisionOwner.seat]} ${decisionOwner.name}`
              : "Ville disponible"}
            {decisionRent !== null ? ` · loyer ${money(decisionRent)}` : ""}
          </span>
        </div>
      )}
      {rngBusy && (
        <div className="rng-wait">
          <span className="spinner" />
          {randomness.commitment?.round
            ? `Signal drand #${randomness.commitment.round}`
            : "Réception du signal…"}
        </div>
      )}
      {ownTurn && !busy && !rngBusy && (
        <div className="decision-actions">
          {destinations.length > 0 && (
            <div className="destination-choice">
              <label htmlFor="destination">
                {pending?.kind === "sell"
                  ? "Propriété à vendre"
                  : "Destination"}
              </label>
              <select
                id="destination"
                value={destination?.tile}
                onChange={(event) => onSelect(Number(event.target.value))}
              >
                {destinations.map((action) => (
                  <option
                    key={`${action.type}-${action.tile}`}
                    value={action.tile}
                  >
                    {TILE_NAMES[action.tile]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button primary"
                disabled={blocked || !destination}
                onClick={() => {
                  if (destination) act(destination);
                }}
              >
                {destination ? actionLabel(destination, state) : "Choisir"}
                <Icon name="arrow" />
              </button>
            </div>
          )}
          {others.map((action, index) => (
            <button
              type="button"
              key={`${action.type}-${"level" in action ? action.level : index}`}
              className={`button ${action.type === "Decline" ? "quiet" : action.type === "Roll" || others.length < 3 ? "primary" : "secondary"} ${action.type === "Roll" ? "roll-button" : ""}`}
              disabled={blocked}
              onClick={() => act(action)}
            >
              {action.type === "Roll" && <Icon name="dice" size={24} />}
              {actionLabel(action, state)}
              {action.type === "Roll" && <Icon name="arrow" />}
            </button>
          ))}
          {!actions.length && (
            <p className="field-note">
              Les choix vont s’actualiser automatiquement.
            </p>
          )}
        </div>
      )}
      {state.lastRoll && (
        <div className="last-dice">
          <span>Dernier lancer</span>
          <b>{state.lastRoll.dice[0]}</b>
          <b>{state.lastRoll.dice[1]}</b>
          <span className="dice-total">
            = {state.lastRoll.dice[0] + state.lastRoll.dice[1]}
          </span>
        </div>
      )}
    </section>
  );
}

function TileInspector({
  state,
  selected,
  onSelect,
}: {
  state: PublicState;
  selected: number | null;
  onSelect: (tile: number) => void;
}) {
  const index =
    selected ??
    state.players.find((player) => player.seat === state.activeSeat)
      ?.position ??
    0;
  const tile = BOARD[index];
  const property = getProperty(state, index);
  const owner =
    property?.owner != null
      ? state.players.find((player) => player.seat === property.owner)
      : null;
  const rent = property ? propertyRent(state, index) : null;
  return (
    <section className="inspector" aria-labelledby="inspector-title">
      <div className="inspector-head">
        <span
          className="tile-icon"
          style={{ backgroundColor: tileColor(index) }}
        >
          {TILE_ICONS[tile.kind]}
        </span>
        <div>
          <span className="small-label">Case {index + 1} / 32</span>
          <h3 id="inspector-title">{TILE_NAMES[index]}</h3>
        </div>
      </div>
      <label className="sr-only" htmlFor="tile-inspection">
        Explorer une case
      </label>
      <select
        id="tile-inspection"
        className="tile-select"
        value={index}
        onChange={(event) => onSelect(Number(event.target.value))}
      >
        {BOARD.map((item) => (
          <option key={item.index} value={item.index}>
            {item.index + 1}. {TILE_NAMES[item.index]}
          </option>
        ))}
      </select>
      {property ? (
        <>
          <div className="ownership">
            {owner ? (
              <>
                <span style={{ color: PLAYER_COLORS[owner.seat] }}>
                  {PLAYER_SYMBOLS[owner.seat]}
                </span>{" "}
                {owner.name} · {LEVEL_NAMES[property.level]}
              </>
            ) : (
              "Disponible à l’achat"
            )}
          </div>
          <dl className="property-numbers">
            <div>
              <dt>Terrain</dt>
              <dd>{money(tilePrice(index) ?? 0)}</dd>
            </div>
            <div>
              <dt>{owner ? "Loyer actuel" : "Loyer terrain"}</dt>
              <dd>{money(rent ?? 0)}</dd>
            </div>
          </dl>
          {(state.championshipHost?.tile === index ||
            state.festivalTiles.includes(index)) && (
            <p className="festival-badge">
              ★ Festival · loyer ×
              {state.championshipHost?.tile === index
                ? state.championshipHost.multiplier
                : 2}
            </p>
          )}
        </>
      ) : (
        <p className="tile-rule">
          {tile.kind === "start"
            ? `Recevez ${money(state.config.startSalary)} en passant par le départ.`
            : tile.kind === "island"
              ? "Un double ou le paiement de la traversée vous permet de repartir."
              : tile.kind === "championship"
                ? "Installez un festival dans l’une de vos villes pour multiplier ses loyers."
                : tile.kind === "world-tour"
                  ? "Au prochain tour, choisissez une destination plutôt que de lancer les dés."
                  : tile.kind === "chance"
                    ? "Piochez une carte. Fortune, voyage ou surprise au programme."
                    : "La taxe est calculée selon votre fortune."}
        </p>
      )}
    </section>
  );
}

function RandomnessPanel({
  value,
  mode,
}: {
  value: RandomnessStatus | null;
  mode: RoomConfig["randomnessMode"];
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
  return (
    <details className="proof-panel">
      <summary>
        <span
          className={`proof-indicator ${proof?.verified ? "verified" : ""}`}
        />
        {proof?.verified
          ? "Dernier lancer vérifié"
          : mode === "drand"
            ? "Dés vérifiables · drand"
            : "Dés rapides · crypto"}
        <span>↗</span>
      </summary>
      <div className="proof-body">
        <p>
          {mode === "drand"
            ? "Un signal public futur est choisi avant de connaître son résultat. Le serveur vérifie sa signature, puis transforme les octets en deux dés sans biais de modulo."
            : "Les deux dés proviennent de nouveaux octets cryptographiques générés par le serveur pour chaque lancer."}
        </p>
        {commitment && (
          <dl>
            <div>
              <dt>Tour fixé</dt>
              <dd>{commitment.round ?? "Crypto serveur"}</dd>
            </div>
            <div>
              <dt>Contexte</dt>
              <dd className="proof-value">{commitment.context}</dd>
            </div>
          </dl>
        )}
        {proof && (
          <>
            <p className="proof-result">
              Dés : {proof.dice[0]} + {proof.dice[1]} ·{" "}
              {proof.verified
                ? "Signature vérifiée par le serveur"
                : "Source cryptographique serveur"}
            </p>
            {proof.randomness && (
              <label>
                Aléa public
                <input
                  readOnly
                  value={proof.randomness}
                  aria-label="Aléa public drand"
                />
              </label>
            )}
            {proof.signature && (
              <label>
                Signature
                <input
                  readOnly
                  value={proof.signature}
                  aria-label="Signature du signal drand"
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
              Copier la preuve <Icon name="copy" size={15} />
            </button>
            <button
              type="button"
              className="text-button proof-download"
              onClick={downloadProof}
            >
              Télécharger la preuve ↓
            </button>
          </>
        )}
        {!commitment && (
          <p className="field-note">
            La preuve apparaîtra après le premier lancer.
          </p>
        )}
        <a
          href="https://docs.drand.love/developer/clients/"
          target="_blank"
          rel="noreferrer"
        >
          Comprendre drand ↗
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
        <h2>Votre premier tour</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Fermer les règles"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <p>La fortune se construit une adresse après l’autre.</p>
      <ol className="rules-list">
        <li>
          <b>Lancez et voyagez</b>
          <span>
            Deux dés vous déplacent. Un double vous offre un nouveau lancer si
            cette option est activée ; trois doubles vous envoient sur l’île.
          </span>
        </li>
        <li>
          <b>Achetez et construisez</b>
          <span>
            Choisissez un terrain ou un bâtiment. Vos visiteurs paient le loyer
            ; les collections de villes et les festivals l’augmentent.
          </span>
        </li>
        <li>
          <b>Gardez une réserve</b>
          <span>
            Un rachat peut renverser la partie. Vendez des propriétés si vous
            devez payer plus que votre trésorerie.
          </span>
        </li>
        <li>
          <b>Visez la victoire</b>
          <span>
            Dernier joueur debout, trois collections complètes, une ligne
            complète ou les quatre stations : plusieurs routes mènent à la
            victoire selon les réglages. À la fin du temps, la fortune totale
            départage les joueurs.
          </span>
        </li>
      </ol>
      <p className="field-note">
        Tous les joueurs ont les mêmes règles. Aucun bonus payant. Les valeurs
        de départ sont celles fournies ; cette première version conserve une
        économie de loyers à ajuster.
      </p>
      <button type="button" className="button primary" onClick={onClose}>
        C’est parti <Icon name="arrow" />
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
      title="Temps de partie restant"
    >
      {text}
    </time>
  );
}

function App() {
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
  const [formError, setFormError] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [fillBots, setFillBots] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const { serverState, viewState, busy, speed, history } = useDirector();
  const room = useRoom(credentials);
  const reducedMotion = useReducedMotion();
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
  useEffect(() => {
    if (activePosition !== undefined) setSelected(activePosition);
  }, [activePosition]);
  async function enter(solo: boolean, join = false) {
    const cleanName = name.trim();
    const code = joinCode.trim().toUpperCase();
    if (!cleanName) {
      setFormError("Choisissez un nom pour prendre place sur le plateau.");
      document.getElementById("player-name")?.focus();
      return;
    }
    if (join && !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) {
      setFormError("Le code de salle contient six lettres ou chiffres.");
      return;
    }
    setLoading(true);
    setFormError(null);
    try {
      const entered = await enterRoom(
        cleanName,
        config,
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
          : "Impossible d’ouvrir la partie. Réessayez.",
      );
    } finally {
      setLoading(false);
    }
  }
  function leave() {
    forgetCredentials();
    setCredentials(null);
    setAutoStart(false);
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
  return (
    <main className={isGame ? "game-shell" : "lobby-shell"}>
      <header className="topbar">
        <span className="brand-button">
          <Logo small={Boolean(isGame)} />
        </span>
        <div className="topbar-right">
          <span className="prototype-tag">Premier voyage · prototype</span>
          <button
            type="button"
            className="text-button help-button"
            onClick={() => setHelpOpen(true)}
          >
            <Icon name="help" size={18} />
            <span>Comment jouer</span>
          </button>
          {credentials && (
            <button type="button" className="text-button" onClick={leave}>
              Quitter
            </button>
          )}
        </div>
      </header>
      {!credentials ? (
        <section className="welcome-grid">
          <div className="welcome-copy">
            <span className="travel-stamp">
              <Icon name="flag" size={17} /> 4 joueurs. Une grande aventure.
            </span>
            <h1>
              Le monde
              <br />
              est à vous<span className="title-period">.</span>
            </h1>
            <p className="welcome-intro">
              Achetez des villes, faites grandir votre empire et bousculez vos
              amis. Les dés décident. Vous faites le reste.
            </p>
            <div className="welcome-form">
              <label htmlFor="player-name">Votre nom de joueur</label>
              <input
                id="player-name"
                value={name}
                maxLength={24}
                autoComplete="nickname"
                placeholder="Comment vous appelle-t-on ?"
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
                {loading ? "Préparation du plateau…" : "Jouer avec 3 bots"}
                <Icon name="arrow" />
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={loading}
                onClick={() => void enter(false)}
              >
                <Icon name="people" />
                Créer une salle entre amis
              </button>
              <div className="join-form">
                <label htmlFor="room-code">Vous avez un code ?</label>
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
                    Rejoindre <Icon name="arrow" size={18} />
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
            <div className="fair-play">
              <Icon name="check" size={18} />
              <span>
                Aucun avantage payant.
                <br />
                <strong>Les mêmes chances pour tout le monde.</strong>
              </span>
            </div>
          </div>
          <div className="welcome-world">
            <div className="world-note">
              <span>
                Un petit monde.
                <br />
                <b>De grandes ambitions.</b>
              </span>
              <span className="note-arrow" aria-hidden="true">
                ↙
              </span>
            </div>
            <SceneBoundary
              fallback={<BoardFallback state={null} onSelect={setSelected} />}
            >
              <Suspense
                fallback={
                  <div className="scene-loading">
                    <span className="spinner" />
                    Construction de votre petit monde…
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
            <div className="world-caption">
              <span className="mini-pawn">●</span>
              <span className="mini-pawn blue">◆</span>
              <span className="mini-pawn purple">▲</span>
              <span className="mini-pawn green">■</span>
              <p>
                Un plateau 3D original.
                <br />
                <b>Une vraie partie dès maintenant.</b>
              </p>
            </div>
          </div>
        </section>
      ) : !game ? (
        <section className="room-lobby">
          <div className="room-lobby-main">
            <span className="travel-stamp">
              <Icon name="people" size={17} /> Le départ approche
            </span>
            <h1>
              Prenez place<span className="title-period">.</span>
            </h1>
            <p className="welcome-intro">
              Invitez vos amis avec ce code. Les places libres peuvent être
              confiées à des bots.
            </p>
            <div className="room-code-block">
              <div>
                <span>Code de la salle</span>
                <strong>{credentials.roomCode}</strong>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => void copyRoom()}
              >
                <Icon name={copied ? "check" : "copy"} />
                {copied ? "Lien copié" : "Copier l’invitation"}
              </button>
            </div>
            <div className="lobby-seats">
              {([0, 1, 2, 3] as const).map((seat) => {
                const player = room.lobby?.seats.find(
                  (item) => item.seat === seat,
                );
                return (
                  <div
                    key={seat}
                    className={`lobby-seat ${player?.control ? "filled" : "empty"}`}
                  >
                    <span
                      className="seat-symbol"
                      style={{ color: PLAYER_COLORS[seat] }}
                    >
                      {PLAYER_SYMBOLS[seat]}
                    </span>
                    <div>
                      <strong>
                        {player?.control
                          ? player.name
                          : `Place ${seat + 1} disponible`}
                      </strong>
                      <span>
                        {player?.control === "bot"
                          ? "Bot"
                          : player?.control === "human"
                            ? player.online
                              ? seat === credentials.seat
                                ? "Vous êtes prêt"
                                : "En ligne"
                              : "Connexion…"
                            : fillBots
                              ? "Un bot prendra place au départ"
                              : "En attente d’un ami"}
                      </span>
                    </div>
                    {seat === room.lobby?.hostSeat && (
                      <span className="host-label">Hôte</span>
                    )}
                  </div>
                );
              })}
            </div>
            {host && (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={fillBots}
                    onChange={(event) => setFillBots(event.target.checked)}
                  />
                  Compléter les places libres avec des bots
                </label>
                <button
                  type="button"
                  className="button primary welcome-play"
                  disabled={
                    blockActions ||
                    settingsDirty ||
                    (!fillBots &&
                      (room.lobby?.seats.filter((seat) => seat.control)
                        .length ?? 0) < 4)
                  }
                  onClick={() => room.start(fillBots)}
                >
                  <Icon name="dice" />
                  {room.pending
                    ? "Le plateau se prépare…"
                    : "Démarrer la partie"}
                  <Icon name="arrow" />
                </button>
              </>
            )}
            {!host && (
              <p className="waiting-host">
                <span className="spinner" />
                L’hôte prépare votre voyage.
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
                Enregistrez vos réglages ci-dessus avant de démarrer. Vos
                modifications restent un brouillon jusque-là.
              </p>
            )}
          </div>
          <div className="room-preview">
            <SceneBoundary
              fallback={<BoardFallback state={null} onSelect={setSelected} />}
            >
              <Suspense
                fallback={
                  <div className="scene-loading">Préparation du plateau…</div>
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
        <>
          <div className="match-bar">
            <div className="match-location">
              <span className="connection-dot" data-state={room.connection} />
              <span>
                {room.connection === "online"
                  ? "En ligne"
                  : room.connection === "offline"
                    ? "Hors ligne"
                    : "Reconnexion…"}
              </span>
              <span className="room-code-inline">
                Salle <b>{credentials.roomCode}</b>
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => void copyRoom()}
                aria-label={
                  copied ? "Invitation copiée" : "Copier l’invitation"
                }
              >
                <Icon name={copied ? "check" : "copy"} size={16} />
              </button>
            </div>
            <div className="match-round">
              Manche <b>{game.round}</b>
              <span>
                {" "}
                ·{" "}
                <MatchClock
                  deadline={game.matchDeadline}
                  finished={game.status === "finished"}
                />{" "}
                restant
              </span>
            </div>
            <div className="animation-controls">
              <label htmlFor="animation-speed">Vitesse</label>
              <select
                id="animation-speed"
                value={speed}
                onChange={(event) =>
                  director.setSpeed(Number(event.target.value) as 1 | 1.5 | 2)
                }
              >
                <option value={1}>1×</option>
                <option value={1.5}>1,5×</option>
                <option value={2}>2×</option>
              </select>
              <button
                type="button"
                className="text-button"
                disabled={!busy}
                onClick={director.skip}
              >
                Passer l’animation
              </button>
            </div>
          </div>
          <div className="player-roster">
            {game.players.map((player) => (
              <motion.article
                key={player.seat}
                layout={!reducedMotion}
                className={`player-card ${game.activeSeat === player.seat && game.status === "active" ? "active" : ""} ${player.bankrupt ? "bankrupt" : ""}`}
                style={
                  {
                    "--player-color": PLAYER_COLORS[player.seat],
                  } as CSSProperties
                }
              >
                <div className="player-avatar">
                  {PLAYER_SYMBOLS[player.seat]}
                </div>
                <div className="player-card-body">
                  <div className="player-name-row">
                    <strong>{player.name}</strong>
                    <span>
                      {player.seat === credentials.seat
                        ? "Vous"
                        : player.control === "bot"
                          ? "Bot"
                          : PLAYER_LABELS[player.seat]}
                    </span>
                  </div>
                  <div className="player-cash">
                    <MoneyCounter value={player.cash} />
                    <span className="coin-symbol">●</span>
                  </div>
                  <p>
                    {player.bankrupt
                      ? "Faillite"
                      : `${player.properties.length} adresse${player.properties.length > 1 ? "s" : ""}`}
                    <span>Fortune {money(netWorth(game, player.seat))}</span>
                  </p>
                </div>
                {game.activeSeat === player.seat &&
                  game.status === "active" && (
                    <span className="active-marker">À vous de jouer</span>
                  )}
              </motion.article>
            ))}
          </div>
          <div className="match-grid">
            <div className="board-stage">
              <div className="board-top-caption">
                <span>Le grand tour</span>
                <span>
                  {game.lastCard
                    ? `Carte : ${CARD_NAMES[game.lastCard.card] ?? game.lastCard.card}`
                    : "32 étapes. À vous de tracer votre route."}
                </span>
              </div>
              <SceneBoundary
                fallback={<BoardFallback state={game} onSelect={setSelected} />}
              >
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <span className="spinner" />
                      Le plateau prend place…
                    </div>
                  }
                >
                  <BoardScene
                    state={game}
                    selected={selected}
                    onSelect={setSelected}
                    zoom={zoom}
                  />
                </Suspense>
              </SceneBoundary>
              <div className="board-tools">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Dézoomer le plateau"
                  disabled={zoom <= 0.8}
                  onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))}
                >
                  −
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Recentrer le plateau"
                  onClick={() => setZoom(1)}
                >
                  ⌖
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Zoomer le plateau"
                  disabled={zoom >= 1.3}
                  onClick={() => setZoom((value) => Math.min(1.3, value + 0.1))}
                >
                  +
                </button>
              </div>
              {debug && (
                <div id="frame-monitor" className="frame-monitor">
                  Scène au repos · rendu à la demande
                </div>
              )}
              <div className="board-bottom-caption">
                <span className="table-stamp">POLYTOUR TRAVEL CLUB</span>
                <span>Cliquez une ville pour l’explorer</span>
              </div>
            </div>
            <aside className="game-sidebar">
              <AnimatePresence mode="wait">
                {game.status === "finished" && game.result && !busy ? (
                  <motion.section
                    key="finished"
                    className="end-panel"
                    initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 / speed }}
                  >
                    <span className="winner-trophy">
                      <Icon name="trophy" size={44} />
                    </span>
                    <p className="small-label">Le voyage est terminé</p>
                    <h2>
                      {
                        game.players.find(
                          (player) => player.seat === game.result?.winner,
                        )?.name
                      }{" "}
                      remporte la partie !
                    </h2>
                    <ol className="standings">
                      {game.result.standings.map((standing, index) => (
                        <li key={standing.seat}>
                          <span>{index + 1}</span>
                          <b>
                            {PLAYER_SYMBOLS[standing.seat]}{" "}
                            {
                              game.players.find(
                                (player) => player.seat === standing.seat,
                              )?.name
                            }
                          </b>
                          <strong>{money(standing.netWorth)}</strong>
                        </li>
                      ))}
                    </ol>
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => {
                        leave();
                        void enter(true);
                      }}
                    >
                      Rejouer avec des bots <Icon name="arrow" />
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={leave}
                    >
                      Nouvelle salle entre amis
                    </button>
                    <p className="field-note">
                      Le journal ci-dessous retrace votre partie.
                    </p>
                  </motion.section>
                ) : (
                  <motion.div
                    key="decision"
                    initial={false}
                    animate={{ opacity: 1 }}
                  >
                    <DecisionPanel
                      state={serverState ?? game}
                      seat={credentials.seat}
                      act={room.act}
                      blocked={blockActions}
                      randomness={room.randomness}
                      selected={selected}
                      onSelect={setSelected}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <TileInspector
                state={game}
                selected={selected}
                onSelect={setSelected}
              />
              <RandomnessPanel
                value={room.randomness}
                mode={config.randomnessMode}
              />
            </aside>
          </div>
          <section className="journal" aria-labelledby="journal-title">
            <div className="journal-title">
              <h3 id="journal-title">Carnet de voyage</h3>
              <span>
                {game.players.find((player) => player.seat === credentials.seat)
                  ?.heldCards.length
                  ? `Vos cartes : ${game.players
                      .find((player) => player.seat === credentials.seat)
                      ?.heldCards.map((card) => CARD_NAMES[card])
                      .join(" · ")}`
                  : "Le fil de votre partie"}
              </span>
            </div>
            <ol>
              {history
                .map((event, index) => ({
                  text: eventText(event, game),
                  key: index,
                }))
                .filter((item) => item.text)
                .slice(-8)
                .reverse()
                .map((item) => (
                  <li key={item.key}>{item.text}</li>
                ))}
            </ol>
            {!history.some((event) => eventText(event, game)) && (
              <p>Votre aventure commence ici. Lancez les dés !</p>
            )}
          </section>
        </>
      )}
      {credentials && !game && (
        <div className="lobby-connection" role="status">
          <span className="connection-dot" data-state={room.connection} />
          {room.connection === "online"
            ? "Salle connectée"
            : "Connexion à votre salle…"}
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
              Reconnecter
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Fermer le message"
            onClick={room.clearError}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      <Help open={helpOpen} onClose={() => setHelpOpen(false)} />
      {!isGame && (
        <footer className="lobby-footer">
          <span>Une vraie partie, des règles communes.</span>
          <span>Sans achat. Sans avantage. Bon voyage.</span>
        </footer>
      )}
    </main>
  );
}
export default App;
