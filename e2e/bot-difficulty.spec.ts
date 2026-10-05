import { expect, type Locator, type Page, test } from "@playwright/test";
import { applyEvent, type PublicState } from "../src/shared/engine/index.js";
import type {
  LobbyState,
  ServerMessage,
} from "../src/shared/protocol/index.js";
import { chooseLanguage } from "./language.js";

test.use({ reducedMotion: "reduce" });

function observeRoom(page: Page) {
  let lobby: LobbyState | null = null;
  let state: PublicState | null = null;
  const operations = new Map<string, string>();
  const replies = new Map<string, string[]>();
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      try {
        const message = JSON.parse(String(frame.payload)) as {
          type?: string;
          id?: string;
          op?: { type?: string };
        };
        if (message.type === "lobby" && message.id && message.op?.type)
          operations.set(message.id, message.op.type);
      } catch {
        // Diagnostic ping frames are plain text.
      }
    });
    socket.on("framereceived", (frame) => {
      try {
        const message = JSON.parse(String(frame.payload)) as ServerMessage;
        if (message.type === "welcome") {
          lobby = message.lobby;
          state = message.snapshot;
        } else if (message.type === "lobby") lobby = message.lobby;
        else if (message.type === "events") {
          for (const event of message.events) {
            if (event.type === "GameCreated") state = event.state;
            else if (state) state = applyEvent(state, event);
          }
        } else if (message.type === "ack" || message.type === "reject") {
          const operation = operations.get(message.id);
          if (operation)
            replies.set(operation, [
              ...(replies.get(operation) ?? []),
              message.type,
            ]);
        }
      } catch {
        // Diagnostic pong frames are plain text.
      }
    });
  });
  return {
    lobby: () => lobby,
    state: () => state,
    command: async (operation: string, perform: () => Promise<void>) => {
      const completed = replies.get(operation)?.length ?? 0;
      await perform();
      await expect.poll(() => replies.get(operation)?.[completed]).toBe("ack");
    },
  };
}

async function expectContained(panel: Locator, width: number, height: number) {
  const layout = await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    // The settings ribbon deliberately extends beyond the sheet's paper edge.
    const content = element.querySelector(".settings-dialog-body") ?? element;
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      left: bounds.left,
      right: bounds.right,
      overflow: content.scrollWidth > content.clientWidth,
    };
  });
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(height);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(width);
  expect(layout.overflow).toBe(false);
}

for (const locale of ["fr", "en"] as const) {
  test(`bot difficulty is visible, saved and frozen in a real ${locale} game`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const room = observeRoom(page);
    const words =
      locale === "fr"
        ? {
            group: "Difficulté des bots",
            easy: "Facile",
            medium: "Moyen",
            hard: "Difficile",
            name: "Votre nom de joueur",
            play: "Jouer",
            start: "Démarrer la partie",
            close: "Fermer les réglages",
            settings: "Réglages de la partie",
            festivals: "Festivals initiaux",
            building: "Les bots peuvent construire",
            noBuilding: "Construction désactivée pour tous les niveaux.",
            dice: "Mêmes dés et règles que vous.",
            easyDescription: "sans construire ni racheter vos villes",
            hardDescription: "garde une réserve pour les loyers",
          }
        : {
            group: "Bot difficulty",
            easy: "Easy",
            medium: "Medium",
            hard: "Hard",
            name: "Player name",
            play: "Play",
            start: "Start game",
            close: "Close settings",
            settings: "Game settings",
            festivals: "Starting festivals",
            building: "Bots can build",
            noBuilding: "Building is disabled at every level.",
            dice: "The same dice and rules as you.",
            easyDescription: "without building or buying out your cities",
            hardDescription: "keeps cash for rent",
          };
    await page.goto("/");
    await chooseLanguage(page, locale);
    const quick = page.locator(".welcome-quick-settings");
    const difficulty = quick.getByRole("group", { name: words.group });
    await expect(
      difficulty.getByRole("radio", { name: words.medium, exact: true }),
    ).toBeChecked();
    await expect(quick).toContainText(words.dice);
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await expectContained(quick, viewport.width, viewport.height);
      await expect(difficulty.getByRole("radio")).toHaveCount(3);
      await page.screenshot({
        path: `.local/verification/bot-difficulty-welcome-${locale}-${viewport.width}.png`,
      });
    }
    // Native radio navigation keeps the choice usable without a pointer.
    await difficulty.getByRole("radio", { name: words.medium }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(
      difficulty.getByRole("radio", { name: words.easy, exact: true }),
    ).toBeChecked();
    await expect(quick).toContainText(words.easyDescription);
    await expect(difficulty).toHaveAccessibleDescription(
      new RegExp(words.easyDescription),
    );
    await quick.getByRole("slider", { name: words.festivals }).focus();
    await page.keyboard.press("Home");
    await page.getByLabel(words.name).fill(`Difficulty ${locale}`);
    await page.getByRole("button", { name: words.play, exact: true }).click();
    await expect.poll(() => room.lobby()?.config.botDifficulty).toBe("easy");
    await expect(page.locator(".lobby-seat.bot .seat-status")).toHaveText([
      `Bot · ${words.easy}`,
      `Bot · ${words.easy}`,
      `Bot · ${words.easy}`,
    ]);

    const trigger = page.locator(".settings-trigger");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const sheet = page.locator(".settings-dialog");
    const settingsDifficulty = sheet.getByRole("group", { name: words.group });
    await settingsDifficulty.getByRole("radio", { name: words.hard }).check();
    await expect(settingsDifficulty).toContainText(words.hardDescription);
    // The custom building rule remains an independent restriction on every level.
    await sheet.getByLabel(words.building, { exact: true }).uncheck();
    await expect(settingsDifficulty).toContainText(words.noBuilding);
    await expect(
      settingsDifficulty.getByRole("radio", { name: words.hard }),
    ).toBeChecked();
    await sheet.getByLabel(words.building, { exact: true }).check();
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await settingsDifficulty.scrollIntoViewIfNeeded();
      await expectContained(sheet, viewport.width, viewport.height);
      await page.screenshot({
        path: `.local/verification/bot-difficulty-settings-${locale}-${viewport.width}.png`,
      });
    }
    await room.command("settings", () => page.keyboard.press("Escape"));
    await expect(trigger).toBeFocused();
    await expect.poll(() => room.lobby()?.config.botDifficulty).toBe("hard");
    await page.reload();
    await expect(page.locator(".lobby-seat.bot .seat-status")).toHaveText([
      `Bot · ${words.hard}`,
      `Bot · ${words.hard}`,
      `Bot · ${words.hard}`,
    ]);
    await room.command("start", () =>
      page.getByRole("button", { name: words.start }).click(),
    );
    await expect.poll(() => room.state()?.config.botDifficulty).toBe("hard");
    await expect(page.locator(".player-name-row > span")).toContainText([
      locale === "fr" ? "Vous" : "You",
      `Bot · ${words.hard}`,
      `Bot · ${words.hard}`,
      `Bot · ${words.hard}`,
    ]);
    // Escape minimizes any purchase offered while the board catches up.
    await page.keyboard.press("Escape");
    const rulesTrigger = page.getByRole("button", {
      name: words.settings,
      exact: true,
    });
    await rulesTrigger.focus();
    await page.keyboard.press("Enter");
    const frozen = page
      .locator(".tool-drawer--rules")
      .getByRole("group", { name: words.group });
    await expect(frozen.getByRole("radio", { name: words.hard })).toBeChecked();
    for (const radio of await frozen.getByRole("radio").all())
      await expect(radio).toBeDisabled();
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await frozen.scrollIntoViewIfNeeded();
      for (const card of await page.locator(".player-card").all())
        await expectContained(card, viewport.width, viewport.height);
      await page.screenshot({
        path: `.local/verification/bot-difficulty-match-${locale}-${viewport.width}.png`,
      });
    }
    await page.reload();
    await expect(page.locator(".player-name-row > span")).toContainText([
      locale === "fr" ? "Vous" : "You",
      `Bot · ${words.hard}`,
      `Bot · ${words.hard}`,
      `Bot · ${words.hard}`,
    ]);
    await expect.poll(() => room.state()?.config.botDifficulty).toBe("hard");
  });
}
