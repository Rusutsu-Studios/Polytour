import { afterEach, describe, expect, it } from "vitest";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  type GameConfig,
  toPublic,
} from "../../shared/engine/index.js";
import { setLocale } from "../i18n.js";
import {
  describeCard,
  describeChanceCard,
  describeChanceCardDetails,
} from "./chance-display.js";

afterEach(() => setLocale("fr"));

describe("luck-card descriptions without a draw", () => {
  it.each(["fr", "en"] as const)(
    "uses the configured landing salary in %s instead of the default amount",
    (locale) => {
      setLocale(locale);
      const config = { ...DEFAULT_GAME_CONFIG, startSalary: 760_000 };
      // Grand Tour lands on Start, so it collects 150% of the configured salary.
      const description = describeChanceCard("Grand Tour", config);
      expect(description.text).toContain(locale === "fr" ? "1,14 M" : "1.14 M");
      expect(description.text).not.toContain("400 k");
    },
  );

  it.each(["fr", "en"] as const)(
    "keeps the flat salary in %s on a saved match without the landing bonus",
    (locale) => {
      setLocale(locale);
      const config = {
        ...DEFAULT_GAME_CONFIG,
        startSalary: 760_000,
        startLandingBonus: false,
      };
      const description = describeChanceCard("Grand Tour", config);
      expect(description.text).toContain("760 k");
    },
  );

  it.each(["fr", "en"] as const)(
    "keeps reference Hotels and saved prototype Landmarks distinct in %s",
    (locale) => {
      setLocale(locale);
      const savedConfig: GameConfig = {
        gameId: "saved-card-help",
        startingCash: 2_000_000,
        startSalary: 400_000,
        roundLimit: 20,
      };
      const referenceQuake = describeChanceCard(
        "Earthquake",
        DEFAULT_GAME_CONFIG,
      );
      const savedQuake = describeChanceCard("Earthquake", savedConfig);
      expect(referenceQuake.text).toContain(
        locale === "fr" ? "hôtels compris" : "Hotels included",
      );
      expect(savedQuake.text).toContain(
        locale === "fr" ? "monuments sont protégés" : "Landmarks are protected",
      );
      expect(
        describeChanceCard("Land Swap", DEFAULT_GAME_CONFIG).text,
      ).toContain(locale === "fr" ? "hors hôtels" : "Hotels are excluded");
      expect(describeChanceCard("Land Swap", savedConfig).text).toContain(
        locale === "fr" ? "hors monuments" : "Landmarks are excluded",
      );
      expect(
        describeChanceCard("Stadium Call", DEFAULT_GAME_CONFIG).text,
      ).toContain("50 k");
      expect(
        describeChanceCard("Stadium Call", savedConfig).text,
      ).not.toContain("50 k");
    },
  );

  it.each(["Guardian Angel", "Coupon", "Escape"] as const)(
    "explains %s as usable in help and retains duplicate draw feedback",
    (card) => {
      const state = toPublic(
        createGame(
          DEFAULT_GAME_CONFIG,
          [
            { playerId: "test-card-player", name: "Player", control: "human" },
            { playerId: "test-card-bot", name: "Bot", control: "bot" },
          ],
          49,
          { now: 0 },
        ).state,
      );
      for (const locale of ["fr", "en"] as const) {
        setLocale(locale);
        const catalogue = describeChanceCard(card, state.config);
        const firstDraw = describeCard(
          { type: "CardDrawn", seat: 0, card, kept: true },
          state,
        );
        const duplicate = describeCard(
          { type: "CardDrawn", seat: 0, card, kept: false },
          state,
        );
        expect(catalogue.tone).toBe("keep");
        expect(catalogue).toEqual(firstDraw);
        expect(catalogue.text).not.toContain(
          locale === "fr" ? "doublon" : "duplicate",
        );
        expect(duplicate.title).toBe(catalogue.title);
        expect(duplicate.badge).toBe(
          locale === "fr" ? "Déjà dans votre main" : "Already in your hand",
        );
        expect(duplicate.text).toContain(
          locale === "fr"
            ? "Ce doublon ne rejoint pas votre main"
            : "The duplicate is not added to your hand",
        );
      }
    },
  );

  it.each(["fr", "en"] as const)(
    "keeps Stranded departure help aligned with reference and saved room rules in %s",
    (locale) => {
      setLocale(locale);
      for (const { config, fee, failures, escapeCard } of [
        {
          config: DEFAULT_GAME_CONFIG,
          fee: "200 k",
          failures: 3,
          escapeCard: true,
        },
        {
          config: { ...DEFAULT_GAME_CONFIG, escapeCard: false },
          fee: "200 k",
          failures: 3,
          escapeCard: false,
        },
        {
          config: {
            ...DEFAULT_GAME_CONFIG,
            economyRule: undefined,
            escapeCard: undefined,
          },
          fee: "100 k",
          failures: 2,
          escapeCard: false,
        },
      ]) {
        const summary = describeChanceCard("Stranded", config).text;
        const details = describeChanceCardDetails("Stranded", config).join(" ");
        const cardName = locale === "fr" ? "carte d’évasion" : "escape card";
        expect(summary.includes(cardName)).toBe(escapeCard);
        expect(details.includes(cardName)).toBe(escapeCard);
        expect(details).toContain(fee);
        expect(details).toContain(
          `${failures} ${locale === "fr" ? "tentatives de double ratées" : "failed doubles attempts"}`,
        );
        expect(details).toContain(
          locale === "fr"
            ? "termine votre tour, sans salaire ni tour complet"
            : "ends your turn, without salary or lap credit",
        );
      }
    },
  );

  it.each(["fr", "en"] as const)(
    "shows when the retained escape card can be used in %s",
    (locale) => {
      setLocale(locale);
      const card = describeChanceCard("Escape", DEFAULT_GAME_CONFIG);
      expect(card.tone).toBe("keep");
      expect(card.text).toContain(
        locale === "fr"
          ? "Au début d’un de vos tours sur l’île"
          : "At the start of one of your turns on the Island",
      );
      expect(card.text).toContain(
        locale === "fr"
          ? "Lancez ensuite les dés normalement"
          : "Then roll normally",
      );
      expect(
        describeChanceCardDetails("Escape", DEFAULT_GAME_CONFIG).join(" "),
      ).toContain(
        locale === "fr" ? "défaussée après usage" : "Discard it after use",
      );
      expect(
        describeChanceCard("Rescue Boat", DEFAULT_GAME_CONFIG).text,
      ).toContain(locale === "fr" ? "bateau de secours" : "rescue boat");
    },
  );

  it.each(["fr", "en"] as const)(
    "explains the room's optional gift bankruptcy rule in %s",
    (locale) => {
      setLocale(locale);
      for (const card of ["Birthday", "Charity"] as const) {
        const normalGift = describeChanceCardDetails(
          card,
          DEFAULT_GAME_CONFIG,
        ).join(" ");
        const cappedGift = describeChanceCardDetails(card, {
          ...DEFAULT_GAME_CONFIG,
          giftCanBankrupt: false,
        }).join(" ");
        expect(normalGift).toContain(
          locale === "fr" ? "vendre des propriétés" : "sell properties",
        );
        expect(cappedGift).toContain(
          locale === "fr" ? "limité au cash disponible" : "capped at the payer",
        );
        expect(cappedGift).toContain(
          locale === "fr"
            ? "ne provoque ni vente ni faillite"
            : "cannot force a sale or bankruptcy",
        );
      }
    },
  );

  it.each(["fr", "en"] as const)(
    "explains Contractor targets and the direct-Hotel exception in %s",
    (locale) => {
      setLocale(locale);
      const staged = describeChanceCardDetails(
        "Contractor",
        DEFAULT_GAME_CONFIG,
      ).join(" ");
      const direct = describeChanceCardDetails("Contractor", {
        ...DEFAULT_GAME_CONFIG,
        hotelsDirectly: true,
      }).join(" ");
      expect(staged).toContain(locale === "fr" ? "2 maisons" : "2 houses");
      expect(direct).toContain(
        locale === "fr"
          ? "même avant votre premier tour complet"
          : "even before your first completed lap",
      );
      expect(direct).not.toContain(locale === "fr" ? "2 maisons" : "2 houses");
      for (const detail of [staged, direct]) {
        expect(detail).toContain(
          locale === "fr"
            ? "Les plages, les hôtels et les monuments"
            : "Beaches, Hotels and Landmarks",
        );
        expect(detail).toContain(
          locale === "fr" ? "défaussée sans effet" : "discarded without effect",
        );
      }
    },
  );
});
