import { motion } from "motion/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BOARD, ruleEconomy } from "../../shared/board/index.js";
import type { BuildLevel } from "../../shared/board/types.js";
import {
  type Action,
  actionCost,
  economyRule,
  getProperty,
  legalActions,
  maxBuildLevel,
  nextChampionship,
  type PublicState,
  previewPropertyRent,
  propertyRefund,
  propertyRent,
  rentCardPayment,
  type Seat,
} from "../../shared/engine/index.js";
import type { RandomnessStatus } from "../../shared/protocol/index.js";
import { useDirector } from "../director/director.js";
import { translate as t, useLocale } from "../i18n.js";
import {
  levelName,
  money,
  PLAYER_COLORS,
  PLAYER_SYMBOLS,
  tileName,
} from "./board-display.js";
import { cardName } from "./chance-display.js";
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
  roll: ["À vous de jouer !", "", "Your turn", ""],
  buy: ["Acheter cette ville", "", "Buy this city", ""],
  build: ["Construire", "", "Build", ""],
  buyout: ["Racheter cette ville", "", "Buy out this city", ""],
  sell: [
    "Une dette à régler",
    "Choisissez une propriété à vendre pour payer votre dette.",
    "Settle your debt",
    "Choose a property to sell and raise cash for your debt.",
  ],
  island: [
    "Quitter l’île",
    "Tentez un double pour repartir, ou payez la traversée.",
    "Leave the Island",
    "Roll doubles to leave, or pay the fare.",
  ],
  travel: [
    "Choisissez votre destination",
    "Sélectionnez une case sur le plateau.",
    "Choose a destination",
    "Select a space on the board.",
  ],
  host: [
    "Organiser le championnat",
    "Choisissez la ville qui accueillera le championnat.",
    "Host the championship",
    "Choose the city that will host the championship.",
  ],
  "card-target": [
    "Choisir une ville",
    "Choisissez la ville qui recevra l’effet de votre carte.",
    "Choose a city",
    "Choose the city to receive your card’s effect.",
  ],
  "rent-card": [
    "Régler le loyer",
    "Utilisez une carte de protection ou payez le loyer.",
    "Pay rent",
    "Use a protection card or pay the rent.",
  ],
} as const;
function decisionCopy(kind: keyof typeof COPY): readonly [string, string] {
  const [frTitle, frDescription, enTitle, enDescription] = COPY[kind];
  return [t(frTitle, enTitle), t(frDescription, enDescription)];
}
function actionKey(action: Action): string {
  return `${action.type}:${"level" in action ? action.level : "tile" in action ? action.tile : "card" in action ? action.card : ""}`;
}
function actionLabel(action: Action, state: PublicState): string {
  switch (action.type) {
    case "Buy":
    case "Build":
      return `${levelName(action.level)} · ${money(actionCost(state, action))}`;
    case "Roll":
      return t("Lancer les dés", "Roll the dice");
    case "PayIsland":
      return t(
        `Payer la traversée · ${money(actionCost(state, action))}`,
        `Pay the fare · ${money(actionCost(state, action))}`,
      );
    case "Buyout":
      return t(
        `Racheter · ${money(actionCost(state, action))}`,
        `Buy out · ${money(actionCost(state, action))}`,
      );
    case "Travel":
      return t("Voyager ici", "Travel here");
    case "ChooseHost": {
      const cost = actionCost(state, action);
      return state.championshipHost?.tile === action.tile
        ? t("Renouveler le championnat", "Renew the championship")
        : cost > 0
          ? t(
              `Organiser le championnat · ${money(cost)}`,
              `Host the championship · ${money(cost)}`,
            )
          : t("Organiser le championnat", "Host the championship");
    }
    case "ChooseTarget":
      if (state.pending?.kind === "card-target") {
        const pending = state.pending;
        if (pending.card === "Land Swap" && pending.sourceTile !== undefined)
          return t(
            `Échanger ${tileName(pending.sourceTile)} contre ${tileName(action.tile)}`,
            `Swap ${tileName(pending.sourceTile)} for ${tileName(action.tile)}`,
          );
        if (pending.card === "Contractor")
          return t(
            `Offrir un niveau à ${tileName(action.tile)}`,
            `Add a level to ${tileName(action.tile)}`,
          );
        if (pending.card === "Earthquake")
          return t(
            `Retirer un niveau à ${tileName(action.tile)}`,
            `Remove a level from ${tileName(action.tile)}`,
          );
      }
      return t("Choisir cette ville", "Choose this city");
    case "Sell":
      return t("Vendre cette propriété", "Sell this property");
    case "UseRentCard":
      return cardName(action.card);
    case "Decline":
      return state.pending?.kind === "sell"
        ? t("Déclarer faillite", "Declare bankruptcy")
        : state.pending?.kind === "rent-card"
          ? t(
              `Payer le loyer · ${money(rentCardPayment(state.pending.amount, null))}`,
              `Pay rent · ${money(rentCardPayment(state.pending.amount, null))}`,
            )
          : t("Passer", "Pass");
  }
}
function confirmLabel(action: Action, state: PublicState): string {
  switch (action.type) {
    case "Buy":
      return t(
        `Acheter · ${money(actionCost(state, action))}`,
        `Buy · ${money(actionCost(state, action))}`,
      );
    case "Build":
      return t(
        `Construire · ${money(actionCost(state, action))}`,
        `Build · ${money(actionCost(state, action))}`,
      );
    case "Buyout":
      return t(
        `Confirmer le rachat · ${money(actionCost(state, action))}`,
        `Confirm buyout · ${money(actionCost(state, action))}`,
      );
    case "Sell":
      return t(
        `Vendre · ${money(propertyRefund(state, action.tile))}`,
        `Sell · ${money(propertyRefund(state, action.tile))}`,
      );
    case "Travel":
      return t(
        `Voyager ici · ${money(actionCost(state, action))}`,
        `Travel here · ${money(actionCost(state, action))}`,
      );
    case "Decline":
      return t("Confirmer la faillite", "Confirm bankruptcy");
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
  const { t } = useLocale();
  const { busy, reducedMotion, speed, viewState } = useDirector();
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
  const hosting = selectedAction?.type === "ChooseHost";
  const rent =
    decisionTile === undefined
      ? null
      : construction || selectedAction?.type === "Buyout"
        ? previewPropertyRent(state, decisionTile, seat, selectedLevel)
        : hosting
          ? propertyRent(
              {
                ...state,
                championshipHost: nextChampionship(state, decisionTile),
              },
              decisionTile,
            )
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
    ([
      "Buy",
      "Build",
      "Buyout",
      "PayIsland",
      "Travel",
      "Sell",
      "ChooseHost",
    ].includes(selectedAction.type) ||
      pending?.kind === "rent-card")
      ? active.cash + (refund ?? -cost)
      : null;
  // Every level up to the hotel is shown; the ones this player cannot take
  // now stay visible but locked, so the hotel reads as "not yet".
  const constructionKind = pending?.kind === "buy" ? "Buy" : ("Build" as const);
  // The same cap legalActions applies; levels within it lack only cash.
  const ruleCap =
    pending?.kind === "buy" || pending?.kind === "build"
      ? state.config.hotelPurchaseRule === "staged-hotels"
        ? Math.min(
            pending.maxLevel,
            maxBuildLevel(state, seat, pending.tile, pending.kind === "buy"),
          )
        : pending.maxLevel
      : 0;
  const levelSteps: { action: ConstructionAction; legal: boolean }[] = [];
  if (construction && !resort && pending && "tile" in pending) {
    const first =
      pending.kind === "buy"
        ? 0
        : (getProperty(state, pending.tile)?.level ?? 0) + 1;
    const last = Math.max(4, ruleCap);
    for (let level = first; level <= last; level++) {
      const legal = constructions.find((action) => action.level === level);
      levelSteps.push({
        action: legal ?? {
          type: constructionKind,
          level: level as BuildLevel,
        },
        legal: Boolean(legal),
      });
    }
  }
  const lockedReason = (level: BuildLevel) =>
    level <= ruleCap
      ? t("Pas assez d’argent", "Not enough cash")
      : level === 4 && state.config.hotelPurchaseRule === "staged-hotels"
        ? t(
            "Hôtel : 3 maisons, un tour complet, puis revenir ici",
            "Hotel: three houses, one complete lap, then land here again",
          )
        : level === 4
          ? t(
              "Hôtel après votre premier tour complet",
              "Hotel after your first complete lap",
            )
          : level === 3
            ? t(
                "3 maisons après votre premier tour complet",
                "Three houses after your first complete lap",
              )
            : t("Pas encore disponible", "Not available yet");
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
          cardName(pending.card),
          pending.card === "Land Swap" && pending.sourceTile !== undefined
            ? t(
                `Votre ville de ${tileName(pending.sourceTile)} sera échangée avec la ville choisie. Les constructions restent sur chaque propriété.`,
                `Your city of ${tileName(pending.sourceTile)} will be swapped for the selected city. Buildings stay on each property.`,
              )
            : pending.card === "Contractor"
              ? t(
                  "Choisissez votre ville qui recevra un niveau de construction offert.",
                  "Choose one of your cities to receive a free building level.",
                )
              : t(
                  "Choisissez la ville adverse qui perdra un niveau de construction.",
                  "Choose the opponent’s city that will lose a building level.",
                ),
        ]
      : pending?.kind === "buy" && resort
        ? [t("Acheter une station", "Buy a resort"), ""]
        : pending?.kind === "host" && decline
          ? [
              decisionCopy("host")[0],
              t(
                `Déplacer le championnat coûte ${money(ruleEconomy(economyRule(state.config)).championshipFee)}, le renouveler est gratuit. Chaque édition ajoute ×1 au loyer de la ville hôte.`,
                `Moving the championship costs ${money(ruleEconomy(economyRule(state.config)).championshipFee)}; renewing it is free. Each edition adds ×1 to the host city’s rent.`,
              ),
            ]
          : decisionCopy(pending?.kind ?? "roll");
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
  // While animations play, name the player the board is showing, not the
  // server's next one: a purchase still animates after the turn has passed.
  const shownSeat =
    busy && viewState
      ? (viewState.pending?.seat ?? viewState.activeSeat)
      : decisionSeat;
  const shownName = state.players.find(
    (player) => player.seat === shownSeat,
  )?.name;
  // Only what the player acts on: their own countdown, and a debt warning.
  const debt = ownTurn && pending?.kind === "sell";
  const timer = ownTurn && pending && !rngBusy;
  const kicker =
    debt || timer ? (
      <div className="decision-kicker">
        {debt && (
          <>
            <span
              className="player-symbol"
              style={{ color: PLAYER_COLORS[decisionSeat] }}
            >
              {PLAYER_SYMBOLS[decisionSeat]}
            </span>
            <span>{t("Votre dette à régler", "Settle your debt")}</span>
          </>
        )}
        {timer && (
          <span
            className="decision-timer"
            role="timer"
            aria-label={t(
              `${countdown} secondes restantes`,
              `${countdown} seconds remaining`,
            )}
          >
            {countdown}s
          </span>
        )}
      </div>
    ) : null;

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
          {rngBusy
            ? randomness?.status === "error"
              ? t("Le lancer se fait attendre", "Waiting for the dice")
              : t("Les dés se préparent", "Preparing the dice")
            : ownTurn && !busy
              ? copy[0]
              : shownSeat === seat
                ? t("Votre tour", "Your turn")
                : t(
                    `${shownName ?? t("Votre adversaire", "Your opponent")} joue`,
                    `${shownName ?? t("Votre adversaire", "Your opponent")} is playing`,
                  )}
        </h2>
        {rngBusy && randomness?.commitment?.mode === "drand" && (
          <p>
            {t(
              "Le serveur attend le signal drand annoncé et vérifie sa signature.",
              "Waiting for the announced drand beacon and verifying its signature.",
            )}
          </p>
        )}
        {rngBusy && (
          <div className="rng-wait" role="status">
            <span className="spinner" />
            {randomness?.commitment?.round
              ? t(
                  `Signal drand #${randomness.commitment.round}`,
                  `Drand beacon #${randomness.commitment.round}`,
                )
              : t("Tirage serveur…", "Rolling dice…")}
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
                {t("Reprendre le choix", "Resume decision")}{" "}
                <Icon name="arrow" />
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
      aria-describedby={
        bankruptcy || copy[1] ? "decision-description" : undefined
      }
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
            aria-label={t("Réduire le choix", "Minimize the decision")}
            onClick={dismiss}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <h2 ref={headingRef} tabIndex={-1} id="decision-heading">
          {bankruptcy
            ? t("Déclarer faillite ?", "Declare bankruptcy?")
            : decisionTile !== undefined
              ? tileName(decisionTile)
              : copy[0]}
        </h2>
        {(bankruptcy || copy[1]) && (
          <p id="decision-description">
            {bankruptcy
              ? t(
                  "Cette décision est définitive. Vos propriétés seront remises à la banque.",
                  "This decision is final. Your properties will return to the bank.",
                )
              : copy[1]}
          </p>
        )}

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
            {owner && (
              <span className="decision-property">
                <span style={{ color: PLAYER_COLORS[owner.seat] }}>
                  {PLAYER_SYMBOLS[owner.seat]}
                </span>{" "}
                {owner.name} · {levelName(property?.level ?? 0)}
              </span>
            )}
          </div>
          <div className="decision-preview">
            <span className="decision-preview-name">
              {bankruptcy
                ? t("Fin de votre partie", "End of your game")
                : selectedAction && "level" in selectedAction
                  ? resort
                    ? t("Station balnéaire", "Resort")
                    : levelName(selectedAction.level)
                  : selectedAction
                    ? actionLabel(selectedAction, state)
                    : t("Votre choix", "Your choice")}
            </span>
            <dl className="decision-ledger">
              {pending?.kind === "rent-card" ? (
                <>
                  <div>
                    <dt>
                      {t("Loyer avant protection", "Rent before protection")}
                    </dt>
                    <dd>{money(pending.amount)}</dd>
                  </div>
                  <div className="ledger-main">
                    <dt>{t("À payer", "Amount due")}</dt>
                    <dd>{money(cost)}</dd>
                  </div>
                </>
              ) : refund !== null ? (
                <div className="ledger-main">
                  <dt>{t("Revente à la banque", "Sell back to the bank")}</dt>
                  <dd>+{money(refund)}</dd>
                </div>
              ) : selectedAction && cost > 0 ? (
                <div className="ledger-main">
                  <dt>
                    {pending?.kind === "buy"
                      ? t("Prix total", "Total price")
                      : pending?.kind === "build"
                        ? t("Coût des travaux", "Building cost")
                        : t("À payer", "Amount due")}
                  </dt>
                  <dd>{money(cost)}</dd>
                </div>
              ) : (
                <div className="ledger-main">
                  <dt>{t("Votre argent", "Your cash")}</dt>
                  <dd>{money(active?.cash ?? 0)}</dd>
                </div>
              )}
              {rent !== null &&
                !bankruptcy &&
                pending?.kind !== "rent-card" && (
                  <div>
                    <dt>
                      {construction || pending?.kind === "buyout" || hosting
                        ? t("Nouveau loyer", "New rent")
                        : t("Loyer actuel", "Current rent")}
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
                      ? t(
                          "Disponible pour la dette",
                          "Available to settle the debt",
                        )
                      : pending?.kind === "travel"
                        ? t("Après frais de voyage", "After travel costs")
                        : t("Argent restant", "Cash remaining")}
                  </dt>
                  <dd>{money(projectedCash)}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <div className="decision-actions">
          {construction && !bankruptcy ? (
            levelSteps.length > 0 && (
              <fieldset
                className="decision-construction-steps"
                style={{ "--steps": levelSteps.length } as CSSProperties}
                aria-label={t(
                  "Choisir une construction",
                  "Choose a building level",
                )}
              >
                {levelSteps.map(({ action, legal }) => {
                  const futureRent =
                    decisionTile !== undefined
                      ? previewPropertyRent(
                          state,
                          decisionTile,
                          seat,
                          action.level,
                        )
                      : 0;
                  const chosen =
                    legal &&
                    selectedAction !== undefined &&
                    actionKey(selectedAction) === actionKey(action);
                  return (
                    <button
                      type="button"
                      className="construction-choice"
                      key={actionKey(action)}
                      data-locked={!legal}
                      aria-pressed={legal ? chosen : undefined}
                      aria-label={
                        legal
                          ? t(
                              `${actionLabel(action, state)} · loyer futur ${money(futureRent)}`,
                              `${actionLabel(action, state)} · future rent ${money(futureRent)}`,
                            )
                          : `${levelName(action.level)} · ${lockedReason(action.level)}`
                      }
                      title={legal ? undefined : lockedReason(action.level)}
                      disabled={blocked || !legal}
                      onClick={() => choose(action)}
                    >
                      <CityIllustration
                        level={action.level}
                        color={PLAYER_COLORS[seat]}
                      />
                      <span className="construction-name">
                        {levelName(action.level)}
                      </span>
                      <strong className="construction-cost">
                        {money(actionCost(state, action))}
                      </strong>
                      <span className="construction-rent">
                        {t("Loyer", "Rent")} {money(futureRent)}
                      </span>
                      <span
                        className="construction-selected"
                        aria-hidden="true"
                      >
                        {!legal ? (
                          <Icon name="lock" size={15} />
                        ) : chosen ? (
                          <Icon name="check" size={15} />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </fieldset>
            )
          ) : destinations.length > 0 && !bankruptcy ? (
            <div className="destination-choice">
              <label htmlFor="destination">
                {pending?.kind === "sell"
                  ? t("Propriété à vendre", "Property to sell")
                  : pending?.kind === "host"
                    ? t("Ville hôte", "Host city")
                    : t("Destination", "Destination")}
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
                    {tileName(action.tile)}
                    {action.type === "Sell"
                      ? ` · ${money(propertyRefund(state, action.tile))}`
                      : action.type === "ChooseHost"
                        ? ` · ×${nextChampionship(state, action.tile).multiplier}${actionCost(state, action) > 0 ? ` · ${money(actionCost(state, action))}` : ""}`
                        : ""}
                  </option>
                ))}
              </select>
              {pending?.kind === "travel" && freeRoll && (
                <fieldset
                  className="decision-other-choices"
                  aria-label={t(
                    "Choisir le lancer ou le voyage",
                    "Choose rolling or travel",
                  )}
                >
                  <button
                    type="button"
                    className="button secondary"
                    aria-label={t(
                      "Choisir le lancer gratuit",
                      "Choose a free roll",
                    )}
                    aria-pressed={selectedAction?.type === "Roll"}
                    disabled={blocked}
                    onClick={() => choose(freeRoll)}
                  >
                    {t("Lancer gratuitement", "Roll for free")}
                  </button>
                  {destinationChoice && (
                    <button
                      type="button"
                      className="button secondary"
                      aria-label={t(
                        `Choisir le voyage vers ${tileName(destinationChoice.tile)}`,
                        `Choose travel to ${tileName(destinationChoice.tile)}`,
                      )}
                      aria-pressed={selectedAction?.type === "Travel"}
                      disabled={blocked}
                      onClick={() => choose(destinationChoice)}
                    >
                      {t("Voyager ici", "Travel here")} ·{" "}
                      {money(actionCost(state, destinationChoice))}
                    </button>
                  )}
                </fieldset>
              )}
            </div>
          ) : choices.length > 1 && !bankruptcy ? (
            <fieldset
              className="decision-other-choices"
              aria-label={t("Choisir une action", "Choose an action")}
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
              {bankruptcy
                ? t("Revenir aux ventes", "Back to property sales")
                : actionLabel(decline, state)}
            </button>
          )}
          <button
            type="button"
            className={`button primary decision-confirm ${bankruptcy ? "decision-bankruptcy" : ""}`}
            disabled={blocked || !selectedAction}
            onClick={confirm}
          >
            {blocked
              ? t("Veuillez patienter…", "Please wait…")
              : selectedAction
                ? confirmLabel(selectedAction, state)
                : t("Choisir une option", "Choose an option")}
            <Icon name="arrow" size={20} />
          </button>
        </div>
      </motion.div>
    </dialog>,
    document.body,
  );
}
