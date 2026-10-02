import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  BOARD,
  type BuildLevel,
  getTileBaseRent,
  getTileBuildCost,
  getTileLandPrice,
  RESORT_RENTS,
} from "../../shared/board/index.js";
import {
  buyoutPrice,
  getProperty,
  type PublicState,
  propertyRent,
  propertyRentAt,
  type RentBoost,
  rentBoost,
  resortCount,
  type Seat,
} from "../../shared/engine/index.js";
import { useDirector } from "../director/director.js";
import { translate as t, useLocale } from "../i18n.js";
import {
  levelName,
  money,
  PLAYER_COLORS,
  PLAYER_SYMBOLS,
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
  onSelect,
  onClose,
}: {
  state: PublicState;
  seat: Seat;
  selected: number | null;
  onSelect: (tile: number) => void;
  onClose: () => void;
}) {
  // Subscribing here re-renders the whole card when the language changes.
  useLocale();
  const { reducedMotion, speed } = useDirector();
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
  const tile = BOARD[index];
  const property = getProperty(state, index);
  const owner =
    property?.owner != null
      ? state.players.find((player) => player.seat === property.owner)
      : null;
  const ownerColor = owner ? PLAYER_COLORS[owner.seat] : "#8fa38c";
  // The board wraps, so stepping past the last space returns to the first.
  const step = (delta: number) => onSelect((index + delta + 32) % 32);
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
        <h2 id="city-card-title">{tileName(index)}</h2>
      </div>
      <motion.section
        className="city-card"
        data-space={index}
        data-kind={tile.kind}
        initial={reducedMotion ? false : { opacity: 0.7, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.24 / speed }}
      >
        <div className="city-card-topline">
          <div className="city-card-steps">
            <button
              type="button"
              className="icon-button city-card-step"
              data-back="true"
              aria-label={t("Case précédente", "Previous space")}
              onClick={() => step(-1)}
            >
              <Icon name="arrow" size={16} />
            </button>
            <span className="city-card-place">
              <span
                className="city-card-kind"
                style={{ backgroundColor: tileColor(index) }}
                aria-hidden="true"
              >
                {TILE_ICONS[tile.kind]}
              </span>
              {t(`Case ${index + 1} / 32`, `Space ${index + 1} / 32`)}
            </span>
            <button
              type="button"
              className="icon-button city-card-step"
              aria-label={t("Case suivante", "Next space")}
              onClick={() => step(1)}
            >
              <Icon name="arrow" size={16} />
            </button>
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
                symbol={owner ? PLAYER_SYMBOLS[owner.seat] : undefined}
              />
              <p className="city-card-owner" data-owned={Boolean(owner)}>
                {owner ? (
                  <>
                    <span
                      className="city-card-pawn"
                      style={{ backgroundColor: ownerColor }}
                      aria-hidden="true"
                    >
                      {PLAYER_SYMBOLS[owner.seat]}
                    </span>
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
  return boost.source === "country"
    ? t(
        `Pays complet · loyer ×${boost.multiplier}`,
        `Full country · rent ×${boost.multiplier}`,
      )
    : t(
        `Festival · loyer ×${boost.multiplier}`,
        `Festival · rent ×${boost.multiplier}`,
      );
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

function rentLabel(owner: Seat | null, seat: Seat) {
  return owner === seat
    ? t("Loyer que vous touchez", "Rent you collect")
    : t("Loyer à payer ici", "Rent due here");
}

function CityDeed({
  state,
  seat,
  index,
}: {
  state: PublicState;
  seat: Seat;
  index: number;
}) {
  const tile = BOARD[index];
  const property = getProperty(state, index);
  const owner = property?.owner ?? null;
  const boost = rentBoost(state, index);
  const buyout = buyoutPrice(state, index);
  const items =
    owner === null
      ? [
          {
            label: t("Prix d’achat du terrain", "Land price"),
            value: money(getTileLandPrice(index)),
            main: true,
          },
          {
            label: t("Loyer juste après l’achat", "Rent right after buying"),
            value: money(propertyRentAt(state, index, 0)),
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
            <th scope="col">
              {boost ? t("Loyer de base", "Base rent") : t("Loyer", "Rent")}
            </th>
            {boost && (
              <th scope="col" className="city-card-boosted">
                {boost.source === "country"
                  ? t(
                      `Pays ×${boost.multiplier}`,
                      `Country ×${boost.multiplier}`,
                    )
                  : t(
                      `Festival ×${boost.multiplier}`,
                      `Festival ×${boost.multiplier}`,
                    )}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {LEVELS.map((level) => {
            const current = owner !== null && property?.level === level;
            const cost = getTileBuildCost(index, level);
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
                  {money(getTileBaseRent(index, level))}
                </td>
                {boost && (
                  <td className="city-card-boosted">
                    {money(propertyRentAt(state, index, level))}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="city-card-note">
        {t(
          "Rachat : deux fois ce qui a été investi. Les bonus de festival et de pays complet ne se cumulent pas et ne s’appliquent pas au monument, qui ne peut pas être racheté.",
          "Buyout: twice what was invested. Festival and full-country bonuses do not stack and never apply to a landmark, which cannot be bought out.",
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
  seat: Seat;
  index: number;
}) {
  const owner = getProperty(state, index)?.owner ?? null;
  const count =
    owner === null ? null : Math.min(3, Math.max(1, resortCount(state, owner)));
  const items =
    owner === null
      ? [
          {
            label: t("Prix d’achat", "Price"),
            value: money(tilePrice(index) ?? 0),
            main: true,
          },
          {
            label: t("Loyer juste après l’achat", "Rent right after buying"),
            value: money(propertyRent(state, index)),
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
            <th scope="col">{t("Loyer", "Rent")}</th>
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
                <td>{money(RESORT_RENTS[resorts])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="city-card-note">
        {t(
          "Une plage ne se construit pas : son loyer grandit avec le nombre de plages de son propriétaire. Pas de festival ni de rachat sur une plage.",
          "Resorts take no buildings: their rent grows with the number of resorts the owner holds. No festival and no buyout on a resort.",
        )}
      </p>
    </div>
  );
}

function SpaceRule({ state, index }: { state: PublicState; index: number }) {
  const host = state.championshipHost;
  const text = (() => {
    switch (BOARD[index].kind) {
      case "start":
        return t(
          `Recevez ${money(state.config.startSalary)} en passant par le départ.`,
          `Receive ${money(state.config.startSalary)} when passing Start.`,
        );
      case "island":
        return t(
          "Un double ou le paiement de la traversée vous permet de repartir.",
          "Roll doubles or pay the fare to leave.",
        );
      case "championship":
        return t(
          "Installez un festival dans l’une de vos villes pour multiplier ses loyers.",
          "Host a festival in one of your cities to multiply its rent.",
        );
      case "world-tour":
        return t(
          "Au prochain tour, choisissez une destination plutôt que de lancer les dés.",
          "On your next turn, choose a destination instead of rolling.",
        );
      case "chance":
        return t(
          "Piochez une carte. Fortune, voyage ou surprise au programme.",
          "Draw a card and follow its instructions.",
        );
      default:
        return t(
          "La taxe est calculée selon votre fortune.",
          "Tax is based on your net worth.",
        );
    }
  })();
  return (
    <div className="city-card-rule">
      <span
        className="city-card-rule-icon"
        style={{ backgroundColor: tileColor(index) }}
        aria-hidden="true"
      >
        {TILE_ICONS[BOARD[index].kind]}
      </span>
      <p className="tile-rule">{text}</p>
      {BOARD[index].kind === "championship" && host && (
        <p className="city-card-boost" data-source="championship">
          <span aria-hidden="true">★</span>
          {t(
            `En ce moment : ${tileName(host.tile)} · loyer ×${host.multiplier}`,
            `Now hosting: ${tileName(host.tile)} · rent ×${host.multiplier}`,
          )}
        </p>
      )}
    </div>
  );
}
