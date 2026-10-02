import type { CSSProperties } from "react";
import {
  BOARD,
  CHANCE_AMOUNTS,
  COUNTRY_IDS,
  getCountryCityTiles,
  isResortTile,
} from "../../shared/board/index.js";
import {
  getProperty,
  type PublicState,
  propertyOwner,
  propertyRent,
  type Seat,
} from "../../shared/engine/index.js";
import { useLocale } from "../i18n.js";
import {
  levelName,
  money,
  PLAYER_COLORS,
  PLAYER_SYMBOLS,
  REGION_COLORS,
  tileName,
  tilePrice,
} from "./board-display.js";
import "./OwnershipPanel.css";

export type OwnershipPanelProps = {
  state: PublicState;
  seat: Seat;
  onInspect: (tile: number) => void;
};
type Group = {
  readonly key: string;
  readonly rank: number;
  readonly color: string;
  readonly tiles: readonly number[];
  readonly resorts: boolean;
};
const RESORT_COLOR = "#52aab8";
const GROUPS: readonly Group[] = [
  ...COUNTRY_IDS.map((country, rank) => ({
    key: country,
    rank: rank + 1,
    color: REGION_COLORS[country],
    tiles: getCountryCityTiles(country).map((tile) => tile.index),
    resorts: false,
  })),
  {
    key: "resorts",
    rank: 0,
    color: RESORT_COLOR,
    tiles: BOARD.filter(isResortTile).map((tile) => tile.index),
    resorts: true,
  },
];

/** Who holds each tile of one group, in seat order, plus what is still free. */
function groupHoldings(state: PublicState, tiles: readonly number[]) {
  const held = new Map<Seat, number>();
  let free = 0;
  for (const tile of tiles) {
    const owner = propertyOwner(state, tile);
    if (owner === null) free += 1;
    else held.set(owner, (held.get(owner) ?? 0) + 1);
  }
  const owners = [...held.entries()].sort(([a], [b]) => a - b);
  return {
    free,
    owners,
    sweep: free === 0 && owners.length === 1 ? owners[0][0] : null,
  };
}

export default function OwnershipPanel({
  state,
  seat,
  onInspect,
}: OwnershipPanelProps) {
  const { t } = useLocale();
  const hosting = (tile: number) =>
    state.championshipHost?.tile === tile || state.festivalTiles.includes(tile);
  return (
    <div className="ownership-board">
      <ul className="ownership-tally">
        {state.players.map((player) => {
          const cities = player.properties.filter(
            (tile) => BOARD[tile].kind === "city",
          ).length;
          const resorts = player.properties.length - cities;
          const sets = COUNTRY_IDS.filter((country) =>
            getCountryCityTiles(country).every(
              (tile) => propertyOwner(state, tile.index) === player.seat,
            ),
          ).length;
          return (
            <li
              key={player.seat}
              data-you={player.seat === seat}
              data-bankrupt={player.bankrupt}
              style={
                {
                  "--player-color": PLAYER_COLORS[player.seat],
                } as CSSProperties
              }
            >
              <span className="tally-name">
                <span aria-hidden="true">{PLAYER_SYMBOLS[player.seat]}</span>{" "}
                {player.name}
              </span>
              <span className="tally-counts">
                {t(
                  `${cities} ville${cities > 1 ? "s" : ""}`,
                  `${cities} ${cities === 1 ? "city" : "cities"}`,
                )}
                {resorts > 0 &&
                  ` · ${t(
                    `${resorts} station${resorts > 1 ? "s" : ""}`,
                    `${resorts} resort${resorts === 1 ? "" : "s"}`,
                  )}`}
                {sets > 0 &&
                  ` · ${t(
                    `${sets} région${sets > 1 ? "s" : ""} complète${sets > 1 ? "s" : ""}`,
                    `${sets} full ${sets === 1 ? "region" : "regions"}`,
                  )}`}
              </span>
            </li>
          );
        })}
      </ul>
      {GROUPS.map((group) => {
        const { free, owners, sweep } = groupHoldings(state, group.tiles);
        return (
          <section
            key={group.key}
            className="ownership-group"
            aria-label={group.tiles.map(tileName).join(", ")}
            style={{ "--region-color": group.color } as CSSProperties}
          >
            <header className="ownership-group-head">
              <span className="group-swatch" aria-hidden="true" />
              <span className="group-label">
                {group.resorts
                  ? t("Stations", "Resorts")
                  : t(`Région ${group.rank}`, `Region ${group.rank}`)}
              </span>
              <span className="group-owners">
                {owners.map(([owner, count]) => (
                  <span
                    key={owner}
                    style={{ color: PLAYER_COLORS[owner] }}
                    title={
                      state.players.find((player) => player.seat === owner)
                        ?.name
                    }
                  >
                    {PLAYER_SYMBOLS[owner]}
                    {count > 1 && `×${count}`}
                  </span>
                ))}
                {free > 0 && (
                  <span className="group-free">
                    {t(`${free} libre${free > 1 ? "s" : ""}`, `${free} free`)}
                  </span>
                )}
              </span>
            </header>
            {sweep !== null && !group.resorts && (
              <p className="group-sweep">
                {t(
                  `Région complète · loyers ×${CHANCE_AMOUNTS.countryMultiplier}`,
                  `Full region · rent ×${CHANCE_AMOUNTS.countryMultiplier}`,
                )}
              </p>
            )}
            <ul className="ownership-rows">
              {group.tiles.map((tile) => {
                const property = getProperty(state, tile);
                const owner =
                  property?.owner != null
                    ? state.players.find(
                        (player) => player.seat === property.owner,
                      )
                    : undefined;
                return (
                  <li key={tile}>
                    <button
                      type="button"
                      className="ownership-row"
                      data-free={owner === undefined}
                      style={
                        owner
                          ? ({
                              "--player-color": PLAYER_COLORS[owner.seat],
                            } as CSSProperties)
                          : undefined
                      }
                      onClick={() => onInspect(tile)}
                    >
                      <span className="row-pin" aria-hidden="true" />
                      <span className="row-main">
                        <span className="row-name">
                          {tileName(tile)}
                          {hosting(tile) && (
                            <span
                              className="row-festival"
                              title={t("Festival", "Festival")}
                            >
                              ★
                            </span>
                          )}
                        </span>
                        <span className="row-owner">
                          {owner ? (
                            <>
                              <span aria-hidden="true">
                                {PLAYER_SYMBOLS[owner.seat]}
                              </span>{" "}
                              {owner.name}
                              {!group.resorts &&
                                ` · ${levelName(property?.level ?? 0)}`}
                            </>
                          ) : (
                            t("Libre", "Unowned")
                          )}
                        </span>
                      </span>
                      <span className="row-value">
                        <b>
                          {money(
                            owner
                              ? propertyRent(state, tile)
                              : (tilePrice(tile) ?? 0),
                          )}
                        </b>
                        <small>
                          {owner
                            ? t("loyer", "rent")
                            : t("à l’achat", "to buy")}
                        </small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
