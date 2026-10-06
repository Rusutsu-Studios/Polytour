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
    operationCount: (operation: string) =>
      [...operations.values()].filter((type) => type === operation).length,
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
            group: "Niveau par défaut",
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
            easyDescription: "profite moins bien de certaines occasions",
            hardDescription: "garde une réserve pour les loyers",
          }
        : {
            group: "Default bot difficulty",
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
            easyDescription: "occasionally misses opportunities",
            hardDescription: "keeps cash for rent",
          };
    await page.goto("/");
    await chooseLanguage(page, locale);
    const quick = page.locator(".welcome-quick-settings");
    const difficulty = quick.getByRole("group", { name: words.group });
    await expect(
      difficulty.getByRole("radio", { name: words.medium, exact: true }),
    ).toBeChecked();
    await expect(
      quick.locator(".room-setting-bot-description, .room-setting-bot-rules"),
    ).toHaveCount(0);
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
    const helpName = (label: string) =>
      locale === "fr" ? `À propos de ${label}` : `About ${label}`;
    await difficulty
      .getByRole("button", { name: helpName(words.group), exact: true })
      .click();
    await expect(page.locator("#disabled-action-hint")).toContainText(
      words.easyDescription,
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("#disabled-action-hint")).not.toBeVisible();
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

    const cycle = async (seat: number, level: string, keyboard = false) => {
      const card = page.locator(`.lobby-seat[data-seat="${seat}"]`);
      const button = card.locator(".seat-bot-difficulty");
      await expect(button).toHaveAccessibleName(
        new RegExp(locale === "fr" ? "Passer à" : "Switch to"),
      );
      await room.command("bot-difficulty", async () => {
        if (keyboard) {
          await button.focus();
          await page.keyboard.press("Space");
        } else await button.click();
      });
      await expect(button).toHaveText(`Bot · ${level}`);
    };
    await cycle(1, words.medium, true);
    // Changing Milo leaves the other cards untouched.
    await expect(page.locator(".lobby-seat.bot .seat-status")).toHaveText([
      `Bot · ${words.medium}`,
      `Bot · ${words.easy}`,
      `Bot · ${words.easy}`,
    ]);
    await cycle(2, words.medium);
    await cycle(2, words.hard);
    await cycle(3, words.medium);
    await cycle(3, words.hard);
    await cycle(3, words.easy);
    await expect
      .poll(() =>
        room
          .lobby()
          ?.seats.filter((player) => player.control === "bot")
          .map((player) => player.botDifficulty),
      )
      .toEqual(["medium", "hard", "easy"]);
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      for (const button of await page.locator(".seat-bot-difficulty").all())
        await expectContained(button, viewport.width, viewport.height);
      await page.screenshot({
        path: `.local/verification/bot-difficulty-lobby-${locale}-${viewport.width}.png`,
      });
    }

    const trigger = page.locator(".settings-trigger");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const sheet = page.locator(".settings-dialog");
    const settingsDifficulty = sheet.getByRole("group", { name: words.group });
    await settingsDifficulty.getByRole("radio", { name: words.hard }).check();
    const hardHelp = settingsDifficulty.getByRole("button", {
      name: helpName(words.hard),
      exact: true,
    });
    await hardHelp.click();
    await expect(page.locator("#disabled-action-hint")).toContainText(
      words.hardDescription,
    );
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
    // The custom building rule remains an independent restriction on every level.
    await sheet.getByLabel(words.building, { exact: true }).uncheck();
    await hardHelp.click();
    await expect(page.locator("#disabled-action-hint")).toContainText(
      words.noBuilding,
    );
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
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
      `Bot · ${words.medium}`,
      `Bot · ${words.hard}`,
      `Bot · ${words.easy}`,
    ]);
    await room.command("start", () =>
      page.getByRole("button", { name: words.start }).click(),
    );
    await expect.poll(() => room.state()?.config.botDifficulty).toBe("hard");
    await expect(page.locator(".player-name-row > span")).toContainText([
      locale === "fr" ? "Vous" : "You",
      `Bot · ${words.medium}`,
      `Bot · ${words.hard}`,
      `Bot · ${words.easy}`,
    ]);
    await expect
      .poll(() =>
        room
          .state()
          ?.players.filter((player) => player.control === "bot")
          .map((player) => player.botDifficulty),
      )
      .toEqual(["medium", "hard", "easy"]);
    await expect(
      page.locator(".player-roster .seat-bot-difficulty"),
    ).toHaveCount(0);
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
      `Bot · ${words.medium}`,
      `Bot · ${words.hard}`,
      `Bot · ${words.easy}`,
    ]);
    await expect.poll(() => room.state()?.config.botDifficulty).toBe("hard");
  });
}

test("a guest can read each bot level but cannot cycle it", async ({
  page,
  browser,
}) => {
  const hostRoom = observeRoom(page);
  await page.goto("/");
  await chooseLanguage(page, "en");
  await page.getByLabel("Player name").fill("Difficulty leader");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".seat-bot-difficulty")).toHaveCount(3);
  const roomCode = hostRoom.lobby()?.roomCode;
  if (!roomCode) throw new Error("Expected the created room code");
  const context = await browser.newContext({
    locale: "en-GB",
    reducedMotion: "reduce",
  });
  try {
    const guest = await context.newPage();
    const guestRoom = observeRoom(guest);
    const invitation = new URL("/", page.url());
    invitation.searchParams.set("room", roomCode);
    await guest.goto(invitation.toString());
    await guest.getByLabel("Player name").fill("Difficulty guest");
    await guest.getByRole("button", { name: "Join", exact: true }).click();
    await expect(guest.locator(".seat-bot-difficulty")).toHaveCount(2);
    for (const button of await guest.locator(".seat-bot-difficulty").all()) {
      await expect(button).toBeDisabled();
      await expect(button).toHaveText("Bot · Medium");
      await button.focus();
      await guest.keyboard.press("Enter");
    }
    expect(guestRoom.operationCount("bot-difficulty")).toBe(0);
    await expect(page.locator(".seat-bot-difficulty")).toHaveText([
      "Bot · Medium",
      "Bot · Medium",
    ]);
    await guest.locator(".settings-trigger").click();
    const defaults = guest
      .locator(".settings-dialog")
      .getByRole("group", { name: "Default bot difficulty" });
    for (const radio of await defaults.getByRole("radio").all())
      await expect(radio).toBeDisabled();
    const help = defaults.getByRole("button", {
      name: "About Default bot difficulty",
      exact: true,
    });
    await expect(help).toBeEnabled();
    await help.click();
    await expect(guest.locator("#disabled-action-hint strong")).toHaveText(
      "Default bot difficulty",
    );
    await expect(help).toHaveAttribute("aria-expanded", "true");
    await page.locator(".settings-trigger").click();
    await page
      .locator(".settings-dialog")
      .getByRole("group", { name: "Default bot difficulty" })
      .getByRole("radio", { name: "Hard", exact: true })
      .check();
    await hostRoom.command("settings", () => page.keyboard.press("Escape"));
    await expect(guest.locator("#disabled-action-hint")).toContainText(
      "keeps cash for rent",
    );
    await expect(help).toHaveAttribute("aria-expanded", "true");
    await expect(
      defaults.getByRole("radio", { name: "Hard", exact: true }),
    ).toBeChecked();
    await guest.keyboard.press("Escape");
    await expect(guest.locator("#disabled-action-hint")).not.toBeVisible();
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await expect(guest.locator(".settings-dialog")).toBeVisible();
  } finally {
    await context.close();
  }
});
