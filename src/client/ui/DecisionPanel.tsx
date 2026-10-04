import { motion } from "motion/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getBoard, ruleEconomy } from "../../shared/board/index.js";
import type { BuildLevel } from "../../shared/board/types.js";
import {
  type Action,
  actionCost,
  buyoutPriceAt,
  championshipCost,
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
  travelSalary,
} from "../../shared/engine/index.js";
import type { RandomnessStatus } from "../../shared/protocol/index.js";
import { useDirector } from "../director/director.js";
import { translate as t, useLocale } from "../i18n.js";
import ActionButton from "./ActionButton.js";
import {
  levelName,
  money,
  PLAYER_COLORS,
  TILE_ICONS,
  tileColor,
  tileName,
  tilePrice,
} from "./board-display.js";
import {
  type BoardPickAction,
  boardPickActions,
  isBoardPick,
} from "./board-pick.js";
import CityIllustration from "./CityIllustration.js";
import { cardName } from "./chance-display.js";
import Icon from "./Icon.js";
import "./DecisionPanel.css";

export type DecisionPanelProps = {
  state: PublicState;
  /** The seat this screen acts for now; null for someone watching. */
  seat: Seat | null;
  /** Names the deciding player when several people share this screen. */
  playerName?: string;
  act: (action: Action) => void;
  blocked: boolean;
  randomness: RandomnessStatus | null;
  selected: number | null;
  onSelect: (tile: number) => void;
  obscured?: boolean;
  picked: number | null;
  onPick: (tile: number) => void;
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
    "Cliquez une case en surbrillance ou utilisez la liste.",
    "Choose a destination",
    "Click a highlighted space or use the list.",
  ],
  host: [
    "Championnat",
    "Cliquez l’une de vos villes en surbrillance ou utilisez la liste.",
    "Championship",
    "Click one of your highlighted cities or use the list.",
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
    case "RequestPause":
      return t("Demander une pause", "Request pause");
    case "VotePause":
      return action.accept
        ? t("Accepter la pause", "Accept pause")
        : t("Refuser la pause", "Decline pause");
    case "ResumeGame":
      return t("Reprendre la partie", "Resume game");
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
            `Échanger ${tileName(pending.sourceTile, state.config)} contre ${tileName(action.tile, state.config)}`,
            `Swap ${tileName(pending.sourceTile, state.config)} for ${tileName(action.tile, state.config)}`,
          );
        if (pending.card === "Contractor")
          return t(
            `Offrir un niveau à ${tileName(action.tile, state.config)}`,
            `Add a level to ${tileName(action.tile, state.config)}`,
          );
        if (pending.card === "Earthquake")
          return t(
            `Retirer un niveau à ${tileName(action.tile, state.config)}`,
            `Remove a level from ${tileName(action.tile, state.config)}`,
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
function pickConfirmLabel(action: BoardPickAction, state: PublicState): string {
  switch (action.type) {
    case "Travel":
      return t(
        `Voyager à ${tileName(action.tile, state.config)} · ${money(actionCost(state, action))}`,
        `Travel to ${tileName(action.tile, state.config)} · ${money(actionCost(state, action))}`,
      );
    case "ChooseHost": {
      const fee = championshipCost(state, action.tile);
      const verb =
        state.championshipHost?.tile === action.tile
          ? t("Renouveler le championnat", "Renew the Championship")
          : t("Organiser le championnat", "Host the Championship");
      return `${verb} · ${fee > 0 ? money(fee) : t("gratuit", "free")}`;
    }
    case "ChooseTarget":
      return actionLabel(action, state);
  }
}
/** One line describing what the clicked space means for this decision. */
function pickDetail(action: BoardPickAction, state: PublicState): string {
  const tile = action.tile;
  const property = getProperty(state, tile);
  const owner =
    property?.owner != null
      ? state.players.find((player) => player.seat === property.owner)
      : undefined;
  const resort = getBoard(state.config)[tile].kind === "resort";
  if (action.type === "ChooseHost") {
    const championship = nextChampionship(state, tile);
    const multiplier = championship.multiplier;
    const hosted = propertyRent(
      { ...state, championshipHost: championship },
      tile,
    );
    return t(
      `Loyer ${money(propertyRent(state, tile))} → ${money(hosted)} · ×${multiplier}`,
      `Rent ${money(propertyRent(state, tile))} → ${money(hosted)} · ×${multiplier}`,
    );
  }
  if (action.type === "ChooseTarget")
    return owner
      ? `${owner.name} · ${levelName(property?.level ?? 0)}`
      : levelName(property?.level ?? 0);
  if (getBoard(state.config)[tile].kind === "start")
    return t(
      `Salaire de ${money(state.config.startSalary)} à l’arrivée`,
      `Collect ${money(state.config.startSalary)} on arrival`,
    );
  if (owner)
    return resort
      ? t(
          `Votre plage · loyer ${money(propertyRent(state, tile))}`,
          `Your beach · rent ${money(propertyRent(state, tile))}`,
        )
      : t(
          `Votre ville · ${levelName(property?.level ?? 0)} · construire`,
          `Your city · ${levelName(property?.level ?? 0)} · build`,
        );
  return resort
    ? t(
        `Plage libre · ${money(tilePrice(tile, state) ?? 0)}`,
        `Unowned beach · ${money(tilePrice(tile, state) ?? 0)}`,
      )
    : t(
        `Ville libre · terrain ${money(tilePrice(tile, state) ?? 0)}`,
        `Unowned city · land ${money(tilePrice(tile, state) ?? 0)}`,
      );
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

export default function DecisionPanel({
  state,
  seat: viewer,
  playerName,
  act,
  blocked,
  randomness,
  selected,
  onSelect,
  obscured = false,
  picked,
  onPick,
}: DecisionPanelProps) {
  const { t } = useLocale();
  const { busy, reducedMotion, viewState } = useDirector();
  const [now, setNow] = useState(Date.now());
  const [selection, setSelection] = useState<{
    decision: string;
    action: string;
    pending: PublicState["pending"];
    tile: number | null;
  } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const obscuredRef = useRef(obscured);
  obscuredRef.current = obscured;
  const pending = state.pending;
  const decisionSeat = pending?.seat ?? state.activeSeat;
  // Previews take the deciding player's view for someone only watching.
  const seat = viewer ?? decisionSeat;
  const active = state.players.find((player) => player.seat === decisionSeat);
  const ownTurn =
    viewer !== null &&
    decisionSeat === viewer &&
    !active?.bankrupt &&
    state.status === "active";
  const named = (text: string) =>
    playerName ? `${playerName} · ${text}` : text;
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
  const boardPick = ownTurn && isBoardPick(state);
  const pickActions = boardPick ? boardPickActions(state, seat) : [];
  const pickedAction = pickActions.find((action) => action.tile === picked);
  const destinationChoice =
    destinations.find((action) => action.tile === selected) ??
    (pending?.kind === "sell" ? undefined : destinations[0]);
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
    pending?.kind === "sell"
      ? selection?.pending === pending &&
        selection.action === "Decline:" &&
        selection.tile === selected
        ? actions.find((action) => action.type === "Decline")
        : destinationChoice
      : selection?.decision === decisionKey
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
    decisionTile !== undefined &&
    getBoard(state.config)[decisionTile].kind === "resort";
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
  // A flight past Start collects the salary on the way.
  const salary =
    selectedAction?.type === "Travel"
      ? travelSalary(state, seat, selectedAction.tile)
      : 0;
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
      ? active.cash + (refund ?? salary - cost)
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
    const last = Math.min(
      ruleEconomy(economyRule(state.config)).topLevel,
      Math.max(4, ruleCap),
    );
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
  const unavailableReason = blocked
    ? t(
        "Attendez la fin de l’action ou la reconnexion au serveur.",
        "Wait for the current action to finish or for the server to reconnect.",
      )
    : t(
        "Choisissez une propriété en surbrillance sur le plateau.",
        "Choose a highlighted property on the board.",
      );
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
      pending.kind !== "sell" &&
      !boardPick &&
      !busy &&
      !rngBusy &&
      !obscured &&
      dismissed !== decisionKey,
  );
  const countdown = pending
    ? Math.max(
        0,
        Math.ceil(
          (pending.deadline -
            (state.pause?.kind === "paused" ? state.pause.startedAt : now)) /
            1000,
        ),
      )
    : 0;
  const copy: readonly [string, string] =
    pending?.kind === "card-target"
      ? [
          cardName(pending.card),
          pending.card === "Land Swap" && pending.sourceTile !== undefined
            ? t(
                `Votre ville de ${tileName(pending.sourceTile, state.config)} sera échangée avec la ville choisie. Les constructions restent sur chaque propriété.`,
                `Your city of ${tileName(pending.sourceTile, state.config)} will be swapped for the selected city. Buildings stay on each property.`,
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
        ? [t("Acheter une plage", "Buy a beach"), ""]
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
    if (state.pause?.kind === "paused") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.pause?.kind]);
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
      if (!obscuredRef.current && previousFocus.current?.isConnected)
        previousFocus.current.focus();
    };
  }, [modalOpen, decisionKey]);
  useEffect(() => {
    if (dismissed === decisionKey && !modalOpen && !obscuredRef.current)
      resumeRef.current?.focus();
  }, [dismissed, decisionKey, modalOpen]);
  function choose(action: Action) {
    setSelection({
      decision: decisionKey,
      action: actionKey(action),
      pending,
      tile: selected,
    });
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
  // The rolling player's clock is the bar on their HUD; a decision shows its seconds here.
  const timer = ownTurn && pending && pending.kind !== "roll" && !rngBusy;
  const kicker =
    debt || timer ? (
      <div className="decision-kicker">
        {debt && (
          <>
            <span
              className="player-dot"
              style={{ color: PLAYER_COLORS[decisionSeat] }}
              aria-hidden="true"
            />
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

  if (debt && !busy && !rngBusy)
    return (
      <section
        className="decision-panel decision-sale"
        data-kind="sell"
        data-own="true"
        data-busy={blocked}
        aria-labelledby="decision-heading"
        aria-describedby="sale-instruction"
        aria-busy={blocked}
      >
        <div className="sale-topline">
          <h2 id="decision-heading">
            {named(
              bankruptcy
                ? t("Déclarer faillite ?", "Declare bankruptcy?")
                : t("Vendre une ville", "Sell a city"),
            )}
          </h2>
          <dl className="sale-ledger">
            <div>
              <dt>{t("Dette", "Debt")}</dt>
              <dd>{money(Math.max(0, -(active?.cash ?? 0)))}</dd>
            </div>
            {!bankruptcy && projectedCash !== null && (
              <div data-negative={projectedCash < 0}>
                <dt>
                  {projectedCash < 0
                    ? t("Dette après vente", "Debt after sale")
                    : t("Argent après vente", "Cash after sale")}
                </dt>
                <dd>{money(Math.abs(projectedCash))}</dd>
              </div>
            )}
          </dl>
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
        <div className="sale-controls">
          {bankruptcy ? (
            <p id="sale-instruction" className="sale-warning">
              {t(
                "Définitif : vos propriétés retournent à la banque.",
                "Final: your properties return to the bank.",
              )}
            </p>
          ) : (
            <div
              id="sale-instruction"
              className="sale-selection"
              role="status"
              aria-live="polite"
            >
              <div>
                <strong>
                  {decisionTile !== undefined
                    ? tileName(decisionTile, state.config)
                    : t("Choisissez une ville", "Choose a city")}
                </strong>
                <span>
                  {property
                    ? levelName(property.level)
                    : t(
                        "Cliquez une ville en surbrillance",
                        "Click a highlighted city",
                      )}
                </span>
              </div>
              {refund !== null && <b>+{money(refund)}</b>}
            </div>
          )}
          <div className="sale-confirmation">
            {decline && (
              <ActionButton
                type="button"
                className="button quiet"
                disabled={blocked}
                disabledReason={unavailableReason}
                onClick={() => {
                  if (bankruptcy) setSelection(null);
                  else choose(decline);
                }}
              >
                {bankruptcy
                  ? t("Revenir aux ventes", "Back to property sales")
                  : t("Déclarer faillite", "Declare bankruptcy")}
              </ActionButton>
            )}
            <ActionButton
              type="button"
              className={`button primary sale-confirm ${bankruptcy ? "decision-bankruptcy" : ""}`}
              disabled={blocked || !selectedAction}
              disabledReason={unavailableReason}
              onClick={confirm}
            >
              {blocked
                ? t("Veuillez patienter…", "Please wait…")
                : selectedAction
                  ? confirmLabel(selectedAction, state)
                  : t("Choisissez une ville", "Choose a city")}
              <Icon name="arrow" size={18} />
            </ActionButton>
          </div>
        </div>
      </section>
    );

  if (boardPick && pending && !busy && !rngBusy) {
    const travel = pending.kind === "travel";
    const pickLabel = travel
      ? t("Destination", "Destination")
      : pending.kind === "host"
        ? t("Ville hôte", "Host city")
        : t("Ville ciblée", "Target city");
    const hint =
      travel && pickActions.length === 0
        ? t(
            `Il faut ${money(pending.fee)} pour voyager. Lancez les dés pour continuer.`,
            `Travel costs ${money(pending.fee)}. Roll the dice to continue.`,
          )
        : pending.kind === "card-target"
          ? `${copy[1]} ${t("Cliquez-la sur le plateau.", "Click it on the board.")}`
          : copy[1];
    return (
      <motion.section
        className="decision-panel decision-compact decision-pick"
        data-kind={pending.kind}
        data-own="true"
        data-busy={blocked}
        data-picked={Boolean(pickedAction)}
        aria-labelledby="decision-heading"
        aria-describedby="decision-description"
        aria-busy={blocked}
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.22 }}
      >
        <div className="pick-head">
          <span
            className="player-dot"
            style={{ color: PLAYER_COLORS[decisionSeat] }}
            aria-hidden="true"
          />
          <h2 id="decision-heading">
            {named(
              pending.kind === "card-target" ? cardName(pending.card) : copy[0],
            )}
          </h2>
          {pickActions.length > 0 && (
            <select
              className="pick-list"
              aria-label={pickLabel}
              value={pickedAction?.tile ?? ""}
              disabled={blocked}
              data-disabled-reason={unavailableReason}
              onChange={(event) => {
                if (event.target.value !== "")
                  onPick(Number(event.target.value));
              }}
            >
              <option value="" disabled>
                {t(
                  `Liste des cases (${pickActions.length})`,
                  `List of spaces (${pickActions.length})`,
                )}
              </option>
              {pickActions.map((action) => (
                <option key={actionKey(action)} value={action.tile}>
                  {tileName(action.tile, state.config)}
                  {action.type === "ChooseHost"
                    ? ` · ×${nextChampionship(state, action.tile).multiplier}${championshipCost(state, action.tile) > 0 ? ` · ${money(championshipCost(state, action.tile))}` : ""}`
                    : ""}
                </option>
              ))}
            </select>
          )}
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
        </div>
        <div className="pick-body">
          <div className="pick-summary" data-empty={!pickedAction}>
            {pickedAction ? (
              <>
                <span
                  className="pick-chip"
                  style={{
                    backgroundColor: tileColor(pickedAction.tile, state.config),
                  }}
                  aria-hidden="true"
                >
                  {TILE_ICONS[getBoard(state.config)[pickedAction.tile].kind]}
                </span>
                <span className="pick-name">
                  <strong>{tileName(pickedAction.tile, state.config)}</strong>
                  <small>{pickDetail(pickedAction, state)}</small>
                </span>
                {pickedAction.type === "ChooseHost" && active && (
                  <dl className="decision-ledger pick-host-ledger">
                    <div>
                      <dt>{t("À payer", "Amount due")}</dt>
                      <dd>
                        {money(championshipCost(state, pickedAction.tile))}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Nouveau loyer", "New rent")}</dt>
                      <dd>
                        {money(
                          propertyRent(
                            {
                              ...state,
                              championshipHost: nextChampionship(
                                state,
                                pickedAction.tile,
                              ),
                            },
                            pickedAction.tile,
                          ),
                        )}
                      </dd>
                    </div>
                    <div className="ledger-balance">
                      <dt>{t("Argent restant", "Cash remaining")}</dt>
                      <dd>
                        {money(
                          active.cash -
                            championshipCost(state, pickedAction.tile),
                        )}
                      </dd>
                    </div>
                  </dl>
                )}
                {travel &&
                  active &&
                  (() => {
                    const salary = travelSalary(state, seat, pickedAction.tile);
                    return (
                      <span className="ledger-balance pick-balance">
                        {t("Il vous restera", "You keep")}
                        <b>
                          {money(
                            active.cash +
                              salary -
                              actionCost(state, pickedAction),
                          )}
                        </b>
                        {salary > 0 && (
                          <small>
                            {t(
                              `+${money(salary)} au départ`,
                              `+${money(salary)} at Start`,
                            )}
                          </small>
                        )}
                      </span>
                    );
                  })()}
              </>
            ) : (
              <span className="pick-empty">
                <Icon name="pin" size={19} />
                <span id="decision-description">{hint}</span>
              </span>
            )}
          </div>
          <div className="pick-actions">
            {freeRoll && (
              <ActionButton
                type="button"
                className="button secondary"
                disabled={blocked}
                disabledReason={unavailableReason}
                onClick={() => act(freeRoll)}
              >
                <Icon name="dice" size={18} />
                {t("Lancer les dés", "Roll the dice")}
              </ActionButton>
            )}
            {decline && (
              <ActionButton
                type="button"
                className="button quiet"
                disabled={blocked}
                disabledReason={unavailableReason}
                onClick={() => act(decline)}
              >
                {actionLabel(decline, state)}
              </ActionButton>
            )}
            {pickedAction && (
              <ActionButton
                type="button"
                className="button primary decision-confirm"
                disabled={blocked}
                disabledReason={unavailableReason}
                onClick={() => act(pickedAction)}
              >
                {blocked
                  ? t("Veuillez patienter…", "Please wait…")
                  : pickConfirmLabel(pickedAction, state)}
                <Icon name="arrow" size={20} />
              </ActionButton>
            )}
          </div>
        </div>
        {pickedAction && (
          <p id="decision-description" className="sr-only">
            {hint}
          </p>
        )}
      </motion.section>
    );
  }

  const statusTitle = rngBusy
    ? randomness?.status === "error"
      ? t("Le lancer se fait attendre", "Waiting for the dice")
      : t("Les dés se préparent", "Preparing the dice")
    : ownTurn && !busy
      ? named(copy[0])
      : viewer !== null && shownSeat === viewer
        ? t("Votre tour", "Your turn")
        : t(
            `${shownName ?? t("Votre adversaire", "Your opponent")} joue`,
            `${shownName ?? t("Votre adversaire", "Your opponent")} is playing`,
          );
  // Someone else's turn, or an animation in progress: the board and the active
  // HUD already show it, so the bottom of the screen stays empty.
  if (!modalOpen && !rngBusy && !(ownTurn && !busy))
    return (
      <p className="sr-only" role="status">
        {statusTitle}
      </p>
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
        {ownTurn && pending?.kind === "roll" && !rngBusy && (
          <span
            className="sr-only"
            role="timer"
            aria-label={t(
              `${countdown} secondes pour lancer`,
              `${countdown} seconds to roll`,
            )}
          >
            {countdown}s
          </span>
        )}
        <h2 id="decision-heading">{statusTitle}</h2>
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
                <Icon name="screen" size={19} />
                <span>
                  {copy[0]}
                  <small>{t("Reprendre le choix", "Resume decision")}</small>
                </span>
                <span className="decision-dock-timer" role="timer">
                  {countdown}s
                </span>
              </button>
            ) : (
              actions.map((action) => (
                <ActionButton
                  type="button"
                  key={actionKey(action)}
                  className="button primary roll-button"
                  aria-label={actionLabel(action, state)}
                  disabled={blocked}
                  disabledReason={unavailableReason}
                  onClick={() => act(action)}
                >
                  <Icon name="dice" size={24} />
                  {action.type === "Roll"
                    ? t("Lancer", "Roll")
                    : actionLabel(action, state)}
                </ActionButton>
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
        <span>{named(copy[0])}</span>
      </div>
      <motion.div
        className="decision-popup-inner"
        initial={reducedMotion ? false : { opacity: 0.7, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reducedMotion ? 0 : 0.28,
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
            <Icon name="minimize" size={17} />
          </button>
        </div>
        <h2 ref={headingRef} tabIndex={-1} id="decision-heading">
          {bankruptcy
            ? t("Déclarer faillite ?", "Declare bankruptcy?")
            : decisionTile !== undefined
              ? tileName(decisionTile, state.config)
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
              flag
            />
            {owner && (
              <span className="decision-property">
                <span style={{ color: PLAYER_COLORS[owner.seat] }}>
                  {owner.name}
                </span>{" "}
                · {levelName(property?.level ?? 0)}
              </span>
            )}
          </div>
          <div className="decision-preview">
            <span className="decision-preview-name">
              {bankruptcy
                ? t("Fin de votre partie", "End of your game")
                : selectedAction && "level" in selectedAction
                  ? resort
                    ? t("Plage", "Beach")
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
              {salary > 0 && !bankruptcy && (
                <div>
                  <dt>{t("Salaire au départ", "Salary at Start")}</dt>
                  <dd>+{money(salary)}</dd>
                </div>
              )}
              {construction && decisionTile !== undefined && !bankruptcy && (
                <div className="ledger-buyout">
                  <dt>{t("Rachat par un adversaire", "Opponent buyout")}</dt>
                  <dd>
                    {(() => {
                      const price = buyoutPriceAt(
                        state,
                        decisionTile,
                        selectedLevel,
                      );
                      return price === null
                        ? t("Protégé", "Protected")
                        : money(price);
                    })()}
                  </dd>
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
                        ? t("Après le voyage", "After the trip")
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
                    <ActionButton
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
                      disabledReason={
                        !legal ? lockedReason(action.level) : unavailableReason
                      }
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
                    </ActionButton>
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
                data-disabled-reason={unavailableReason}
                onChange={(event) => {
                  const action = destinations.find(
                    (choice) => choice.tile === Number(event.target.value),
                  );
                  if (action) choose(action);
                }}
              >
                {destinations.map((action) => (
                  <option key={actionKey(action)} value={action.tile}>
                    {tileName(action.tile, state.config)}
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
                  <ActionButton
                    type="button"
                    className="button secondary"
                    aria-label={t(
                      "Choisir le lancer gratuit",
                      "Choose a free roll",
                    )}
                    aria-pressed={selectedAction?.type === "Roll"}
                    disabled={blocked}
                    disabledReason={unavailableReason}
                    onClick={() => choose(freeRoll)}
                  >
                    {t("Lancer gratuitement", "Roll for free")}
                  </ActionButton>
                  {destinationChoice && (
                    <ActionButton
                      type="button"
                      className="button secondary"
                      aria-label={t(
                        `Choisir le voyage vers ${tileName(destinationChoice.tile, state.config)}`,
                        `Choose travel to ${tileName(destinationChoice.tile, state.config)}`,
                      )}
                      aria-pressed={selectedAction?.type === "Travel"}
                      disabled={blocked}
                      disabledReason={unavailableReason}
                      onClick={() => choose(destinationChoice)}
                    >
                      {t("Voyager ici", "Travel here")} ·{" "}
                      {money(actionCost(state, destinationChoice))}
                    </ActionButton>
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
                <ActionButton
                  type="button"
                  key={actionKey(action)}
                  className="button secondary"
                  aria-pressed={
                    selectedAction &&
                    actionKey(selectedAction) === actionKey(action)
                  }
                  disabled={blocked}
                  disabledReason={unavailableReason}
                  onClick={() => choose(action)}
                >
                  {actionLabel(action, state)}
                </ActionButton>
              ))}
            </fieldset>
          ) : null}
        </div>
        <div className="decision-confirmation">
          {decline && (
            <ActionButton
              type="button"
              className="button quiet"
              disabled={blocked}
              disabledReason={unavailableReason}
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
            </ActionButton>
          )}
          <ActionButton
            type="button"
            className={`button primary decision-confirm ${bankruptcy ? "decision-bankruptcy" : ""}`}
            disabled={blocked || !selectedAction}
            disabledReason={unavailableReason}
            onClick={confirm}
          >
            {blocked
              ? t("Veuillez patienter…", "Please wait…")
              : selectedAction
                ? confirmLabel(selectedAction, state)
                : t("Choisir une option", "Choose an option")}
            <Icon name="arrow" size={20} />
          </ActionButton>
        </div>
      </motion.div>
    </dialog>,
    document.body,
  );
}
