import { BOARD } from "../../shared/board/index.js";
import {
  getProperty,
  type PublicState,
  propertyRent,
} from "../../shared/engine/index.js";
import { translate as t } from "../i18n.js";
import {
  levelName,
  money,
  PLAYER_COLORS,
  PLAYER_SYMBOLS,
  TILE_ICONS,
  tileColor,
  tileName,
  tilePrice,
} from "./board-display.js";
import CityIllustration from "./CityIllustration.js";
import Icon from "./Icon.js";
import "./CityCard.css";

// Inspecting a space answers one question — who owns this city — so it shows
// the same title deed the buy popup does, not a list of every space.
function tileRule(state: PublicState, index: number) {
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
}

export default function CityCard({
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
  const festival =
    state.championshipHost?.tile === index
      ? state.championshipHost.multiplier
      : state.festivalTiles.includes(index)
        ? 2
        : null;
  const ownerColor = owner ? PLAYER_COLORS[owner.seat] : "#8fa38c";
  // The board wraps, so stepping past the last space returns to the first.
  const step = (delta: number) => onSelect((index + delta + 32) % 32);
  return (
    <section
      className="city-card"
      data-space={index}
      aria-labelledby="city-card-title"
    >
      <div className="city-card-ribbon">
        <h3 id="city-card-title">{tileName(index)}</h3>
      </div>
      <div className="city-card-body">
        <div className="city-card-steps">
          <button
            type="button"
            className="icon-button city-card-step"
            data-back="true"
            aria-label={t("Case précédente", "Previous space")}
            onClick={() => step(-1)}
          >
            <Icon name="arrow" size={15} />
          </button>
          <span className="small-label">
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
            <Icon name="arrow" size={15} />
          </button>
        </div>

        {property ? (
          <>
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
                    <strong>{owner.name}</strong>
                    <small>{levelName(property.level)}</small>
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
            <dl className="city-card-ledger">
              <div>
                <dt>{t("Terrain", "Land")}</dt>
                <dd>{money(tilePrice(index) ?? 0)}</dd>
              </div>
              <div className="ledger-main">
                <dt>
                  {owner
                    ? t("Loyer actuel", "Current rent")
                    : t("Loyer terrain", "Base rent")}
                </dt>
                <dd>{money(rent ?? 0)}</dd>
              </div>
            </dl>
            {festival !== null && (
              <p className="festival-badge">
                {t("★ Festival · loyer ×", "★ Festival · rent ×")}
                {festival}
              </p>
            )}
          </>
        ) : (
          <p className="tile-rule">{tileRule(state, index)}</p>
        )}
      </div>
    </section>
  );
}
