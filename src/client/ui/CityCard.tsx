import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  type BuildLevel,
  ECONOMY,
  getBoard,
  getTileBaseRent,
  getTileBuildCost,
  getTileLandPrice,
  ruleEconomy,
} from "../../shared/board/index.js";
import {
  boardRule,
  buyoutPrice,
  economyRule,
  getProperty,
  type PublicState,
  previewPropertyRent,
  propertyRent,
  propertyRentAt,
  type RentBoost,
  rentBoost,
  resortCount,
  resortFestivals,
  type Seat,
  worldTourRule,
} from "../../shared/engine/index.js";
import { useDirector } from "../director/director.js";
import { translate as t, useLocale } from "../i18n.js";
import {
  levelName,
  money,
  PLAYER_COLORS,
  REGION_COLORS,
  TILE_ICONS,
  tileColor,
  tileName,
  tilePrice,
} from "./board-display.js";
import CityIllustration from "./CityIllustration.js";
import Icon from "./Icon.js";
import "./CityCard.css";

const LEVELS: readonly BuildLevel[] = [0, 1, 2, 3, 4, 5];
const RESORT_COUNTS = [1, 2, 3] as const;

// Inspecting a space answers what it costs to land there. A property opens as
// a large title deed: who owns it, the rent due now, and every rent and price
// by building level, with the bonus that multiplies it.
export default function CityCard({
  state,
  seat,
  selected,
  onClose,
}: {
  state: PublicState;
  /** Null for someone watching the match without a seat. */
  seat: Seat | null;
  selected: number | null;
  onClose: () => void;
}) {
  // Subscribing here re-renders the whole card when the language changes.
  useLocale();
  const { reducedMotion } = useDirector();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const index =
    selected ??
    state.players.find((player) => player.seat === state.activeSeat)
      ?.position ??
    0;
  const tile = getBoard(state.config)[index];
  const property = getProperty(state, index);
  const owner =
    property?.owner != null
      ? state.players.find((player) => player.seat === property.owner)
      : null;
  const ownerColor = owner ? PLAYER_COLORS[owner.seat] : "#8fa38c";
  const kind =
    tile.kind === "city"
      ? t("Ville", "City")
      : tile.kind === "resort"
        ? t("Plage", "Resort")
        : t("Case spéciale", "Special space");

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a mouse shortcut; Escape and the close button cover the keyboard.
    <dialog
      ref={dialogRef}
      className="city-card-dialog"
      aria-labelledby="city-card-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="city-card-ribbon">
        <h2 id="city-card-title">{tileName(index, state.config)}</h2>
      </div>
      <motion.section
        className="city-card"
        data-space={index}
        data-kind={tile.kind}
        initial={reducedMotion ? false : { opacity: 0.7, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.24 }}
      >
        <div className="city-card-topline">
          <div className="city-card-space">
            <span className="city-card-place">
              <span
                className="city-card-kind"
                style={{ backgroundColor: tileColor(index, state.config) }}
                aria-hidden="true"
              >
                {TILE_ICONS[tile.kind]}
              </span>
              {t(`Case ${index + 1} / 32`, `Space ${index + 1} / 32`)}
            </span>
            <span className="city-card-kind-name">{kind}</span>
          </div>
          <button
            type="button"
            className="icon-button city-card-close"
            aria-label={t("Fermer l’inspection", "Close inspection")}
            onClick={onClose}
          >
            <Icon name="close" size={17} />
          </button>
        </div>

        {property ? (
          <div className="city-card-columns">
            <div className="city-card-visual">
              <CityIllustration
                level={property.level}
                color={ownerColor}
                resort={tile.kind === "resort"}
                flag={Boolean(owner)}
              />
              <p className="city-card-owner" data-owned={Boolean(owner)}>
                {owner ? (
                  <>
                    <span
                      className="city-card-pawn"
                      style={{ backgroundColor: ownerColor }}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>
                        {owner.seat === seat
                          ? t(`${owner.name} (vous)`, `${owner.name} (you)`)
                          : owner.name}
                      </strong>
                      <small>
                        {tile.kind === "resort"
                          ? resortTotal(resortCount(state, owner.seat))
                          : levelName(property.level)}
                      </small>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="city-card-pawn" aria-hidden="true">
                      {TILE_ICONS[tile.kind]}
                    </span>
                    <span>
                      <strong>{t("Sans propriétaire", "No owner yet")}</strong>
                      <small>
                        {t("Disponible à l’achat", "Available to buy")}
                      </small>
                    </span>
                  </>
                )}
              </p>
              <BoostBadge boost={rentBoost(state, index)} />
            </div>
            {tile.kind === "city" ? (
              <CityDeed state={state} seat={seat} index={index} />
            ) : (
              <ResortDeed state={state} seat={seat} index={index} />
            )}
          </div>
        ) : (
          <SpaceRule state={state} index={index} />
        )}
      </motion.section>
    </dialog>,
    document.body,
  );
}

function resortTotal(count: number) {
  return count === 1
    ? t("1 plage en tout", "1 resort in all")
    : t(`${count} plages en tout`, `${count} resorts in all`);
}

function boostLabel(boost: RentBoost) {
  const source =
    boost.source === "country"
      ? t("Pays complet", "Full country")
      : boost.source === "championship"
        ? t("Championnat", "Championship")
        : boost.source === "combined"
          ? t("Bonus cumulés", "Combined bonuses")
          : t("Festival", "Festival");
  return `${source} · ×${boost.multiplier}`;
}

function BoostBadge({ boost }: { boost: RentBoost | null }) {
  if (!boost) return null;
  return (
    <p className="city-card-boost" data-source={boost.source}>
      <span aria-hidden="true">{boost.source === "country" ? "⚑" : "★"}</span>
      {boostLabel(boost)}
    </p>
  );
}

/** The figures that matter now: what landing here costs, or what buying does. */
function Ledger({
  items,
}: {
  items: readonly { label: string; value: string; main?: boolean }[];
}) {
  return (
    <dl className="city-card-ledger">
      {items.map((item) => (
        <div key={item.label} className={item.main ? "ledger-main" : undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function rentLabel(owner: Seat | null, seat: Seat | null) {
  return owner !== null && owner === seat
    ? t("Loyer que vous touchez", "Rent you collect")
    : t("Loyer à payer ici", "Rent due here");
}

function CityDeed({
  state,
  seat,
  index,
}: {
  state: PublicState;
  seat: Seat | null;
  index: number;
}) {
  const tile = getBoard(state.config)[index];
  const property = getProperty(state, index);
  const owner = property?.owner ?? null;
  const boost = rentBoost(state, index);
  const buyout = buyoutPrice(state, index);
  const rule = economyRule(state.config);
  const board = boardRule(state.config);
  const rules = ruleEconomy(rule);
  const items =
    owner === null
      ? [
          {
            label: t("Prix d’achat du terrain", "Land price"),
            value: money(getTileLandPrice(index, rule, board)),
            main: true,
          },
          {
            label: t("Loyer juste après l’achat", "Rent right after buying"),
            value: money(
              previewPropertyRent(state, index, seat ?? state.activeSeat, 0),
            ),
          },
        ]
      : [
          {
            label: rentLabel(owner, seat),
            value: money(propertyRent(state, index)),
            main: true,
          },
          {
            label:
              owner === seat
                ? t("Rachat par un adversaire", "Buyout by a rival")
                : t("Prix de rachat", "Buyout price"),
            value:
              buyout === null ? t("Impossible", "Not allowed") : money(buyout),
          },
        ];
  return (
    <div className="city-card-deed">
      <Ledger items={items} />
      <table
        className="city-card-table"
        style={{
          borderTopColor:
            tile.kind === "city" ? REGION_COLORS[tile.country] : undefined,
        }}
      >
        <caption>
          {t("Loyer selon les constructions", "Rent by building level")}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("Construction", "Building")}</th>
            <th scope="col">{t("Coût", "Cost")}</th>
            <th scope="col">{t("Loyer de base", "Base rent")}</th>
            <th scope="col" className="city-card-boosted">
              {owner === null
                ? t("Après achat", "After buying")
                : boost
                  ? boostLabel(boost)
                  : t("Loyer actuel", "Current rent")}
            </th>
          </tr>
        </thead>
        <tbody>
          {LEVELS.filter((level) => level <= rules.topLevel).map((level) => {
            const current = owner !== null && property?.level === level;
            const cost = getTileBuildCost(index, level, rule, board);
            return (
              <tr
                key={level}
                data-current={current}
                aria-current={current ? "true" : undefined}
              >
                <th scope="row">
                  {levelName(level)}
                  {current && (
                    <span className="city-card-now">{t("actuel", "now")}</span>
                  )}
                </th>
                <td>{level === 0 ? money(cost) : `+${money(cost)}`}</td>
                <td data-muted={boost !== null && level < 5}>
                  {money(getTileBaseRent(index, level, rule, board))}
                </td>
                <td className="city-card-boosted">
                  {money(
                    owner === null
                      ? previewPropertyRent(
                          state,
                          index,
                          seat ?? state.activeSeat,
                          level,
                        )
                      : propertyRentAt(state, index, level),
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="city-card-note">
        {rules.rentModifiers === "additive"
          ? t(
              `Rachat : deux fois l’investissement, sauf les hôtels protégés. Festival, pays complet et championnat additionnent leurs bonus, jusqu’à ×${rules.maxRentMultiplier}.`,
              `Buyout: twice the investment, except protected Hotels. Festival, full-country and Championship bonuses add together, up to ×${rules.maxRentMultiplier}.`,
            )
          : t(
              "Rachat : deux fois l’investissement. Seul le plus grand bonus de festival, de pays complet ou de championnat s’applique. Les monuments sont protégés et ne reçoivent aucun bonus.",
              "Buyout: twice the investment. Only the largest Festival, full-country or Championship bonus applies. Landmarks are protected and receive no bonus.",
            )}
      </p>
    </div>
  );
}

function ResortDeed({
  state,
  seat,
  index,
}: {
  state: PublicState;
  seat: Seat | null;
  index: number;
}) {
  const owner = getProperty(state, index)?.owner ?? null;
  const rules = ruleEconomy(economyRule(state.config));
  const boost = rentBoost(state, index);
  const count =
    owner === null ? null : Math.min(3, Math.max(1, resortCount(state, owner)));
  const items =
    owner === null
      ? [
          {
            label: t("Prix d’achat", "Price"),
            value: money(tilePrice(index, state) ?? 0),
            main: true,
          },
          {
            label: t("Loyer juste après l’achat", "Rent right after buying"),
            value: money(
              previewPropertyRent(state, index, seat ?? state.activeSeat, 0),
            ),
          },
        ]
      : [
          {
            label: rentLabel(owner, seat),
            value: money(propertyRent(state, index)),
            main: true,
          },
          {
            label: t("Prix de rachat", "Buyout price"),
            value: t("Impossible", "Not allowed"),
          },
        ];
  return (
    <div className="city-card-deed">
      <Ledger items={items} />
      <table className="city-card-table" style={{ borderTopColor: "#52aab8" }}>
        <caption>
          {t(
            "Loyer selon les plages du propriétaire",
            "Rent by resorts the owner holds",
          )}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("Plages possédées", "Resorts owned")}</th>
            <th scope="col">{t("Loyer de base", "Base rent")}</th>
            {boost && (
              <th scope="col" className="city-card-boosted">
                {boostLabel(boost)}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {RESORT_COUNTS.map((resorts) => {
            const current = count === resorts;
            return (
              <tr
                key={resorts}
                data-current={current}
                aria-current={current ? "true" : undefined}
              >
                <th scope="row">
                  {resorts === 1
                    ? t("1 plage", "1 resort")
                    : resorts === 2
                      ? t("2 plages", "2 resorts")
                      : t("3 plages ou plus", "3 resorts or more")}
                  {current && (
                    <span className="city-card-now">{t("actuel", "now")}</span>
                  )}
                </th>
                <td>{money(rules.resortRents[resorts])}</td>
                {boost && (
                  <td className="city-card-boosted">
                    {money(rules.resortRents[resorts] * boost.multiplier)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="city-card-note">
        {resortFestivals(state.config)
          ? t(
              "Les plages n’ont ni constructions ni rachat. Leur loyer dépend du nombre de plages du propriétaire ; un festival peut le multiplier.",
              "Resorts have no buildings or buyout. Rent depends on the owner’s resort count; a Festival can multiply it.",
            )
          : t(
              "Les plages n’ont ni constructions, ni festival, ni rachat. Leur loyer dépend du nombre de plages du propriétaire.",
              "Resorts have no buildings, Festival or buyout. Rent depends on the owner’s resort count.",
            )}
      </p>
    </div>
  );
}

function SpaceRule({ state, index }: { state: PublicState; index: number }) {
  const host = state.championshipHost;
  const rules = ruleEconomy(economyRule(state.config));
  const text = (() => {
    switch (getBoard(state.config)[index].kind) {
      case "start":
        return t(
          `Recevez ${money(state.config.startSalary)} en passant par le départ.`,
          `Receive ${money(state.config.startSalary)} when passing Start.`,
        );
      case "island":
        return t(
          `Un double ou le paiement de ${money(rules.islandReleaseFee)} vous permet de repartir. Vous êtes libéré après ${rules.islandMaxFailedEscapes} lancers ratés.`,
          `Roll doubles or pay ${money(rules.islandReleaseFee)} to leave. You are released after ${rules.islandMaxFailedEscapes} failed rolls.`,
        );
      case "championship":
        return rules.championshipFee > 0
          ? t(
              `Organisez le championnat dans une de vos villes : ${money(rules.championshipFee)} pour le déplacer, gratuit pour le renouveler. Chaque édition augmente son multiplicateur, jusqu’à ×${rules.maxHostMultiplier}.`,
              `Host the Championship in one of your cities: ${money(rules.championshipFee)} to move it, free to renew. Each edition increases its multiplier, up to ×${rules.maxHostMultiplier}.`,
            )
          : t(
              `Organisez gratuitement le championnat dans une de vos villes éligibles pour multiplier son loyer jusqu’à ×${rules.maxHostMultiplier}.`,
              `Host the Championship for free in an eligible city to multiply its rent up to ×${rules.maxHostMultiplier}.`,
            );
      case "world-tour":
        if (!rules.travelToFreeProperties)
          return t(
            `Au prochain tour, voyagez pour ${money(ECONOMY.worldTourFee)} vers une case libre, une de vos propriétés ou le départ, ou lancez les dés gratuitement.`,
            `On your next turn, travel for ${money(ECONOMY.worldTourFee)} to an unowned space, one of your properties or Start, or roll for free.`,
          );
        return worldTourRule(state.config) === "free-and-own"
          ? t(
              `Au prochain tour, voyagez pour ${money(ECONOMY.worldTourFee)} vers une propriété libre ou l’une des vôtres. Vous pouvez aussi lancer les dés gratuitement.`,
              `On your next turn, travel for ${money(ECONOMY.worldTourFee)} to an unowned property or one of your own. You may also roll for free.`,
            )
          : t(
              `Au prochain tour, voyagez pour ${money(ECONOMY.worldTourFee)} vers une propriété libre, ou vers vos propriétés si aucune n’est libre. Vous pouvez aussi lancer les dés gratuitement.`,
              `On your next turn, travel for ${money(ECONOMY.worldTourFee)} to an unowned property, or one of your properties when none is free. You may also roll for free.`,
            );
      case "chance":
        return t(
          "Piochez une carte. Fortune, voyage ou surprise au programme.",
          "Draw a card and follow its instructions.",
        );
      default:
        return t(
          `La taxe représente ${ECONOMY.taxPercent} % du montant investi dans vos propriétés${rules.minimumTax > 0 ? `, avec un minimum de ${money(rules.minimumTax)}` : ""}.`,
          `Tax is ${ECONOMY.taxPercent}% of the amount invested in your properties${rules.minimumTax > 0 ? `, with a ${money(rules.minimumTax)} minimum` : ""}.`,
        );
    }
  })();
  return (
    <div className="city-card-rule">
      <span
        className="city-card-rule-icon"
        style={{ backgroundColor: tileColor(index, state.config) }}
        aria-hidden="true"
      >
        {TILE_ICONS[getBoard(state.config)[index].kind]}
      </span>
      <p className="tile-rule">{text}</p>
      {getBoard(state.config)[index].kind === "championship" && host && (
        <p className="city-card-boost" data-source="championship">
          <span aria-hidden="true">★</span>
          {t(
            `En ce moment : ${tileName(host.tile, state.config)} · loyer ×${host.multiplier}`,
            `Now hosting: ${tileName(host.tile, state.config)} · rent ×${host.multiplier}`,
          )}
        </p>
      )}
    </div>
  );
}
