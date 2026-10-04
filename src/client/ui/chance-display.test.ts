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
    "uses the configured salary in %s instead of the default amount",
    (locale) => {
      setLocale(locale);
      const config = { ...DEFAULT_GAME_CONFIG, startSalary: 760_000 };
      const description = describeChanceCard("Grand Tour", config);
      expect(description.text).toContain("760 k");
      expect(description.text).not.toContain("400 k");
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

  it.each(["fr", "en"] as const)(
    "describes Audit using the frozen movement selector in %s",
    (locale) => {
      setLocale(locale);
      for (const taxCardMovement of [true, false, undefined]) {
        const config = {
          ...DEFAULT_GAME_CONFIG,
          startSalary: 760_000,
          taxCardMovement,
        };
        const card = describeChanceCard("Audit", config);
        const details = describeChanceCardDetails("Audit", config).join(" ");
        const state = toPublic(
          createGame(
            config,
            [
              { playerId: "audit-human", name: "Player", control: "human" },
              { playerId: "audit-bot", name: "Bot", control: "bot" },
            ],
            49,
            { now: 0 },
          ).state,
        );
        expect(
          describeCard(
            { type: "CardDrawn", seat: 0, card: "Audit", kept: false },
            state,
          ),
        ).toEqual(card);
        if (taxCardMovement === true) {
          expect(card.badge).toBe(
            locale === "fr" ? "Direction la Taxe" : "Go to Tax",
          );
          expect(card.text).toContain(
            locale === "fr" ? "taxe sur vos propriétés" : "property tax",
          );
          expect(card.text).toContain("760 k");
          expect(details).toContain("760 k");
          expect(details).toContain(
            locale === "fr" ? "bâtiments compris" : "including buildings",
          );
          expect(details).toContain(
            locale === "fr" ? "vendez des propriétés" : "sell properties",
          );
          expect(details).toContain(
            locale === "fr" ? "faillite" : "bankruptcy",
          );
          expect(details).toContain(
            locale === "fr" ? "unité supérieure" : "rounded up",
          );
          expect(details).toContain("minimum");
          expect(details).not.toContain(
            locale === "fr" ? "cash nul" : "Zero or negative cash",
          );
        } else {
          expect(card.badge).toBe(
            locale === "fr" ? "10 % de votre cash" : "10% of your cash",
          );
          expect(card.text).toBe(
            locale === "fr"
              ? "Payez à la banque cette part de votre trésorerie positive."
              : "Pay this share of your positive cash balance to the bank.",
          );
          expect(details).toBe(
            locale === "fr"
              ? "Le montant est arrondi à l’unité supérieure. Un cash nul ou négatif ne produit aucun paiement."
              : "The amount is rounded up to a whole unit. Zero or negative cash produces no charge.",
          );
          expect(card.text).not.toContain("760 k");
        }
      }
    },
  );

  it.each(["Guardian Angel", "Coupon"] as const)(
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
