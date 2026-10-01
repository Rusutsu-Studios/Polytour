import { CHANCE_AMOUNTS } from "../../shared/board/index.js";
import type {
  ChanceCard,
  GameEvent,
  PublicState,
} from "../../shared/engine/index.js";
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
    title: CARD_NAMES[event.card],
    art: "fortune" as const,
    tone: "gain" as const,
  };
  switch (event.card) {
    case "Grand Tour":
      return {
        ...base,
        art: "travel",
        tone: "travel",
        badge: "Retour au départ",
        text: `Rejoignez le Grand départ. Le salaire de ${money(state.config.startSalary)} est versé si vous le franchissez.`,
      };
    case "Stranded":
      return {
        ...base,
        art: "travel",
        tone: "cost",
        badge: "Escale sur l’île",
        text: "Votre voyage s’arrête sur l’Île paisible. Un double, une traversée payante ou une libération vous permettra de repartir.",
      };
    case "Jet Set":
      return {
        ...base,
        art: "travel",
        tone: "travel",
        badge: "Grand voyage",
        text: "Direction le Grand voyage. À votre prochain tour, vous pourrez choisir une destination.",
      };
    case "Stadium Call":
      return {
        ...base,
        art: "city",
        tone: "travel",
        badge: "Direction le festival",
        text: `Rejoignez le Festival. Une ville éligible, hors monuments, peut l’accueillir : son loyer sera multiplié jusqu’à ×${CHANCE_AMOUNTS.maxHostMultiplier}.`,
      };
    case "Windfall":
      return {
        ...base,
        badge: `+ ${money(CHANCE_AMOUNTS.windfall)}`,
        text: "Une bonne nouvelle pour votre trésorerie : la banque vous verse cette somme.",
      };
    case "Parking Fine":
      return {
        ...base,
        tone: "cost",
        badge: `− ${money(CHANCE_AMOUNTS.fine)}`,
        text: "Mauvais stationnement… Réglez cette amende à la banque.",
      };
    case "Birthday":
      return {
        ...base,
        badge: `${money(CHANCE_AMOUNTS.birthday)} par adversaire`,
        text: "Bon anniversaire ! Chaque adversaire encore en jeu vous offre cette somme, selon les règles de cadeaux de la salle.",
      };
    case "Audit":
      return {
        ...base,
        tone: "cost",
        badge: `${CHANCE_AMOUNTS.auditPercent} % de votre cash`,
        text: "Le contrôle fiscal prélève cette part de votre trésorerie positive. La banque attend son paiement.",
      };
    case "Guardian Angel":
      return {
        ...base,
        tone: "keep",
        badge: event.kept ? "Gardez cette carte" : "Déjà dans votre main",
        text: event.kept
          ? "Au prochain loyer, vous pourrez jouer cette carte pour ne rien payer."
          : "Vous possédez déjà cette protection. Ce doublon ne rejoint pas votre main.",
      };
    case "Coupon":
      return {
        ...base,
        tone: "keep",
        badge: event.kept ? "Loyer réduit de moitié" : "Déjà dans votre main",
        text: event.kept
          ? "Gardez ce bon : vous pourrez l’utiliser pour diviser un futur loyer par deux."
          : "Vous possédez déjà ce bon. Ce doublon ne rejoint pas votre main.",
      };
    case "Earthquake":
      return {
        ...base,
        art: "city",
        tone: "cost",
        badge: "Un bâtiment en moins",
        text: "Si une ville adverse est éligible, choisissez-la pour retirer un niveau de construction. Les monuments sont protégés.",
      };
    case "Land Swap":
      return {
        ...base,
        art: "city",
        tone: "travel",
        badge: "Échange de propriétés",
        text: "Votre ville éligible la moins chère peut être échangée contre une ville adverse de prix égal ou inférieur, hors monuments.",
      };
    case "Detour":
      return {
        ...base,
        art: "travel",
        tone: "travel",
        badge: `Reculez de ${CHANCE_AMOUNTS.detourSteps} cases`,
        text: "La route est déviée. Reculez, puis appliquez l’effet de votre nouvelle case.",
      };
    case "Contractor":
      return {
        ...base,
        art: "city",
        badge: "Une construction offerte",
        text: "Si une de vos villes est éligible, choisissez-la pour recevoir un niveau de construction gratuit.",
      };
    case "Jailbreak":
      return {
        ...base,
        art: "travel",
        tone: "travel",
        badge: "Tout le monde repart",
        text: "Tous les joueurs présents sur l’Île paisible sont libérés. Leur voyage reprend à leur tour.",
      };
    case "Charity":
      return {
        ...base,
        tone: "cost",
        badge: `− ${money(CHANCE_AMOUNTS.charity)}`,
        text: "Vous offrez cette somme à l’adversaire encore en jeu qui possède le moins de cash, selon les règles de cadeaux de la salle.",
      };
  }
}
