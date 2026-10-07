import {
  CHANCE_AMOUNTS,
  ECONOMY,
  ruleEconomy,
} from "../../shared/board/index.js";
import {
  type ChanceCard,
  chanceRule,
  economyRule,
  type GameConfig,
  type GameEvent,
  type PublicState,
  worldTourRule,
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
  "Rescue Boat": "Bateau de secours",
  Escape: "Carte d’évasion",
  Charity: "Solidarité",
  Tailwind: "Vent arrière",
  "Power Cut": "Coupure de courant",
  "Forced Sale": "Vente forcée",
  Shield: "Bouclier",
  Patron: "Mécène",
  "Fan Trip": "Supporters",
  Gift: "Cadeau",
  "Roll Again": "Rejouez",
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
  "Rescue Boat": "Rescue boat",
  Escape: "Escape card",
  Charity: "Charity",
  Tailwind: "Tailwind",
  "Power Cut": "Power cut",
  "Forced Sale": "Forced sale",
  Shield: "Shield",
  Patron: "Patron",
  "Fan Trip": "Fan trip",
  Gift: "Gift",
  "Roll Again": "Roll again",
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
  const sale = config.sellBackPercent ?? rules.sellBackPercent;
  const shielded = t(
    "Un bouclier sur la propriété choisie bloque l’attaque et se brise.",
    "A shield on the chosen property blocks the attack and breaks.",
  );
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
          `Ce transfert termine votre tour, sans salaire ni tour complet. La traversée coûte ${money(rules.islandReleaseFee)} ; vous êtes aussi libéré après ${rules.islandMaxFailedEscapes} tentatives de double ratées.${config.escapeCard === true ? " Une carte d’évasion permet aussi de repartir sans payer." : ""}`,
          `This transfer ends your turn, without salary or lap credit. The fare is ${money(rules.islandReleaseFee)}; you are also released after ${rules.islandMaxFailedEscapes} failed doubles attempts.${config.escapeCard === true ? " An escape card also lets you leave without paying." : ""}`,
        ),
      ];
    case "Jet Set":
      return [
        t(
          `Le trajet suit le sens du jeu : franchir le départ rapporte ${money(config.startSalary)} et compte un tour. Au prochain tour, un vol coûte ${money(ECONOMY.worldTourFee)} ; vous pouvez aussi lancer les dés normalement.`,
          `Move clockwise: passing Start pays ${money(config.startSalary)} and counts a lap. On your next turn, a flight costs ${money(ECONOMY.worldTourFee)}; you may also roll normally.`,
        ),
        rules.travelToFreeProperties
          ? worldTourRule(config) === "free-and-own"
            ? t(
                "Le vol vise une propriété libre ou l’une des vôtres.",
                "Fly to an unowned property or one of your own.",
              )
            : t(
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
      return chanceRule(config) === "reworked"
        ? [
            t(
              `Le trajet suit le sens du jeu : franchir le départ rapporte ${money(config.startSalary)} et compte un tour. Le centre des impôts prélève ensuite ${ECONOMY.taxPercent} % de la valeur de vos propriétés.`,
              `Move clockwise: passing Start pays ${money(config.startSalary)} and counts a lap. The Tax office then charges ${ECONOMY.taxPercent}% of your properties’ value.`,
            ),
          ]
        : [
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
          "Choisissez une ville adverse construite, hôtels compris. Les terrains nus et les plages sont exclus. Le niveau retiré n’est pas remboursé.",
          "Choose an opponent’s built city, including Hotels. Bare land and beaches are excluded. The removed level is not refunded.",
        ),
        shielded,
        noTarget,
      ];
    case "Forced Sale":
      return [
        t(
          `Choisissez une propriété adverse, plages comprises. Son propriétaire la revend à la banque pour ${sale} % de sa valeur. Un hôtel perd seulement son dernier niveau, remboursé de la même façon.`,
          `Choose an opponent’s property, beaches included. Its owner sells it to the bank for ${sale}% of its value. A Hotel only loses its top level, refunded the same way.`,
        ),
        shielded,
        noTarget,
      ];
    case "Shield":
      return [
        t(
          "Choisissez une de vos propriétés. La prochaine attaque visée sur elle (tremblement de terre, coupure de courant, vente forcée, échange de terrain) est bloquée et brise le bouclier. Les rachats ne sont pas bloqués, et un nouveau propriétaire perd le bouclier.",
          "Choose one of your properties. The next attack aimed at it (earthquake, power cut, forced sale, land swap) is blocked and breaks the shield. Buyouts are not blocked, and a new owner loses the shield.",
        ),
        noTarget,
      ];
    case "Patron":
      return [
        t(
          "Choisissez une de vos villes, avec les mêmes limites que Coup de pouce. L’adversaire qui a le plus de cash paie ce niveau à la banque ; en cas d’égalité, le premier dans l’ordre des tours.",
          "Choose one of your cities, with the same limits as Contractor. The opponent with the most cash pays the bank for that level; if tied, the first in turn order.",
        ),
        gifts,
        noTarget,
      ];
    case "Fan Trip":
      return [
        t(
          `Le trajet suit le sens du jeu ; franchir le départ rapporte ${money(config.startSalary)}. Payez le loyer de la ville hôte si elle ne vous appartient pas. Sans championnat organisé, la carte n’a aucun effet. Cette carte est rare.`,
          `Move clockwise; passing Start pays ${money(config.startSalary)}. Pay the host city’s rent unless you own it. With no championship hosted, the card has no effect. This card is rare.`,
        ),
      ];
    case "Gift":
      return [
        t(
          "Choisissez une de vos villes, hors hôtels et plages. Elle revient avec ses bâtiments à l’adversaire qui a le moins de cash ; en cas d’égalité, le premier dans l’ordre des tours.",
          "Choose one of your cities, except Hotels and beaches. It goes with its buildings to the opponent with the least cash; if tied, the first in turn order.",
        ),
        noTarget,
      ];
    case "Roll Again":
      return [
        t(
          "Vous relancez les dés après cette carte. Si un double vous donne déjà un lancer, il n’y en a pas un deuxième.",
          "You roll the dice again after this card. If doubles already give you a roll, you do not get a second one.",
        ),
      ];
    case "Land Swap":
      return [
        t(
          "Votre ville est choisie automatiquement selon le prix du terrain, sans ses bâtiments. Vous pouvez refuser l’échange. Les deux villes conservent leurs bâtiments ; les plages sont exclues.",
          "Your city is selected automatically by land price, excluding buildings. You may decline the swap. Both cities keep their buildings; beaches are excluded.",
        ),
        shielded,
        noTarget,
      ];
    case "Detour":
      return [
        ...(chanceRule(config) === "reworked"
          ? [
              t(
                "Un dé décide du nombre de cases, de 1 à 6.",
                "A die decides how many spaces, from 1 to 6.",
              ),
            ]
          : []),
        t(
          "Même si vous traversez le départ à reculons, vous ne recevez pas de salaire et ne comptez pas de tour complet. Ce déplacement ne donne pas de lancer supplémentaire sur un double.",
          "Crossing Start backwards pays no salary and does not count a lap. This move does not grant another roll for doubles.",
        ),
      ];
    case "Tailwind":
      return [
        t(
          `Un dé décide du nombre de cases, de 1 à 6. Franchir le départ rapporte ${money(config.startSalary)} et compte un tour. Ce déplacement ne donne pas de lancer supplémentaire sur un double.`,
          `A die decides how many spaces, from 1 to 6. Passing Start pays ${money(config.startSalary)} and counts a lap. This move does not grant another roll for doubles.`,
        ),
      ];
    case "Power Cut":
      return [
        t(
          `Choisissez une ville adverse, hôtels compris. Elle ne rapporte aucun loyer tant que son propriétaire n’a pas franchi le départ ${CHANCE_AMOUNTS.powerCutLaps} fois. Un nouveau propriétaire rétablit le courant ; les plages sont exclues.`,
          `Choose an opponent’s city, Hotels included. It earns no rent until its owner has passed Start ${CHANCE_AMOUNTS.powerCutLaps} times. A new owner restores the power; beaches are excluded.`,
        ),
        shielded,
        noTarget,
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
          "Les plages, les hôtels et les monuments ne sont pas des cibles éligibles.",
          "Beaches, Hotels and Landmarks are not eligible targets.",
        ),
        noTarget,
      ];
    case "Rescue Boat":
      return [
        t(
          "Les pions restent sur place. Sans joueur bloqué sur l’île, la carte n’a aucun effet.",
          "Pawns stay in place. If nobody is on the Island, the card has no effect.",
        ),
      ];
    case "Escape":
      return [
        t(
          "Gardez cette carte jusqu’au début d’un de vos tours sur l’île. Elle vous libère sans payer ; lancez ensuite les dés normalement. Elle est défaussée après usage. Vous ne pouvez en garder qu’un exemplaire.",
          "Keep this card until the start of one of your turns on the Island. Leave without paying, then roll normally. Discard it after use. You may hold only one escape card.",
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
  /** How to play: the full description beside the badge and notes. */
  text: string;
  badge: string;
  /** In game: one short sentence under the card's drawing. */
  short: string;
  tone: "gain" | "cost" | "travel" | "keep";
};

/** Card copy reads the same amounts as the engine; it never applies an effect. */
export function describeCard(
  event: CardDraw,
  state: PublicState,
): CardPresentation {
  const card = describeChanceCard(event.card, state.config, event.roll);
  if (
    (event.card === "Guardian Angel" ||
      event.card === "Coupon" ||
      event.card === "Escape") &&
    !event.kept
  ) {
    return {
      ...card,
      badge: t("Déjà dans votre main", "Already in your hand"),
      short: t("Déjà dans votre main.", "Already in your hand."),
      text:
        event.card === "Guardian Angel"
          ? t(
              "Vous possédez déjà cette protection. Ce doublon ne rejoint pas votre main.",
              "You already have this protection. The duplicate is not added to your hand.",
            )
          : event.card === "Coupon"
            ? t(
                "Vous possédez déjà ce bon. Ce doublon ne rejoint pas votre main.",
                "You already have this coupon. The duplicate is not added to your hand.",
              )
            : t(
                "Vous possédez déjà une carte d’évasion. Ce doublon ne rejoint pas votre main.",
                "You already have an escape card. The duplicate is not added to your hand.",
              ),
    };
  }
  return card;
}

/** The catalogue and drawn cards share the room's frozen rules and amounts. */
export function describeChanceCard(
  card: ChanceCard,
  config: GameConfig,
  /** The die a drawn Detour or Tailwind rolled; absent in the catalogue. */
  roll?: number,
): CardPresentation {
  const base = { title: cardName(card), tone: "gain" as const };
  const steps = roll === undefined ? "1-6" : `${roll}`;
  const rules = ruleEconomy(economyRule(config));
  // Landmarks guard prototype rooms; Hotels guard reference rooms from transfers.
  const reference = rules.topLevel === 4;
  switch (card) {
    case "Grand Tour":
      return {
        ...base,
        tone: "travel",
        badge: t("Retour au départ", "Back to Start"),
        short: t(
          "Allez au Départ et touchez votre salaire.",
          "Go to Start and collect your salary.",
        ),
        text: t(
          `Rejoignez le Départ. Le salaire de ${money(config.startSalary)} est versé si vous le franchissez.`,
          `Move to Start. Collect ${money(config.startSalary)} salary if you pass it.`,
        ),
      };
    case "Stranded":
      return {
        ...base,
        tone: "cost",
        badge: t("Escale sur l’île", "Go to the Island"),
        short: t("Allez sur l’île.", "Go to the Island."),
        text: t(
          `Rejoignez l’Île paisible. Repartez avec un double, en payant la traversée${config.escapeCard === true ? ", avec une carte d’évasion" : ""} ou grâce au bateau de secours.`,
          `Move to the Island. Leave by rolling doubles, paying the fare${config.escapeCard === true ? ", using an escape card" : ""} or when the rescue boat calls.`,
        ),
      };
    case "Jet Set":
      return {
        ...base,
        tone: "travel",
        badge: t("Tour du monde", "World tour"),
        short: t("Allez au Tour du monde.", "Go to World tour."),
        text: t(
          "Rejoignez le Tour du monde. À votre prochain tour, choisissez une destination.",
          "Move to World tour. On your next turn, choose a destination.",
        ),
      };
    case "Stadium Call":
      return {
        ...base,
        tone: "travel",
        badge: t("Direction le championnat", "Go to the Championship"),
        short: t("Allez au Championnat.", "Go to the Championship."),
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
        short: t(
          `Recevez ${money(CHANCE_AMOUNTS.windfall)} de la banque.`,
          `Collect ${money(CHANCE_AMOUNTS.windfall)} from the bank.`,
        ),
        text: t(
          "La banque vous verse cette somme.",
          "Collect this amount from the bank.",
        ),
      };
    case "Parking Fine":
      return {
        ...base,
        tone: "cost",
        badge: `- ${money(CHANCE_AMOUNTS.fine)}`,
        short: t(
          `Payez ${money(CHANCE_AMOUNTS.fine)}.`,
          `Pay ${money(CHANCE_AMOUNTS.fine)}.`,
        ),
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
        short: t(
          `Recevez ${money(CHANCE_AMOUNTS.birthday)} de chaque adversaire.`,
          `Collect ${money(CHANCE_AMOUNTS.birthday)} from each opponent.`,
        ),
        text: t(
          "Chaque adversaire encore en jeu vous offre cette somme, selon les règles de cadeaux de la salle.",
          "Each opponent still in the game gives you this amount, subject to the room’s gift rules.",
        ),
      };
    case "Audit":
      if (chanceRule(config) === "reworked")
        return {
          ...base,
          tone: "cost",
          badge: t("Direction les impôts", "Go to the Tax office"),
          short: t("Allez au centre des impôts.", "Go to the Tax office."),
          text: t(
            "Rejoignez le centre des impôts et payez-y l’impôt sur vos propriétés.",
            "Move to the Tax office and pay the tax on your properties there.",
          ),
        };
      return {
        ...base,
        tone: "cost",
        short: t(
          `Payez ${CHANCE_AMOUNTS.auditPercent} % de votre cash.`,
          `Pay ${CHANCE_AMOUNTS.auditPercent}% of your cash.`,
        ),
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
        short: t("Gardez-la : un loyer offert.", "Keep it: skip one rent."),
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
        short: t(
          "Gardez-le : un loyer à moitié prix.",
          "Keep it: pay half of one rent.",
        ),
        text: t(
          "Gardez ce bon : vous pourrez l’utiliser pour diviser un futur loyer par deux.",
          "Keep this coupon to halve a future rent payment.",
        ),
      };
    case "Earthquake":
      return {
        ...base,
        tone: "cost",
        badge: t("Un bâtiment en moins", "Remove one building level"),
        short: t(
          "Détruisez un bâtiment adverse.",
          "Knock down an opponent’s building.",
        ),
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
        tone: "travel",
        badge: t("Échange de propriétés", "Swap properties"),
        short: t(
          "Échangez une ville avec un adversaire.",
          "Swap a city with an opponent.",
        ),
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
    case "Detour": {
      const back =
        chanceRule(config) === "reworked"
          ? steps
          : `${CHANCE_AMOUNTS.detourSteps}`;
      return {
        ...base,
        tone: "travel",
        badge: t(`Reculez de ${back} cases`, `Move back ${back} spaces`),
        short: t(`Reculez de ${back} cases.`, `Move back ${back} spaces.`),
        text: t(
          "Reculez, puis appliquez l’effet de votre nouvelle case.",
          "Move back, then resolve the space you land on.",
        ),
      };
    }
    case "Tailwind":
      return {
        ...base,
        tone: "travel",
        badge: t(`Avancez de ${steps} cases`, `Move forward ${steps} spaces`),
        short: t(`Avancez de ${steps} cases.`, `Move forward ${steps} spaces.`),
        text: t(
          "Avancez, puis appliquez l’effet de votre nouvelle case.",
          "Move forward, then resolve the space you land on.",
        ),
      };
    case "Forced Sale":
      return {
        ...base,
        tone: "cost",
        badge: t("Vente forcée adverse", "Force an opponent to sell"),
        short: t(
          "Forcez un adversaire à vendre une propriété.",
          "Force an opponent to sell a property.",
        ),
        text: t(
          "Choisissez une propriété adverse : elle retourne à la banque et son propriétaire est remboursé. Un hôtel perd seulement un niveau.",
          "Choose an opponent’s property: it returns to the bank and its owner is refunded. A Hotel only loses one level.",
        ),
      };
    case "Shield":
      return {
        ...base,
        tone: "keep",
        badge: t("Protège une propriété", "Protect a property"),
        short: t(
          "Protégez une de vos propriétés.",
          "Protect one of your properties.",
        ),
        text: t(
          "Un bouclier flotte sur la propriété choisie et bloque la prochaine attaque.",
          "A shield floats over the chosen property and blocks the next attack.",
        ),
      };
    case "Patron":
      return {
        ...base,
        badge: t(
          "Un niveau payé par le plus riche",
          "A level paid by the richest",
        ),
        short: t(
          "Le plus riche paie un niveau de votre ville.",
          "The richest opponent pays for a level in your city.",
        ),
        text: t(
          "Choisissez une de vos villes : elle gagne un niveau, payé à la banque par l’adversaire le plus riche.",
          "Choose one of your cities: it gains a level, paid to the bank by the richest opponent.",
        ),
      };
    case "Fan Trip":
      return {
        ...base,
        tone: "cost",
        badge: t("Direction la ville hôte", "Go to the host city"),
        short: t(
          "Allez dans la ville du championnat.",
          "Go to the championship’s host city.",
        ),
        text: t(
          "Rejoignez la ville qui organise le championnat et payez-y le loyer.",
          "Move to the city hosting the championship and pay its rent there.",
        ),
      };
    case "Gift":
      return {
        ...base,
        tone: "cost",
        badge: t("Offrez une ville", "Give away a city"),
        short: t(
          "Offrez une ville à l’adversaire le plus pauvre.",
          "Give a city to the poorest opponent.",
        ),
        text: t(
          "Choisissez une de vos villes : elle revient, avec ses bâtiments, à l’adversaire qui a le moins de cash.",
          "Choose one of your cities: it goes, with its buildings, to the opponent with the least cash.",
        ),
      };
    case "Roll Again":
      return {
        ...base,
        tone: "travel",
        badge: t("Un lancer de plus", "One more roll"),
        short: t("Relancez les dés.", "Roll the dice again."),
        text: t(
          "Après cette carte, vous relancez les dés.",
          "After this card, you roll the dice again.",
        ),
      };
    case "Power Cut":
      return {
        ...base,
        tone: "cost",
        badge: t(
          `Aucun loyer pendant ${CHANCE_AMOUNTS.powerCutLaps} tours`,
          `No rent for ${CHANCE_AMOUNTS.powerCutLaps} laps`,
        ),
        short: t(
          "Coupez le courant d’une ville adverse.",
          "Cut the power of an opponent’s city.",
        ),
        text: t(
          `Choisissez une ville adverse : elle ne rapporte plus de loyer pendant ${CHANCE_AMOUNTS.powerCutLaps} tours de son propriétaire.`,
          `Choose an opponent’s city: it earns no rent for its owner’s next ${CHANCE_AMOUNTS.powerCutLaps} laps.`,
        ),
      };
    case "Contractor":
      return {
        ...base,
        badge: t("Une construction offerte", "One free building level"),
        short: t(
          "Construisez gratuitement dans une de vos villes.",
          "Build for free in one of your cities.",
        ),
        text: t(
          "Si une de vos villes est éligible, choisissez-la pour recevoir un niveau de construction gratuit.",
          "Choose one of your eligible cities to add one building level for free.",
        ),
      };
    case "Rescue Boat":
      return {
        ...base,
        tone: "travel",
        badge: t("Tout le monde embarque", "Everyone boards"),
        short: t("Tout le monde quitte l’île.", "Everyone leaves the Island."),
        text: t(
          "Un bateau de secours accoste sur l’Île paisible : tous les joueurs qui y sont bloqués rentrent. Ils repartent à leur tour.",
          "A rescue boat calls at the Island: everyone stuck there leaves. They move again on their next turn.",
        ),
      };
    case "Escape":
      return {
        ...base,
        tone: "keep",
        badge: t("Gardez cette carte", "Keep this card"),
        short: t(
          "Gardez-la : quittez l’île sans payer.",
          "Keep it: leave the Island for free.",
        ),
        text: t(
          "Au début d’un de vos tours sur l’île, utilisez cette carte pour repartir sans payer. Lancez ensuite les dés normalement.",
          "At the start of one of your turns on the Island, use this card to leave without paying. Then roll normally.",
        ),
      };
    case "Charity":
      return {
        ...base,
        tone: "cost",
        badge: `- ${money(CHANCE_AMOUNTS.charity)}`,
        short: t(
          `Donnez ${money(CHANCE_AMOUNTS.charity)} à l’adversaire le plus pauvre.`,
          `Give ${money(CHANCE_AMOUNTS.charity)} to the poorest opponent.`,
        ),
        text: t(
          "Vous offrez cette somme à l’adversaire encore en jeu qui possède le moins de cash, selon les règles de cadeaux de la salle.",
          "Give this amount to the opponent still in the game with the least cash, subject to the room’s gift rules.",
        ),
      };
  }
}
