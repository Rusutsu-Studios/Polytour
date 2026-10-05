import { expect, type Page, test } from "@playwright/test";
import { applyEvent, type PublicState } from "../src/shared/engine/index.js";
import type {
  RoomCredentials,
  ServerMessage,
} from "../src/shared/protocol/index.js";

const SIZES = [
  { width: 1280, height: 720, players: 2 },
  { width: 1440, height: 900, players: 3 },
  { width: 1920, height: 1080, players: 4 },
] as const;
const NAMES = ["Alexandrine-Montgomery", "Benoît", "Camille", "Daria"];

function observeState(page: Page) {
  let state: PublicState | null = null;
  let created: PublicState | null = null;
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (!String(payload).startsWith("{")) return;
      const message = JSON.parse(String(payload)) as ServerMessage;
      if (message.type === "welcome") state = message.snapshot;
      if (message.type === "events")
        for (const event of message.events) {
          if (event.type === "GameCreated") state = created = event.state;
          else if (state) state = applyEvent(state, event);
        }
    });
  });
  return { current: () => state, created: () => created };
}

async function seatLocalPlayers(page: Page, count: number, english: boolean) {
  const seats = page.locator(".lobby-seats");
  await expect(seats.locator(".lobby-seat.filled.human")).toHaveCount(1);
  for (let seat = 1; seat < count; seat++) {
    await page
      .getByRole("button", {
        name: english
          ? `Add a player on this PC to seat ${seat + 1}`
          : `Ajouter un joueur sur ce PC à la place ${seat + 1}`,
      })
      .click();
    await page
      .getByLabel(english ? "Player on this PC" : "Joueur sur ce PC", {
        exact: true,
      })
      .fill(NAMES[seat]);
    await page
      .getByRole("button", { name: english ? "Add" : "Ajouter", exact: true })
      .click();
    await expect(seats.locator(".lobby-seat.filled.human")).toHaveCount(
      seat + 1,
    );
  }
}

for (const size of SIZES) {
  for (const reducedMotion of [false, true]) {
    const english = reducedMotion;
    test(`start wheel follows the board with ${size.players} players at ${size.width}x${size.height} (${english ? "EN reduced motion" : "FR animated"})`, async ({
      page,
      request,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const observed = observeState(page);
      await page.setViewportSize(size);
      await page.emulateMedia({
        reducedMotion: reducedMotion ? "reduce" : "no-preference",
      });
      const response = await request.post("/api/rooms", {
        data: {
          name: NAMES[0],
          bots: 0,
          config: { decisionSeconds: 60, extraRollOnDouble: false },
        },
      });
      expect(response.status()).toBe(201);
      const credentials: RoomCredentials = await response.json();
      await page.addInitScript(
        ({ credentials: session, english: en }) => {
          sessionStorage.setItem("polytour-room-v1", JSON.stringify(session));
          localStorage.setItem("polytour.locale", en ? "en" : "fr");
          localStorage.setItem("polytour.lowGraphics", "true");
        },
        { credentials, english },
      );
      await page.goto("/");
      await seatLocalPlayers(page, size.players, english);
      // Keep the bounded reveal on screen while inspecting its real rendering.
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      await page
        .getByRole("button", {
          name: english ? "Start game" : "Démarrer la partie",
          exact: true,
        })
        .click();
      const dialog = page.locator(".start-order-dialog[open]");
      await expect(dialog).toBeVisible();
      await expect.poll(() => observed.created()).not.toBeNull();
      const state = observed.created();
      if (!state) throw new Error("Expected authoritative GameCreated");
      const seats = state.players.map((player) => player.seat);
      const start = seats.indexOf(state.activeSeat);
      expect(state.turnOrder).toEqual([
        ...seats.slice(start),
        ...seats.slice(0, start),
      ]);
      await expect(dialog).toHaveAttribute(
        "data-starter",
        String(state.activeSeat),
      );
      await expect(dialog).toHaveAttribute(
        "data-reduced-motion",
        String(reducedMotion),
      );
      await expect(page.locator(".player-card")).toHaveCount(size.players);
      await expect(page.locator(".roll-button")).not.toBeVisible();
      if (!reducedMotion) {
        await expect(dialog).toHaveAttribute("data-revealed", "false");
        await expect(dialog.locator(".start-order-result")).toHaveText("");
        await expect(dialog.locator(".start-order-sequence")).not.toBeVisible();
        for (const badge of await dialog
          .locator(".start-order-player .start-order-number")
          .all())
          await expect(badge).toHaveText("");
        // Selection lasts a second longer; badges stay blank while it spins.
        await page.clock.runFor(3000);
        await expect(dialog).toHaveAttribute("data-revealed", "false");
        await page.screenshot({
          path: `.local/verification/start-order-${size.width}-fr-spinning.png`,
        });
        await page.clock.runFor(900);
      }
      await expect(dialog).toHaveAttribute("data-revealed", "true");
      await expect(dialog.locator(".start-order-sequence")).toBeVisible();
      await expect(dialog.locator(".start-order-result")).toContainText(
        NAMES[state.activeSeat],
      );
      const sequence = await dialog
        .locator(".start-order-sequence > li")
        .evaluateAll((items) =>
          items.map((item) => Number(item.getAttribute("data-seat"))),
        );
      expect(sequence).toEqual(state.turnOrder);
      for (const player of state.players) {
        const token = dialog.locator(
          `.start-order-player[data-seat="${player.seat}"]`,
        );
        await expect(token).toContainText(player.name);
        await expect(token.locator(".start-order-number")).toHaveText(
          String(state.startingTurnOrder.indexOf(player.seat) + 1),
        );
      }
      const box = await dialog.boundingBox();
      if (!box) throw new Error("Expected start dialog bounds");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.local/verification/start-order-${size.width}-${english ? "en-reduced" : "fr"}.png`,
      });
      if (size.players === 4 && !reducedMotion) {
        // Hold the revealed result past the old timeout, then finish at seven seconds.
        await page.clock.runFor(3000);
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute("data-revealed", "true");
        await expect(dialog.locator(".start-order-sequence")).toBeVisible();
        await expect(dialog.locator(".start-order-result")).toContainText(
          NAMES[state.activeSeat],
        );
        await expect(page.locator(".roll-button")).not.toBeVisible();
        await page.clock.runFor(200);
      } else {
        // Native keyboard dismissal finishes the Director moment and returns focus.
        await page.keyboard.press("Escape");
      }
      await expect(dialog).toHaveCount(0);
      const roll = page.getByRole("button", {
        name: english ? "Roll the dice" : "Lancer les dés",
        exact: true,
      });
      await expect(roll).toBeEnabled();
      await expect(roll).toBeFocused();
      await expect(page.locator(".player-card.active")).toHaveAttribute(
        "data-seat",
        String(state.activeSeat),
      );
      // Reconnect timers need real time after the reveal's screenshot pause.
      await page.clock.resume();
      // Refresh recovers from a snapshot and never spins the starter again.
      await page.reload();
      await expect(page.locator(".player-card")).toHaveCount(size.players);
      await expect(page.locator(".start-order-dialog[open]")).toHaveCount(0);
      await expect(roll).toBeEnabled();
      expect(observed.current()?.startingTurnOrder).toEqual(
        state.startingTurnOrder,
      );
      expect(errors).toEqual([]);
    });
  }
}

test("friends see the same starter, then keep the board order after a real roll and reconnect", async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  const hostState = observeState(page);
  page.on("pageerror", (error) => errors.push(error.message));
  const created = await request.post("/api/rooms", {
    data: {
      name: "Alice",
      config: { decisionSeconds: 60, extraRollOnDouble: false },
    },
  });
  expect(created.status()).toBe(201);
  const host: RoomCredentials = await created.json();
  const joined = await request.post(`/api/rooms/${host.roomCode}/join`, {
    data: { name: "Benoît" },
  });
  expect(joined.status()).toBe(200);
  const friend: RoomCredentials = await joined.json();
  const guestContext = await browser.newContext({ reducedMotion: "reduce" });
  try {
    const guest = await guestContext.newPage();
    const guestState = observeState(guest);
    guest.on("pageerror", (error) => errors.push(error.message));
    for (const [participant, session] of [
      [page, host],
      [guest, friend],
    ] as const) {
      await participant.emulateMedia({ reducedMotion: "reduce" });
      await participant.addInitScript((credentials) => {
        sessionStorage.setItem("polytour-room-v1", JSON.stringify(credentials));
        localStorage.setItem("polytour.locale", "fr");
        localStorage.setItem("polytour.lowGraphics", "true");
      }, session);
      await participant.goto("/");
      await expect(participant.locator(".lobby-seat.filled.human")).toHaveCount(
        2,
      );
    }
    await page
      .getByRole("button", { name: "Démarrer la partie", exact: true })
      .click();
    await expect(page.locator(".start-order-dialog[open]")).toBeVisible();
    await expect(guest.locator(".start-order-dialog[open]")).toBeVisible();
    const first = hostState.created();
    if (!first) throw new Error("Expected live starting state");
    await expect(guest.locator(".start-order-dialog[open]")).toHaveAttribute(
      "data-starter",
      String(first.activeSeat),
    );
    expect(guestState.created()?.startingTurnOrder).toEqual(
      first.startingTurnOrder,
    );
    await expect(page.locator(".start-order-dialog[open]")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(guest.locator(".start-order-dialog[open]")).toHaveCount(0);
    const currentPlayer = first.activeSeat === host.seat ? page : guest;
    const waitingPlayer = currentPlayer === page ? guest : page;
    await expect(
      waitingPlayer.getByRole("button", {
        name: "Lancer les dés",
        exact: true,
      }),
    ).toHaveCount(0);
    await currentPlayer
      .getByRole("button", { name: "Lancer les dés", exact: true })
      .click();
    await expect.poll(() => hostState.current()?.lastRoll).not.toBeNull();
    await expect
      .poll(() => guestState.current()?.lastRoll)
      .toEqual(hostState.current()?.lastRoll);
    await expect
      .poll(() => guestState.current()?.startingTurnOrder)
      .toEqual(first.startingTurnOrder);
    await guest.reload();
    await expect(guest.locator(".player-card")).toHaveCount(2);
    await expect(guest.locator(".start-order-dialog[open]")).toHaveCount(0);
    expect(guestState.current()?.startingTurnOrder).toEqual(
      first.startingTurnOrder,
    );
    expect(errors).toEqual([]);
  } finally {
    await guestContext.close();
  }
});
