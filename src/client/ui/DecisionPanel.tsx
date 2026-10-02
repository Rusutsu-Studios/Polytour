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
import { translate as t, useLocale } from "../i18n.js";
import {
  levelName,
  money,
  PLAYER_COLORS,
  PLAYER_SYMBOLS,
  tileName,
} from "./board-display.js";
import CityIllustration from "./CityIllustration.js";
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
    "Accueillir un festival",
    "Choisissez la ville qui accueillera le festival.",
    "Host a festival",
    "Choose the city that will host the festival.",
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
    case "ChooseHost":
      return t("Accueillir le festival", "Host the festival");
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
                      {construction || pending?.kind === "buyout"
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
