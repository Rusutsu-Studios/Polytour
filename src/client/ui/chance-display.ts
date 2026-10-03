import {
  CHANCE_AMOUNTS,
  ECONOMY,
  ruleEconomy,
} from "../../shared/board/index.js";
import {
  type ChanceCard,
  economyRule,
  type GameConfig,
  type GameEvent,
  type PublicState,
} from "../../shared/engine/index.js";
import { translate as t } from "../i18n.js";
import { money } from "./board-display.js";

export const CARD_NAMES: Record<ChanceCard, string> = {
  "Grand Tour": "Grand tour",
  Stranded: "Naufrage",
  "Jet Set": "Jet-set",
  "Stadium Call": "Direction le championnat",
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
  "Stadium Call": "Championship call",
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

/** Extra rules for reference browsing, without exposing the private deck order. */
export function describeChanceCardDetails(
  card: ChanceCard,
  config: GameConfig,
): readonly string[] {
  const rules = ruleEconomy(economyRule(config));
  const noTarget = t(
    "Sans cible éligible, la carte est défaussée sans effet.",
    "If there is no eligible target, the card is discarded without effect.",
  );
  const gifts =
    config.giftCanBankrupt === false
      ? t(
          "Dans cette salle, chaque cadeau est limité au cash disponible du joueur qui paie : il ne provoque ni vente ni faillite.",
          "In this room, each gift is capped at the payer’s available cash: it cannot force a sale or bankruptcy.",
        )
      : t(
          "Dans cette salle, ce paiement peut obliger le joueur à vendre des propriétés ou entraîner sa faillite.",
          "In this room, this payment can force the payer to sell properties or go bankrupt.",
        );
  switch (card) {
    case "Grand Tour":
      return [
        t(
          "Le trajet suit le plateau dans le sens du jeu et compte un tour complet. Il ne donne pas de lancer supplémentaire sur un double.",
          "Move clockwise and complete a lap. This move does not grant another roll for doubles.",
        ),
      ];
    case "Stranded":
      return [
        t(
          `Ce transfert termine votre tour, sans salaire ni tour complet. La traversée coûte ${money(rules.islandReleaseFee)} ; vous êtes aussi libéré après ${rules.islandMaxFailedEscapes} tentatives de double ratées.`,
          `This transfer ends your turn, without salary or lap credit. The fare is ${money(rules.islandReleaseFee)}; you are also released after ${rules.islandMaxFailedEscapes} failed doubles attempts.`,
        ),
      ];
    case "Jet Set":
      return [
        t(
          `Le trajet suit le sens du jeu : franchir le départ rapporte ${money(config.startSalary)} et compte un tour. Au prochain tour, un vol coûte ${money(ECONOMY.worldTourFee)} ; vous pouvez aussi lancer les dés normalement.`,
          `Move clockwise: passing Start pays ${money(config.startSalary)} and counts a lap. On your next turn, a flight costs ${money(ECONOMY.worldTourFee)}; you may also roll normally.`,
        ),
        rules.travelToFreeProperties
          ? t(
              "Le vol vise une propriété libre. S’il n’en reste aucune, choisissez une de vos propriétés.",
              "Fly to an unowned property. If none remain, choose one of your own properties.",
            )
          : t(
              "Le vol peut viser toute autre case du plateau.",
              "Fly to any other space on the board.",
            ),
      ];
    case "Stadium Call":
      return [
        t(
          `Le trajet suit le sens du jeu ; franchir le départ rapporte ${money(config.startSalary)} et compte un tour.`,
          `Move clockwise; passing Start pays ${money(config.startSalary)} and counts a lap.`,
        ),
        rules.championshipPersists
          ? t(
              "Vous pouvez refuser d’organiser le championnat. Son multiplicateur continue d’augmenter lorsqu’il change de ville et reste attaché à sa case si elle change de propriétaire.",
              "You may decline to host. Its multiplier keeps increasing when it moves to another city and stays on its space if ownership changes.",
            )
          : t(
              `Organisez gratuitement le championnat si vous avez une ville éligible. Le déplacer remet le multiplicateur à ×${CHANCE_AMOUNTS.initialHostMultiplier} ; un changement de propriétaire l’annule.`,
              `Host for free if you have an eligible city. Moving it resets the multiplier to ×${CHANCE_AMOUNTS.initialHostMultiplier}; an ownership change clears it.`,
            ),
        t(
          "Sans ville éligible, vous rejoignez tout de même le championnat, mais ne pouvez pas l’organiser.",
          "If you have no eligible city, you still move to the Championship but cannot host it.",
        ),
      ];
    case "Windfall":
      return [
        t(
          "Le versement est immédiat. Cette carte ne se conserve pas.",
          "The payment is immediate. You do not keep this card.",
        ),
      ];
    case "Parking Fine":
      return [
        t(
          "Si votre cash ne suffit pas, vendez des propriétés pour régler la dette. Une dette impossible à couvrir entraîne la faillite.",
          "If you lack cash, sell properties to cover the debt. A debt you cannot cover causes bankruptcy.",
        ),
      ];
    case "Birthday":
      return [gifts];
    case "Audit":
      return [
        t(
          "Le montant est arrondi à l’unité supérieure. Un cash nul ou négatif ne produit aucun paiement.",
          "The amount is rounded up to a whole unit. Zero or negative cash produces no charge.",
        ),
      ];
    case "Guardian Angel":
    case "Coupon":
      return [
        t(
          "Vous choisissez de la jouer lorsqu’un loyer est dû. Une seule carte peut être utilisée par paiement ; elle est ensuite défaussée. Vous ne pouvez garder qu’un exemplaire de chaque protection.",
          "Choose whether to play it when rent is due. Use at most one card per payment, then discard it. You may hold only one of each protection.",
        ),
        ...(card === "Coupon"
          ? [
              t(
                "Le loyer réduit est arrondi à l’unité supérieure.",
                "The reduced rent is rounded up to a whole unit.",
              ),
            ]
          : []),
      ];
    case "Earthquake":
      return [
        t(
          "Choisissez une ville adverse construite, hôtels compris. Les terrains nus et les stations sont exclus. Le niveau retiré n’est pas remboursé.",
          "Choose an opponent’s built city, including Hotels. Bare land and resorts are excluded. The removed level is not refunded.",
        ),
        noTarget,
      ];
    case "Land Swap":
      return [
        t(
          "Votre ville est choisie automatiquement selon le prix du terrain, sans ses bâtiments. Vous pouvez refuser l’échange. Les deux villes conservent leurs bâtiments ; les stations sont exclues.",
          "Your city is selected automatically by land price, excluding buildings. You may decline the swap. Both cities keep their buildings; resorts are excluded.",
        ),
        noTarget,
      ];
    case "Detour":
      return [
        t(
          "Même si vous traversez le départ à reculons, vous ne recevez pas de salaire et ne comptez pas de tour complet. Ce déplacement ne donne pas de lancer supplémentaire sur un double.",
          "Crossing Start backwards pays no salary and does not count a lap. This move does not grant another roll for doubles.",
        ),
      ];
    case "Contractor":
      return [
        config.hotelsDirectly === true
          ? t(
              "Le réglage hôtels directs autorise cette carte à construire jusqu’à l’hôtel, même avant votre premier tour complet.",
              "The direct Hotels setting lets this card build up to a Hotel, even before your first completed lap.",
            )
          : t(
              `Avant votre premier tour complet, la limite est de ${rules.firstLapHouseCap} maisons. Après un tour complet, cette carte peut offrir l’hôtel sans attendre un retour sur la ville.`,
              `Before your first completed lap, the limit is ${rules.firstLapHouseCap} houses. After a lap, this card can grant a Hotel without waiting to revisit the city.`,
            ),
        t(
          "Les stations, les hôtels et les monuments ne sont pas des cibles éligibles.",
          "Resorts, Hotels and Landmarks are not eligible targets.",
        ),
        noTarget,
      ];
    case "Jailbreak":
      return [
        t(
          "Les pions restent sur place. Sans joueur détenu, la carte n’a aucun effet.",
          "Pawns stay in place. If nobody is detained, the card has no effect.",
        ),
      ];
    case "Charity":
      return [
        t(
          "En cas d’égalité, le premier adversaire dans l’ordre des tours reçoit le cadeau.",
          "If cash balances are tied, the first opponent in turn order receives the gift.",
        ),
        gifts,
      ];
  }
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
  const card = describeChanceCard(event.card, state.config);
  if (
    (event.card === "Guardian Angel" || event.card === "Coupon") &&
    !event.kept
  ) {
    return {
      ...card,
      badge: t("Déjà dans votre main", "Already in your hand"),
      text:
        event.card === "Guardian Angel"
          ? t(
              "Vous possédez déjà cette protection. Ce doublon ne rejoint pas votre main.",
              "You already have this protection. The duplicate is not added to your hand.",
            )
          : t(
              "Vous possédez déjà ce bon. Ce doublon ne rejoint pas votre main.",
              "You already have this coupon. The duplicate is not added to your hand.",
            ),
    };
  }
  return card;
}

/** The catalogue and drawn cards share the room's frozen rules and amounts. */
export function describeChanceCard(
  card: ChanceCard,
  config: GameConfig,
): CardPresentation {
  const base = {
    title: cardName(card),
    art: "fortune" as const,
    tone: "gain" as const,
  };
  const rules = ruleEconomy(economyRule(config));
  // Landmarks guard prototype rooms; Hotels guard reference rooms from transfers.
  const reference = rules.topLevel === 4;
  switch (card) {
    case "Grand Tour":
      return {
        ...base,
        art: "travel",
        tone: "travel",
        badge: t("Retour au départ", "Back to Start"),
        text: t(
          `Rejoignez le Grand départ. Le salaire de ${money(config.startSalary)} est versé si vous le franchissez.`,
          `Move to Start. Collect ${money(config.startSalary)} salary if you pass it.`,
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
        badge: t("Direction le championnat", "Go to the Championship"),
        text: reference
          ? t(
              `Rejoignez le Championnat. Organisez-le dans une de vos villes : ${money(rules.championshipFee)} pour le déplacer, gratuit pour le renouveler. Chaque édition ajoute ×1 au loyer, jusqu’à ×${rules.maxHostMultiplier}.`,
              `Move to the Championship. Host it in one of your cities: ${money(rules.championshipFee)} to move it, free to renew it. Each edition adds ×1 to the rent, up to ×${rules.maxHostMultiplier}.`,
            )
          : t(
              `Rejoignez le Championnat. Une ville éligible, hors monuments, peut l’accueillir : son loyer sera multiplié jusqu’à ×${rules.maxHostMultiplier}.`,
              `Move to the Championship. An eligible city without a landmark can host it, multiplying its rent up to ×${rules.maxHostMultiplier}.`,
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
        badge: t("Gardez cette carte", "Keep this card"),
        text: t(
          "Au prochain loyer, vous pourrez jouer cette carte pour ne rien payer.",
          "Play this card when rent is due to pay nothing.",
        ),
      };
    case "Coupon":
      return {
        ...base,
        tone: "keep",
        badge: t("Loyer réduit de moitié", "Half-price rent"),
        text: t(
          "Gardez ce bon : vous pourrez l’utiliser pour diviser un futur loyer par deux.",
          "Keep this coupon to halve a future rent payment.",
        ),
      };
    case "Earthquake":
      return {
        ...base,
        art: "city",
        tone: "cost",
        badge: t("Un bâtiment en moins", "Remove one building level"),
        text: reference
          ? t(
              "Choisissez une ville adverse construite pour lui retirer un niveau, hôtels compris.",
              "Choose an opponent’s built city to remove one building level, Hotels included.",
            )
          : t(
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
        text: reference
          ? t(
              "Votre ville éligible la moins chère peut être échangée contre une ville adverse de prix égal ou inférieur, hors hôtels.",
              "Swap your cheapest eligible city for an opponent’s city of equal or lower land price. Hotels are excluded.",
            )
          : t(
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
