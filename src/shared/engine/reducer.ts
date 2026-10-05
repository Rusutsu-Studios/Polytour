import { ISLAND_TILE_INDEX } from "../board/index.js";
import type {
  GameEvent,
  GameState,
  PlayerState,
  PublicState,
  Seat,
} from "./types.js";

export function toPublic(state: GameState): PublicState {
  const {
    rngState: _rng,
    deck: _deck,
    discard: _discard,
    resolutionQueue: _queue,
    extraRoll: _extra,
    turnEnded: _ended,
    ...publicState
  } = state;
  return publicState;
}
function updatePlayer(
  state: PublicState,
  seat: Seat,
  update: (player: PlayerState) => PlayerState,
): PublicState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.seat === seat ? update(player) : player,
    ),
  };
}
function bankReceives(state: PublicState, amount: number) {
  return {
    bankLedger: state.bankLedger + amount,
    bankReceived: state.bankReceived + amount,
  };
}
function bankPays(state: PublicState, amount: number) {
  return {
    bankLedger: state.bankLedger - amount,
    bankPaidOut: state.bankPaidOut + amount,
  };
}
function cashChange(
  state: PublicState,
  seat: Seat,
  amount: number,
): PublicState {
  return updatePlayer(state, seat, (player) => ({
    ...player,
    cash: player.cash + amount,
  }));
}
function changeOwner(
  state: PublicState,
  tile: number,
  owner: Seat | null,
): PublicState {
  return {
    ...state,
    properties: state.properties.map((property) => {
      if (property.tile !== tile) return property;
      // A new owner, or the bank, restores power and drops the shield.
      const { powerCutUntilLap: _cut, shielded: _shield, ...rest } = property;
      return { ...rest, owner, level: owner === null ? 0 : property.level };
    }),
    players: state.players.map((player) => ({
      ...player,
      properties:
        player.seat === owner
          ? [...player.properties.filter((index) => index !== tile), tile].sort(
              (a, b) => a - b,
            )
          : player.properties.filter((index) => index !== tile),
    })),
  };
}
/** Reducer applies explicit event data only; it never calculates game rules. */
export function applyEvent(state: PublicState, event: GameEvent): PublicState {
  switch (event.type) {
    case "GameCreated":
      return event.state;
    case "PauseChanged":
      return {
        ...state,
        pause: event.pause,
        pauseCooldownUntil: event.pauseCooldownUntil,
      };
    case "GameResumed":
      return {
        ...state,
        pause: null,
        pending: event.pending,
        matchDeadline: event.matchDeadline,
      };
    case "DiceRolled":
      return {
        ...state,
        lastRoll: { seat: event.seat, dice: event.dice },
        doublesInTurn:
          event.purpose === "move" && event.isDouble
            ? state.doublesInTurn + 1
            : state.doublesInTurn,
      };
    case "PlayerMoved":
      return updatePlayer(state, event.seat, (player) => ({
        ...player,
        position: event.position,
        laps: event.laps,
      }));
    case "SalaryPaid":
      return {
        ...cashChange(state, event.seat, event.amount),
        ...bankPays(state, event.amount),
      };
    case "TurnPhaseChanged":
      return { ...state, phase: event.phase };
    case "DecisionOpened":
      return { ...state, pending: event.pending };
    case "DecisionClosed":
      return { ...state, pending: null };
    case "TurnAdvanced":
      return {
        ...state,
        activeSeat: event.activeSeat,
        round: event.round,
        roundSeatsRemaining: event.roundSeatsRemaining,
        phase: "roll",
        doublesInTurn: 0,
        pending: null,
      };
    case "SentToIsland":
      return updatePlayer(state, event.seat, (player) => ({
        ...player,
        position: ISLAND_TILE_INDEX,
        onIsland: true,
        islandTurns: 0,
        travelPending: false,
      }));
    case "IslandEscapeFailed":
      return updatePlayer(state, event.seat, (player) => ({
        ...player,
        islandTurns: event.islandTurns,
      }));
    case "LeftIsland":
      return updatePlayer(state, event.seat, (player) => ({
        ...player,
        onIsland: false,
        islandTurns: 0,
      }));
    case "TravelOptionChanged":
      return updatePlayer(state, event.seat, (player) => ({
        ...player,
        travelPending: event.available,
      }));
    case "PropertyBought": {
      const next = changeOwner(
        cashChange(state, event.seat, -event.amount),
        event.tile,
        event.seat,
      );
      return {
        ...next,
        bankLedger: state.bankLedger + event.amount,
        properties: next.properties.map((property) =>
          property.tile === event.tile
            ? { ...property, level: event.level }
            : property,
        ),
      };
    }
    case "PropertyUpgraded":
      return {
        ...cashChange(state, event.seat, -event.amount),
        bankLedger: state.bankLedger + event.amount,
        properties: state.properties.map((property) =>
          property.tile === event.tile
            ? { ...property, level: event.level }
            : property,
        ),
      };
    case "PropertySold":
      return {
        ...changeOwner(
          cashChange(state, event.seat, event.amount),
          event.tile,
          null,
        ),
        bankLedger: state.bankLedger - event.amount,
      };
    case "BoughtOut":
      return changeOwner(
        cashChange(
          cashChange(state, event.seat, -event.amount),
          event.previousOwner,
          event.amount,
        ),
        event.tile,
        event.seat,
      );
    case "PurchaseUnaffordable":
      return state;
    case "RentPaid":
      return cashChange(
        cashChange(state, event.seat, -event.amount),
        event.owner,
        event.amount,
      );
    case "MoneyTransferred": {
      let next = state;
      if (event.from !== null)
        next = cashChange(next, event.from, -event.amount);
      if (event.to !== null) next = cashChange(next, event.to, event.amount);
      if (event.from === event.to) return next;
      if (event.to === null)
        return { ...next, ...bankReceives(state, event.amount) };
      if (event.from === null)
        return { ...next, ...bankPays(state, event.amount) };
      return next;
    }
    case "ChampionshipChanged":
      return { ...state, championshipHost: event.host };
    case "CardDrawn":
      return {
        ...updatePlayer(state, event.seat, (player) => ({
          ...player,
          heldCards:
            event.kept &&
            (event.card === "Guardian Angel" ||
              event.card === "Coupon" ||
              event.card === "Escape")
              ? [...player.heldCards, event.card]
              : player.heldCards,
        })),
        lastCard: { seat: event.seat, card: event.card },
      };
    case "CardUsed":
      return updatePlayer(state, event.seat, (player) => ({
        ...player,
        heldCards: player.heldCards.filter((card) => card !== event.card),
      }));
    case "PropertyDowngraded":
      return {
        ...state,
        properties: state.properties.map((property) =>
          property.tile === event.tile
            ? { ...property, level: event.level }
            : property,
        ),
      };
    case "ShieldRaised":
    case "ShieldBroken":
      return {
        ...state,
        properties: state.properties.map((property) => {
          if (property.tile !== event.tile) return property;
          const { shielded: _shield, ...rest } = property;
          return event.type === "ShieldRaised"
            ? { ...rest, shielded: true }
            : rest;
        }),
      };
    case "PropertyGiven":
      return changeOwner(state, event.tile, event.to);
    case "PowerCut":
      return {
        ...state,
        properties: state.properties.map((property) =>
          property.tile === event.tile
            ? { ...property, powerCutUntilLap: event.untilLap }
            : property,
        ),
      };
    case "PropertiesSwapped":
      return changeOwner(
        changeOwner(state, event.tile, event.otherSeat),
        event.otherTile,
        event.seat,
      );
    case "PlayerBankrupt": {
      let next = state;
      for (const property of state.properties)
        if (property.owner === event.seat)
          next = changeOwner(next, property.tile, null);
      next = updatePlayer(next, event.seat, (player) => ({
        ...player,
        cash: 0,
        bankrupt: true,
        heldCards: [],
        onIsland: false,
        islandTurns: 0,
        travelPending: false,
      }));
      return {
        ...next,
        bankLedger: state.bankLedger - event.writtenOff,
        turnOrder: event.turnOrder,
        roundSeatsRemaining: event.roundSeatsRemaining,
        eliminated: [...state.eliminated, event.seat],
      };
    }
    case "PlayerControlChanged":
      return updatePlayer(state, event.seat, (player) => ({
        ...player,
        name: event.name ?? player.name,
        control: event.control,
      }));
    case "GameOver":
      return {
        ...state,
        status: "finished",
        pending: null,
        pause: null,
        result: {
          winner: event.winner,
          kind: event.kind,
          standings: event.standings,
        },
      };
  }
}
