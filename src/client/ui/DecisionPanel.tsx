import { motion } from "motion/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BOARD } from "../../shared/board/index.js";
import type { BuildLevel } from "../../shared/board/types.js";
import {
  type Action,
  actionCost,
  getProperty,
  legalActions,
  maxBuildLevel,
  type PublicState,
  previewPropertyRent,
  propertyRefund,
  propertyRent,
  rentCardPayment,
  type Seat,
} from "../../shared/engine/index.js";
import type { RandomnessStatus } from "../../shared/protocol/index.js";
import { useDirector } from "../director/director.js";
import {
  LEVEL_NAMES,
  money,
  PLAYER_COLORS,
  PLAYER_SYMBOLS,
  TILE_NAMES,
} from "./board-display.js";
import { CARD_NAMES } from "./chance-display.js";
import Icon from "./Icon.js";
import "./DecisionPanel.css";

export type DecisionPanelProps = {
  state: PublicState;
  seat: Seat;
  act: (action: Action) => void;
  blocked: boolean;
  randomness: RandomnessStatus | null;
  selected: number | null;
  onSelect: (tile: number) => void;
};
type ConstructionAction = Extract<Action, { type: "Buy" | "Build" }>;
type DestinationAction = Extract<Action, { tile: number }>;
const COPY = {
  roll: [
    "À vous de jouer !",
    "Lancez les dés et voyez où le voyage vous mène.",
  ],
  buy: [
    "Une nouvelle adresse",
    "Choisissez votre construction, puis confirmez l’achat.",
  ],
  build: [
    "Votre ville grandit",
    "Comparez les travaux et le nouveau loyer, puis confirmez.",
  ],
  buyout: [
    "À vous de reprendre la ville",
    "Cette propriété peut changer de mains. À vous de décider.",
  ],
  sell: [
    "Une dette à régler",
    "Choisissez une propriété à vendre pour retrouver de la trésorerie.",
  ],
  island: [
    "Une pause sur l’île",
    "Tentez un double pour repartir, ou payez votre traversée.",
  ],
  travel: [
    "Le monde vous attend",
    "Choisissez votre prochaine destination sur le plateau.",
  ],
  host: [
    "Votre ville en fête",
    "Choisissez la ville qui accueillera le festival.",
  ],
  "card-target": [
    "À vous de choisir",
    "Choisissez la ville qui recevra l’effet de votre carte.",
  ],
  "rent-card": [
    "Une carte dans votre manche",
    "Utilisez votre protection ou réglez le loyer.",
  ],
} as const;
function actionKey(action: Action): string {
  return `${action.type}:${"level" in action ? action.level : "tile" in action ? action.tile : "card" in action ? action.card : ""}`;
}
function actionLabel(action: Action, state: PublicState): string {
  switch (action.type) {
    case "Buy":
    case "Build":
      return `${LEVEL_NAMES[action.level]} · ${money(actionCost(state, action))}`;
    case "Roll":
      return "Lancer les dés";
    case "PayIsland":
      return `Payer la traversée · ${money(actionCost(state, action))}`;
    case "Buyout":
      return `Racheter · ${money(actionCost(state, action))}`;
    case "Travel":
      return "Voyager ici";
    case "ChooseHost":
      return "Accueillir le festival";
    case "ChooseTarget":
      if (state.pending?.kind === "card-target") {
        const pending = state.pending;
        if (pending.card === "Land Swap" && pending.sourceTile !== undefined)
          return `Échanger ${TILE_NAMES[pending.sourceTile]} contre ${TILE_NAMES[action.tile]}`;
        if (pending.card === "Contractor")
          return `Offrir un niveau à ${TILE_NAMES[action.tile]}`;
        if (pending.card === "Earthquake")
          return `Retirer un niveau à ${TILE_NAMES[action.tile]}`;
      }
      return "Choisir cette ville";
    case "Sell":
      return "Vendre cette propriété";
    case "UseRentCard":
      return CARD_NAMES[action.card];
    case "Decline":
      return state.pending?.kind === "sell"
        ? "Déclarer faillite"
        : state.pending?.kind === "rent-card"
          ? `Payer le loyer · ${money(rentCardPayment(state.pending.amount, null))}`
          : "Passer";
  }
}
function confirmLabel(action: Action, state: PublicState): string {
  switch (action.type) {
    case "Buy":
      return `Acheter · ${money(actionCost(state, action))}`;
    case "Build":
      return `Construire · ${money(actionCost(state, action))}`;
    case "Buyout":
      return `Confirmer le rachat · ${money(actionCost(state, action))}`;
    case "Sell":
      return `Vendre · ${money(propertyRefund(state, action.tile))}`;
    case "Travel":
      return `Voyager ici · ${money(actionCost(state, action))}`;
    case "Decline":
      return "Confirmer la faillite";
    default:
      return actionLabel(action, state);
  }
}

function IsoBuilding({
  x,
  y,
  scale = 1,
  color,
  tower = false,
  landmark = false,
}: {
  x: number;
  y: number;
  scale?: number;
  color: string;
  tower?: boolean;
  landmark?: boolean;
}) {
  const height = tower ? 78 : 42;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <polygon
        points={`0,40 42,64 42,${64 + height} 0,${40 + height}`}
        fill="#fffaf0"
      />
      <polygon
        points={`42,64 84,40 84,${40 + height} 42,${64 + height}`}
        fill="#d6dfd4"
      />
      {tower ? (
        <>
          <polygon points="-4,39 42,12 88,39 42,66" fill={color} />
          <polygon
            points="42,66 88,39 88,45 42,72"
            fill="#173b45"
            opacity=".17"
          />
          <polygon
            points="12,37 42,20 73,37 42,55"
            fill="#fffaf0"
            opacity=".38"
          />
        </>
      ) : (
        <>
          <polygon points="-6,41 36,1 91,31 45,70" fill={color} />
          <polygon
            points="45,70 91,31 88,44 45,78"
            fill="#173b45"
            opacity=".2"
          />
          <polygon
            points="-6,41 36,1 36,12 0,47"
            fill="#fffaf0"
            opacity=".15"
          />
        </>
      )}
      {(tower ? [0, 1, 2] : [0]).map((row) => (
        <g key={row} transform={`translate(0 ${row * 18})`}>
          <polygon points="8,55 18,61 18,71 8,65" fill="#2f8296" />
          <polygon points="26,65 36,71 36,81 26,75" fill="#2f8296" />
          <polygon points="51,72 62,66 62,76 51,82" fill="#285d6c" />
          <polygon points="69,61 79,55 79,65 69,71" fill="#285d6c" />
        </g>
      ))}
      <polygon
        points={`27,${47 + height} 37,${53 + height} 37,${64 + height} 27,${58 + height}`}
        fill="#225567"
      />
      <polygon
        points={`-3,${40 + height} 42,${66 + height} 87,${40 + height} 87,${47 + height} 42,${74 + height} -3,${47 + height}`}
        fill="#c4cfb9"
      />
      {landmark && (
        <>
          <polygon points="30,25 42,-34 56,26 43,36" fill="#ffcb55" />
          <polygon points="42,-34 56,26 43,36" fill="#cf9227" />
          <path d="M42-35v-17" stroke="#173b45" strokeWidth="2" />
          <path d="M43-52h17l-4 5 4 5H43" fill={color} />
        </>
      )}
    </g>
  );
}

// Original vector toy geometry, matching the game's isometric board materials.
function CityIllustration({
  level,
  color,
  resort = false,
  symbol,
}: {
  level: BuildLevel;
  color: string;
  resort?: boolean;
  symbol?: string;
}) {
  return (
    <svg
      className="decision-city-art"
      viewBox="0 0 340 245"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse
        cx="171"
        cy="211"
        rx="137"
        ry="17"
        fill="#173b45"
        opacity=".10"
      />
      <polygon points="24,145 170,75 316,145 170,222" fill="#d2d8bd" />
      <polygon points="24,145 170,213 170,228 24,160" fill="#b8c497" />
      <polygon points="170,213 316,145 316,160 170,228" fill="#91a475" />
      <polygon
        points="32,144 170,82 308,144 170,208"
        fill={resort ? "#a3decc" : "#b5cd70"}
      />
      <path
        d="m74 143 98 46 97-46"
        stroke="#eaf0c3"
        strokeWidth="8"
        fill="none"
      />
      <path
        d="m86 125 86 41 75-36"
        stroke="#eaf0c3"
        strokeWidth="5"
        fill="none"
      />
      {resort ? (
        <>
          <ellipse cx="190" cy="168" rx="45" ry="18" fill="#63bdcf" />
          <ellipse cx="188" cy="166" rx="35" ry="12" fill="#9fe2e2" />
          <IsoBuilding x={86} y={83} scale={0.7} color={color} />
          <path d="M232 153v-46" stroke="#a48048" strokeWidth="5" />
          <path d="m231 108-35-14 26-2 7-29 13 27 27 3-36 15" fill="#478b50" />
          <path d="M206 156v-31" stroke="#906430" strokeWidth="3" />
          <path d="m183 130 22-20 24 20Z" fill={color} />
        </>
      ) : level === 0 ? (
        <>
          <polygon points="111,143 169,116 226,143 169,170" fill="#90b64c" />
          <path
            d="m111 143 58-27 57 27-57 27Z"
            fill="none"
            stroke="#f5edcc"
            strokeWidth="3"
            strokeDasharray="6 5"
          />
        </>
      ) : level === 1 ? (
        <IsoBuilding x={126} y={58} color={color} />
      ) : level === 2 ? (
        <>
          <IsoBuilding x={95} y={66} scale={0.83} color={color} />
          <IsoBuilding x={171} y={90} scale={0.73} color={color} />
        </>
      ) : level === 3 ? (
        <>
          <IsoBuilding x={157} y={44} scale={0.7} color={color} />
          <IsoBuilding x={82} y={78} scale={0.7} color={color} />
          <IsoBuilding x={162} y={109} scale={0.7} color={color} />
        </>
      ) : (
        <IsoBuilding
          x={128}
          y={29}
          scale={0.98}
          color={color}
          tower
          landmark={level === 5}
        />
      )}
      <path d="M69 159v-32" stroke="#526c46" strokeWidth="5" />
      <path d="m68 106 17 26-17 9-17-9Z" fill="#64974e" />
      <path d="m68 106 17 26-17 9Z" fill="#4c7d42" />
      <ellipse cx="260" cy="157" rx="13" ry="5" fill="#708c50" />
      <path d="M260 155v-30" stroke="#9a7745" strokeWidth="3" />
      <path d="m260 126-22-8 16-4 5-20 9 19 19 4-26 9" fill="#679b4e" />
      {symbol && (
        <g transform="translate(246 179)">
          <path d="M0 0v-38" stroke="#526b50" strokeWidth="2" />
          <path d="M1-38h27l-5 9 5 9H1Z" fill={color} />
          <text
            x="12"
            y="-25"
            textAnchor="middle"
            fontSize="11"
            fill="#fffaf0"
            fontWeight="700"
          >
            {symbol}
          </text>
        </g>
      )}
    </svg>
  );
}

export default function DecisionPanel({
  state,
  seat,
  act,
  blocked,
  randomness,
  selected,
  onSelect,
}: DecisionPanelProps) {
  const { busy, reducedMotion, speed } = useDirector();
  const [now, setNow] = useState(Date.now());
  const [selection, setSelection] = useState<{
    decision: string;
    action: string;
  } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pending = state.pending;
  const decisionSeat = pending?.seat ?? state.activeSeat;
  const active = state.players.find((player) => player.seat === decisionSeat);
  const ownTurn =
    decisionSeat === seat && !active?.bankrupt && state.status === "active";
  const rngBusy = randomness !== null && randomness.status !== "resolved";
  const decisionKey = `${pending?.kind ?? "roll"}:${decisionSeat}:${pending?.deadline ?? 0}:${pending && "tile" in pending ? pending.tile : ""}`;
  const actions = ownTurn ? legalActions(state, seat) : [];
  const constructions = actions.filter(
    (action): action is ConstructionAction =>
      action.type === "Buy" || action.type === "Build",
  );
  const destinations = actions.filter(
    (action): action is DestinationAction => "tile" in action,
  );
  const freeRoll = actions.find((action) => action.type === "Roll");
  const destinationChoice =
    destinations.find((action) => action.tile === selected) ?? destinations[0];
  const choices = constructions.length
    ? constructions
    : destinations.length
      ? destinations
      : actions.filter((action) => action.type !== "Decline");
  const fallbackChoice =
    pending?.kind === "travel" && freeRoll
      ? freeRoll
      : (destinationChoice ?? choices[0]);
  const selectedAction =
    selection?.decision === decisionKey
      ? (actions.find((action) => actionKey(action) === selection.action) ??
        fallbackChoice)
      : fallbackChoice;
  const decline = actions.find((action) => action.type === "Decline");
  const decisionTile =
    pending && "tile" in pending
      ? pending.tile
      : selectedAction && "tile" in selectedAction
        ? selectedAction.tile
        : undefined;
  const property =
    decisionTile !== undefined ? getProperty(state, decisionTile) : undefined;
  const resort =
    decisionTile !== undefined && BOARD[decisionTile].kind === "resort";
  const owner =
    property?.owner != null
      ? state.players.find((player) => player.seat === property.owner)
      : undefined;
  const construction = pending?.kind === "buy" || pending?.kind === "build";
  const selectedLevel =
    selectedAction && "level" in selectedAction
      ? selectedAction.level
      : (property?.level ?? 0);
  const rent =
    decisionTile === undefined
      ? null
      : construction || selectedAction?.type === "Buyout"
        ? previewPropertyRent(state, decisionTile, seat, selectedLevel)
        : propertyRent(state, decisionTile);
  const cost = selectedAction
    ? pending?.kind === "rent-card"
      ? rentCardPayment(
          pending.amount,
          selectedAction.type === "UseRentCard" ? selectedAction.card : null,
        )
      : actionCost(state, selectedAction)
    : 0;
  const refund =
    selectedAction?.type === "Sell"
      ? propertyRefund(state, selectedAction.tile)
      : null;
  const projectedCash =
    active &&
    selectedAction &&
    (["Buy", "Build", "Buyout", "PayIsland", "Travel", "Sell"].includes(
      selectedAction.type,
    ) ||
      pending?.kind === "rent-card")
      ? active.cash + (refund ?? -cost)
      : null;
  const constructionIndex = constructions.findIndex(
    (action) =>
      selectedAction && actionKey(action) === actionKey(selectedAction),
  );
  const hotelNote =
    construction &&
    !resort &&
    pending &&
    "maxLevel" in pending &&
    Math.min(
      pending.maxLevel,
      maxBuildLevel(state, seat, pending.tile, pending.kind === "buy"),
    ) < 4 &&
    !state.config.hotelsDirectly
      ? state.config.hotelPurchaseRule === "staged-hotels"
        ? "Hôtel : 3 maisons, un tour complet, puis revenir ici."
        : "L’hôtel se débloque après votre premier tour complet du plateau."
      : null;
  const modalOpen = Boolean(
    ownTurn &&
      pending &&
      pending.kind !== "roll" &&
      !busy &&
      !rngBusy &&
      dismissed !== decisionKey,
  );
  const countdown = pending
    ? Math.max(0, Math.ceil((pending.deadline - now) / 1000))
    : 0;
  const copy: readonly [string, string] =
    pending?.kind === "card-target"
      ? [
          CARD_NAMES[pending.card],
          pending.card === "Land Swap" && pending.sourceTile !== undefined
            ? `Votre ville de ${TILE_NAMES[pending.sourceTile]} sera échangée avec la ville choisie. Les constructions restent sur chaque propriété.`
            : pending.card === "Contractor"
              ? "Choisissez votre ville qui recevra un niveau de construction offert."
              : "Choisissez la ville adverse qui perdra un niveau de construction.",
        ]
      : pending?.kind === "buy" && resort
        ? [
            "Une escale au soleil",
            "Achetez cette station pour agrandir votre réseau balnéaire.",
          ]
        : COPY[pending?.kind ?? "roll"];
  const bankruptcy =
    selectedAction?.type === "Decline" && pending?.kind === "sell";
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!modalOpen) return;
    const dialog = dialogRef.current;
    if (!dialog || dialog.dataset.decision !== decisionKey) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    headingRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [modalOpen, decisionKey]);
  useEffect(() => {
    if (dismissed === decisionKey && !modalOpen) resumeRef.current?.focus();
  }, [dismissed, decisionKey, modalOpen]);
  function choose(action: Action) {
    setSelection({ decision: decisionKey, action: actionKey(action) });
    if ("tile" in action) onSelect(action.tile);
  }
  function dismiss() {
    setDismissed(decisionKey);
  }
  function confirm() {
    if (
      selectedAction &&
      !blocked &&
      actions.some((action) => actionKey(action) === actionKey(selectedAction))
    )
      act(selectedAction);
  }
  const kicker = (
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
  );

  if (!modalOpen)
    return (
      <section
        className="decision-panel decision-compact"
        data-kind={pending?.kind ?? "roll"}
        data-own={ownTurn}
        data-busy={busy || rngBusy}
        aria-labelledby="decision-heading"
      >
        {kicker}
        <h2 id="decision-heading">
          {busy
            ? "Le voyage continue…"
            : rngBusy
              ? randomness?.status === "error"
                ? "Le lancer se fait attendre"
                : "Les dés se préparent"
              : ownTurn
                ? copy[0]
                : `${active?.name ?? "Votre adversaire"} joue`}
        </h2>
        <p>
          {busy
            ? "Le plateau vous montre les dernières actions."
            : rngBusy
              ? randomness?.commitment?.mode === "drand"
                ? "Le serveur attend le signal drand annoncé et vérifie sa signature."
                : "Le serveur prépare votre lancer."
              : ownTurn
                ? copy[1]
                : "Vous pouvez explorer les villes pendant son tour."}
        </p>
        {rngBusy && (
          <div className="rng-wait" role="status">
            <span className="spinner" />
            {randomness?.commitment?.round
              ? `Signal drand #${randomness.commitment.round}`
              : "Tirage serveur…"}
          </div>
        )}
        {ownTurn && !busy && !rngBusy && (
          <div className="decision-actions">
            {pending && pending.kind !== "roll" ? (
              <button
                ref={resumeRef}
                type="button"
                className="button primary decision-resume"
                onClick={() => setDismissed(null)}
              >
                Reprendre le choix <Icon name="arrow" />
              </button>
            ) : (
              actions.map((action) => (
                <button
                  type="button"
                  key={actionKey(action)}
                  className="button primary roll-button"
                  disabled={blocked}
                  onClick={() => act(action)}
                >
                  <Icon name="dice" size={24} />
                  {actionLabel(action, state)}
                  <Icon name="arrow" />
                </button>
              ))
            )}
          </div>
        )}
      </section>
    );

  return createPortal(
    <dialog
      ref={dialogRef}
      className="decision-panel decision-popup"
      data-kind={pending?.kind}
      data-decision={decisionKey}
      data-own="true"
      data-busy={blocked}
      aria-labelledby="decision-heading"
      aria-describedby="decision-description"
      aria-busy={blocked}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
    >
      <div className="decision-popup-ribbon">
        <span>{copy[0]}</span>
      </div>
      <motion.div
        className="decision-popup-inner"
        initial={reducedMotion ? false : { opacity: 0.7, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reducedMotion ? 0 : 0.28 / speed,
          ease: "easeOut",
        }}
      >
        <div className="decision-popup-topline">
          {kicker}
          <button
            type="button"
            className="icon-button decision-minimize"
            aria-label="Réduire le choix"
            onClick={dismiss}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <h2 ref={headingRef} tabIndex={-1} id="decision-heading">
          {bankruptcy
            ? "Déclarer faillite ?"
            : decisionTile !== undefined
              ? TILE_NAMES[decisionTile]
              : copy[0]}
        </h2>
        <p id="decision-description">
          {bankruptcy
            ? "Cette décision est définitive. Vos propriétés seront remises à la banque."
            : copy[1]}
        </p>

        <div className="decision-popup-story">
          <div className="decision-illustration">
            <CityIllustration
              level={selectedLevel}
              color={PLAYER_COLORS[construction ? seat : (owner?.seat ?? seat)]}
              resort={resort}
              symbol={
                PLAYER_SYMBOLS[construction ? seat : (owner?.seat ?? seat)]
              }
            />
            <span className="decision-property">
              {owner ? (
                <>
                  <span style={{ color: PLAYER_COLORS[owner.seat] }}>
                    {PLAYER_SYMBOLS[owner.seat]}
                  </span>{" "}
                  {owner.name} · {LEVEL_NAMES[property?.level ?? 0]}
                </>
              ) : decisionTile !== undefined ? (
                "Cette adresse est disponible"
              ) : (
                "Votre prochaine étape"
              )}
            </span>
          </div>
          <div className="decision-preview">
            <span className="decision-preview-name">
              {bankruptcy
                ? "Fin de votre voyage"
                : selectedAction && "level" in selectedAction
                  ? resort
                    ? "Station balnéaire"
                    : LEVEL_NAMES[selectedAction.level]
                  : selectedAction
                    ? actionLabel(selectedAction, state)
                    : "Votre choix"}
            </span>
            <dl className="decision-ledger">
              {pending?.kind === "rent-card" ? (
                <>
                  <div>
                    <dt>Loyer avant protection</dt>
                    <dd>{money(pending.amount)}</dd>
                  </div>
                  <div className="ledger-main">
                    <dt>À payer</dt>
                    <dd>{money(cost)}</dd>
                  </div>
                </>
              ) : refund !== null ? (
                <div className="ledger-main">
                  <dt>Revente à la banque</dt>
                  <dd>+{money(refund)}</dd>
                </div>
              ) : selectedAction && cost > 0 ? (
                <div className="ledger-main">
                  <dt>
                    {pending?.kind === "buy"
                      ? "Prix total"
                      : pending?.kind === "build"
                        ? "Coût des travaux"
                        : "À payer"}
                  </dt>
                  <dd>{money(cost)}</dd>
                </div>
              ) : (
                <div className="ledger-main">
                  <dt>Votre argent</dt>
                  <dd>{money(active?.cash ?? 0)}</dd>
                </div>
              )}
              {rent !== null &&
                !bankruptcy &&
                pending?.kind !== "rent-card" && (
                  <div>
                    <dt>
                      {construction || pending?.kind === "buyout"
                        ? "Nouveau loyer"
                        : "Loyer actuel"}
                    </dt>
                    <dd>{money(rent)}</dd>
                  </div>
                )}
              {projectedCash !== null && !bankruptcy && (
                <div
                  className="ledger-balance"
                  data-negative={projectedCash < 0}
                >
                  <dt>
                    {refund !== null
                      ? "Disponible pour la dette"
                      : pending?.kind === "travel"
                        ? "Après frais de voyage"
                        : "Argent restant"}
                  </dt>
                  <dd>{money(projectedCash)}</dd>
                </div>
              )}
            </dl>
            {construction && (
              <p className="construction-guide">
                {resort
                  ? "Aucune construction. Le loyer augmente avec le nombre de stations que vous possédez."
                  : pending?.kind === "buy"
                    ? "Prix tout compris : terrain + constructions."
                    : `Déjà construit : ${LEVEL_NAMES[property?.level ?? 0]}. Vous payez seulement la différence.`}
              </p>
            )}
            {hotelNote && (
              <p className="hotel-note">
                <Icon name="help" size={16} />
                {hotelNote}
              </p>
            )}
          </div>
        </div>

        <div className="decision-actions">
          {constructions.length > 0 && !bankruptcy ? (
            <>
              <fieldset
                className="decision-construction-steps"
                style={{ "--steps": constructions.length } as CSSProperties}
                aria-label="Choisir une construction"
              >
                {constructions.map((action) => (
                  <button
                    type="button"
                    className="construction-choice"
                    key={actionKey(action)}
                    aria-pressed={
                      selectedAction &&
                      actionKey(selectedAction) === actionKey(action)
                    }
                    aria-label={`${actionLabel(action, state)} · loyer futur ${money(decisionTile !== undefined ? previewPropertyRent(state, decisionTile, seat, action.level) : 0)}`}
                    disabled={blocked}
                    onClick={() => choose(action)}
                  >
                    <CityIllustration
                      level={action.level}
                      color={PLAYER_COLORS[seat]}
                    />
                    <span className="construction-name">
                      {LEVEL_NAMES[action.level]}
                    </span>
                    <strong className="construction-cost">
                      {money(actionCost(state, action))}
                    </strong>
                    <span className="construction-rent">
                      Loyer{" "}
                      {money(
                        decisionTile !== undefined
                          ? previewPropertyRent(
                              state,
                              decisionTile,
                              seat,
                              action.level,
                            )
                          : 0,
                      )}
                    </span>
                    <span className="construction-selected" aria-hidden="true">
                      {selectedAction &&
                      actionKey(selectedAction) === actionKey(action) ? (
                        <Icon name="check" size={15} />
                      ) : null}
                    </span>
                  </button>
                ))}
              </fieldset>
              {constructions.length > 1 && (
                <label className="decision-level-slider">
                  <span>Glisser pour comparer</span>
                  <input
                    type="range"
                    aria-label="Niveau de construction"
                    aria-valuetext={
                      selectedAction ? actionLabel(selectedAction, state) : ""
                    }
                    min={0}
                    max={constructions.length - 1}
                    step={1}
                    value={Math.max(0, constructionIndex)}
                    style={
                      {
                        "--decision-progress": `${(Math.max(0, constructionIndex) / (constructions.length - 1)) * 100}%`,
                      } as CSSProperties
                    }
                    disabled={blocked}
                    onChange={(event) => {
                      const action = constructions[Number(event.target.value)];
                      if (action) choose(action);
                    }}
                  />
                </label>
              )}
            </>
          ) : destinations.length > 0 && !bankruptcy ? (
            <div className="destination-choice">
              <label htmlFor="destination">
                {pending?.kind === "sell"
                  ? "Propriété à vendre"
                  : "Destination"}
              </label>
              <select
                id="destination"
                value={
                  selectedAction && "tile" in selectedAction
                    ? selectedAction.tile
                    : destinations[0]?.tile
                }
                disabled={blocked}
                onChange={(event) => {
                  const action = destinations.find(
                    (choice) => choice.tile === Number(event.target.value),
                  );
                  if (action) choose(action);
                }}
              >
                {destinations.map((action) => (
                  <option key={actionKey(action)} value={action.tile}>
                    {TILE_NAMES[action.tile]}
                    {action.type === "Sell"
                      ? ` · ${money(propertyRefund(state, action.tile))}`
                      : ""}
                  </option>
                ))}
              </select>
              {pending?.kind === "travel" && freeRoll && (
                <fieldset
                  className="decision-other-choices"
                  aria-label="Choisir le lancer ou le voyage"
                >
                  <button
                    type="button"
                    className="button secondary"
                    aria-label="Choisir le lancer gratuit"
                    aria-pressed={selectedAction?.type === "Roll"}
                    disabled={blocked}
                    onClick={() => choose(freeRoll)}
                  >
                    Lancer gratuitement
                  </button>
                  {destinationChoice && (
                    <button
                      type="button"
                      className="button secondary"
                      aria-label={`Choisir le voyage vers ${TILE_NAMES[destinationChoice.tile]}`}
                      aria-pressed={selectedAction?.type === "Travel"}
                      disabled={blocked}
                      onClick={() => choose(destinationChoice)}
                    >
                      Voyager ici ·{" "}
                      {money(actionCost(state, destinationChoice))}
                    </button>
                  )}
                </fieldset>
              )}
            </div>
          ) : choices.length > 1 && !bankruptcy ? (
            <fieldset
              className="decision-other-choices"
              aria-label="Choisir une action"
            >
              {choices.map((action) => (
                <button
                  type="button"
                  key={actionKey(action)}
                  className="button secondary"
                  aria-pressed={
                    selectedAction &&
                    actionKey(selectedAction) === actionKey(action)
                  }
                  disabled={blocked}
                  onClick={() => choose(action)}
                >
                  {actionLabel(action, state)}
                </button>
              ))}
            </fieldset>
          ) : null}
        </div>
        <div className="decision-confirmation">
          {decline && (
            <button
              type="button"
              className="button quiet"
              disabled={blocked}
              onClick={() => {
                if (pending?.kind === "sell") {
                  if (bankruptcy && fallbackChoice) choose(fallbackChoice);
                  else choose(decline);
                } else act(decline);
              }}
            >
              {bankruptcy ? "Revenir aux ventes" : actionLabel(decline, state)}
            </button>
          )}
          <button
            type="button"
            className={`button primary decision-confirm ${bankruptcy ? "decision-bankruptcy" : ""}`}
            disabled={blocked || !selectedAction}
            onClick={confirm}
          >
            {blocked
              ? "Veuillez patienter…"
              : selectedAction
                ? confirmLabel(selectedAction, state)
                : "Choisir une option"}
            <Icon name="arrow" size={20} />
          </button>
        </div>
        <p className="decision-confirm-hint">
          {blocked
            ? "Votre choix sera disponible dès que la salle répond."
            : "Comparer ne dépense rien. Seule la confirmation engage votre choix."}
        </p>
      </motion.div>
    </dialog>,
    document.body,
  );
}
