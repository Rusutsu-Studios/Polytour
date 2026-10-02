import { CHANCE_AMOUNTS } from "../../shared/board/index.js";
import type {
  ChanceCard,
  GameEvent,
  PublicState,
} from "../../shared/engine/index.js";
import { translate as t } from "../i18n.js";
import { money } from "./board-display.js";

export const CARD_NAMES: Record<ChanceCard, string> = {
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
const ENGLISH_CARD_NAMES: Record<ChanceCard, string> = {
  "Grand Tour": "Grand Tour",
  Stranded: "Stranded",
  "Jet Set": "Jet Set",
  "Stadium Call": "Festival invitation",
  Windfall: "Windfall",
  "Parking Fine": "Parking fine",
  Birthday: "Birthday",
  Audit: "Tax audit",
  "Guardian Angel": "Guardian angel",
  Coupon: "Rent coupon",
  Earthquake: "Earthquake",
  "Land Swap": "Land swap",
  Detour: "Detour",
  Contractor: "Contractor",
  Jailbreak: "Jailbreak",
  Charity: "Charity",
};
export function cardName(card: ChanceCard): string {
  return t(CARD_NAMES[card], ENGLISH_CARD_NAMES[card]);
}
export type CardDraw = Extract<GameEvent, { type: "CardDrawn" }>;
export type CardPresentation = {
  title: string;
  text: string;
  badge: string;
  art: "fortune" | "travel" | "city";
  tone: "gain" | "cost" | "travel" | "keep";
};

/** Card copy reads the same amounts as the engine; it never applies an effect. */
export function describeCard(
  event: CardDraw,
  state: PublicState,
): CardPresentation {
  const base = {
    title: cardName(event.card),
    art: "fortune" as const,
    tone: "gain" as const,
  };
  switch (event.card) {
    case "Grand Tour":
      return {
        ...base,
        art: "travel",
        tone: "travel",
        badge: t("Retour au départ", "Back to Start"),
        text: t(
          `Rejoignez le Grand départ. Le salaire de ${money(state.config.startSalary)} est versé si vous le franchissez.`,
          `Move to Start. Collect ${money(state.config.startSalary)} salary if you pass it.`,
        ),
      };
    case "Stranded":
      return {
        ...base,
        art: "travel",
        tone: "cost",
        badge: t("Escale sur l’île", "Go to the Island"),
        text: t(
          "Rejoignez l’Île paisible. Repartez avec un double, en payant la traversée ou avec une libération.",
          "Move to the Island. Leave by rolling doubles, paying the fare or being released.",
        ),
      };
    case "Jet Set":
      return {
        ...base,
        art: "travel",
        tone: "travel",
        badge: t("Tour du monde", "World tour"),
        text: t(
          "Rejoignez le Tour du monde. À votre prochain tour, choisissez une destination.",
          "Move to World tour. On your next turn, choose a destination.",
        ),
      };
    case "Stadium Call":
      return {
        ...base,
        art: "city",
        tone: "travel",
        badge: t("Direction le festival", "Go to the Festival"),
        text: t(
          `Rejoignez le Festival. Une ville éligible, hors monuments, peut l’accueillir : son loyer sera multiplié jusqu’à ×${CHANCE_AMOUNTS.maxHostMultiplier}.`,
          `Move to the Festival. An eligible city without a landmark can host it, multiplying its rent up to ×${CHANCE_AMOUNTS.maxHostMultiplier}.`,
        ),
      };
    case "Windfall":
      return {
        ...base,
        badge: `+ ${money(CHANCE_AMOUNTS.windfall)}`,
        text: t(
          "La banque vous verse cette somme.",
          "Collect this amount from the bank.",
        ),
      };
    case "Parking Fine":
      return {
        ...base,
        tone: "cost",
        badge: `− ${money(CHANCE_AMOUNTS.fine)}`,
        text: t(
          "Réglez cette amende de stationnement à la banque.",
          "Pay this parking fine to the bank.",
        ),
      };
    case "Birthday":
      return {
        ...base,
        badge: t(
          `${money(CHANCE_AMOUNTS.birthday)} par adversaire`,
          `${money(CHANCE_AMOUNTS.birthday)} from each opponent`,
        ),
        text: t(
          "Chaque adversaire encore en jeu vous offre cette somme, selon les règles de cadeaux de la salle.",
          "Each opponent still in the game gives you this amount, subject to the room’s gift rules.",
        ),
      };
    case "Audit":
      return {
        ...base,
        tone: "cost",
        badge: t(
          `${CHANCE_AMOUNTS.auditPercent} % de votre cash`,
          `${CHANCE_AMOUNTS.auditPercent}% of your cash`,
        ),
        text: t(
          "Payez à la banque cette part de votre trésorerie positive.",
          "Pay this share of your positive cash balance to the bank.",
        ),
      };
    case "Guardian Angel":
      return {
        ...base,
        tone: "keep",
        badge: event.kept
          ? t("Gardez cette carte", "Keep this card")
          : t("Déjà dans votre main", "Already in your hand"),
        text: event.kept
          ? t(
              "Au prochain loyer, vous pourrez jouer cette carte pour ne rien payer.",
              "Play this card when rent is due to pay nothing.",
            )
          : t(
              "Vous possédez déjà cette protection. Ce doublon ne rejoint pas votre main.",
              "You already have this protection. The duplicate is not added to your hand.",
            ),
      };
    case "Coupon":
      return {
        ...base,
        tone: "keep",
        badge: event.kept
          ? t("Loyer réduit de moitié", "Half-price rent")
          : t("Déjà dans votre main", "Already in your hand"),
        text: event.kept
          ? t(
              "Gardez ce bon : vous pourrez l’utiliser pour diviser un futur loyer par deux.",
              "Keep this coupon to halve a future rent payment.",
            )
          : t(
              "Vous possédez déjà ce bon. Ce doublon ne rejoint pas votre main.",
              "You already have this coupon. The duplicate is not added to your hand.",
            ),
      };
    case "Earthquake":
      return {
        ...base,
        art: "city",
        tone: "cost",
        badge: t("Un bâtiment en moins", "Remove one building level"),
        text: t(
          "Si une ville adverse est éligible, choisissez-la pour retirer un niveau de construction. Les monuments sont protégés.",
          "Choose an eligible opponent’s city to remove one building level. Landmarks are protected.",
        ),
      };
    case "Land Swap":
      return {
        ...base,
        art: "city",
        tone: "travel",
        badge: t("Échange de propriétés", "Swap properties"),
        text: t(
          "Votre ville éligible la moins chère peut être échangée contre une ville adverse de prix égal ou inférieur, hors monuments.",
          "Swap your cheapest eligible city for an opponent’s city of equal or lower land price. Landmarks are excluded.",
        ),
      };
    case "Detour":
      return {
        ...base,
        art: "travel",
        tone: "travel",
        badge: t(
          `Reculez de ${CHANCE_AMOUNTS.detourSteps} cases`,
          `Move back ${CHANCE_AMOUNTS.detourSteps} spaces`,
        ),
        text: t(
          "Reculez, puis appliquez l’effet de votre nouvelle case.",
          "Move back, then resolve the space you land on.",
        ),
      };
    case "Contractor":
      return {
        ...base,
        art: "city",
        badge: t("Une construction offerte", "One free building level"),
        text: t(
          "Si une de vos villes est éligible, choisissez-la pour recevoir un niveau de construction gratuit.",
          "Choose one of your eligible cities to add one building level for free.",
        ),
      };
    case "Jailbreak":
      return {
        ...base,
        art: "travel",
        tone: "travel",
        badge: t("Tout le monde repart", "Everyone is released"),
        text: t(
          "Tous les joueurs présents sur l’Île paisible sont libérés. Ils repartent à leur tour.",
          "All players on the Island are released. They move again on their next turn.",
        ),
      };
    case "Charity":
      return {
        ...base,
        tone: "cost",
        badge: `− ${money(CHANCE_AMOUNTS.charity)}`,
        text: t(
          "Vous offrez cette somme à l’adversaire encore en jeu qui possède le moins de cash, selon les règles de cadeaux de la salle.",
          "Give this amount to the opponent still in the game with the least cash, subject to the room’s gift rules.",
        ),
      };
  }
}
