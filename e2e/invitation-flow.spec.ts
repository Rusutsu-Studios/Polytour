import { expect, type Page, test } from "@playwright/test";
import {
  type ClientMessage,
  PROTOCOL_VERSION,
  RoomConfigSchema,
  type RoomCredentials,
} from "../src/shared/protocol/index.js";

test.use({ reducedMotion: "reduce" });

const invitedRoom = "ABCD23";
const credentials: RoomCredentials = {
  roomCode: invitedRoom,
  seat: 1,
  token: "invitation-test-capability-not-real",
};

async function mockRoom(page: Page, session = credentials) {
  const connections: string[] = [];
  const messages: ClientMessage[] = [];
  await page.routeWebSocket("**/ws/room/**", (socket) => {
    connections.push(new URL(socket.url()).pathname);
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as ClientMessage;
      messages.push(message);
      if (message.type !== "sync") return;
      socket.send(
        JSON.stringify({
          type: "welcome",
          protocolVersion: PROTOCOL_VERSION,
          you: { seat: session.seat },
          seq: 0,
          snapshot: null,
          randomness: null,
          lobby: {
            roomCode: session.roomCode,
            hostSeat: 0,
            status: "lobby",
            config: RoomConfigSchema.parse({}),
            seats: [0, 1, 2, 3].map((seat) => ({
              seat,
              name: ["Invitation host", "Invited player", "", ""][seat],
              control: seat < 2 ? "human" : null,
              online: seat < 2,
            })),
          },
        }),
      );
    });
  });
  return { connections, messages };
}

for (const locale of ["fr", "en"] as const) {
  test(`${locale} invitation asks only for a nickname and fits desktop keyboard layouts`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/rooms**", (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.addInitScript((language) => {
      localStorage.setItem("polytour.locale", language);
    }, locale);
    await page.goto(`/?room=${invitedRoom}`);
    const invitation = page.locator(".invitation-entry");
    const name = page.getByLabel(
      locale === "fr" ? "Votre nom de joueur" : "Player name",
    );
    const join = invitation.getByRole("button", {
      name: locale === "fr" ? "Rejoindre" : "Join",
      exact: true,
    });
    await expect(
      invitation.getByRole("heading", {
        name: locale === "fr" ? "Rejoindre la salle" : "Join room",
      }),
    ).toBeVisible();
    await expect(name).toBeFocused();
    await expect(invitation.getByRole("textbox")).toHaveCount(1);
    await expect(page.locator("#room-code")).toHaveCount(0);
    await expect(page.locator(".welcome-quick-settings")).toHaveCount(0);
    await expect(invitation.getByRole("slider")).toHaveCount(0);
    await expect(invitation.getByRole("button")).toHaveCount(1);
    await expect(invitation).not.toContainText(/ABCD23|bots|Créer|Create/);
    // Room codes stay in the link and the request, never in invitation text,
    // tooltips, accessibility labels, hidden fields, or data attributes.
    expect(
      await invitation.evaluate((element) => element.outerHTML),
    ).not.toContain(invitedRoom);
    await page.keyboard.press("Tab");
    await expect(join).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(name).toBeFocused();
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      const bounds = await invitation.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect(bounds?.y).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
        size.width,
      );
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
        size.height,
      );
      const viewport = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        height: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      expect(viewport.scrollWidth).toBe(viewport.width);
      expect(viewport.scrollHeight).toBeLessThanOrEqual(viewport.height);
      await expect(page.locator("main")).toHaveAttribute(
        "data-reduced-motion",
        "true",
      );
      await expect(name).toBeFocused();
      await page.screenshot({
        path: `.local/verification/invitation-${locale}-${size.width}.png`,
      });
    }
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("Enter joins the normalized invitation once, trims the nickname, and never creates or starts a game", async ({
  page,
}) => {
  const requests: { path: string; body: unknown }[] = [];
  let releaseJoin: () => void = () => {};
  const responseReady = new Promise<void>((resolve) => {
    releaseJoin = resolve;
  });
  const room = await mockRoom(page);
  await page.route("**/api/rooms**", async (route) => {
    requests.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    await responseReady;
    await route.fulfill({ status: 200, json: credentials });
  });
  await page.goto("/?room=%20abcd23%20");
  const name = page.getByLabel("Votre nom de joueur");
  const join = page.locator(".invitation-form button[type=submit]");
  await name.fill("   ");
  await name.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Choisissez un nom");
  await expect(name).toBeFocused();
  expect(requests).toEqual([]);
  await name.fill("  Invited player  ");
  try {
    await name.press("Enter");
    await expect.poll(() => requests.length).toBe(1);
    await expect(join).toBeDisabled();
    await expect(join.locator(".spinner")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Quitter", exact: true }),
    ).toBeDisabled();
    // Dispatch another native submit even if the nickname field is disabled.
    // The in-flight guard must also protect programmatic/native resubmission.
    await page.locator(".invitation-form").evaluate((element) => {
      const form = element as HTMLFormElement;
      for (let index = 0; index < 5; index += 1) form.requestSubmit();
    });
    expect(requests).toHaveLength(1);
  } finally {
    releaseJoin();
  }
  await expect(page.locator(".room-lobby")).toBeVisible();
  await expect(page.locator(".waiting-host")).toBeVisible();
  expect(requests).toEqual([
    {
      path: `/api/rooms/${invitedRoom}/join`,
      body: { name: "Invited player" },
    },
  ]);
  await expect.poll(() => room.connections.length).toBe(1);
  expect(room.connections).toEqual([`/ws/room/${invitedRoom}`]);
  expect(room.messages).toEqual([{ type: "sync", lastSeq: null }]);
  expect(new URL(page.url()).searchParams.get("room")).toBe(invitedRoom);
  expect(await page.evaluate(() => localStorage.getItem("polytour-name"))).toBe(
    "Invited player",
  );
  expect(
    JSON.parse(
      (await page.evaluate(() => sessionStorage.getItem("polytour-room-v1"))) ??
        "null",
    ),
  ).toEqual(credentials);
});

test("failed invitation joins retain the nickname and target and allow retry", async ({
  page,
}) => {
  const responses = [
    { status: 404, error: "room-not-found", text: "Cette salle n’existe pas" },
    { status: 409, error: "room-full", text: "Cette salle est complète" },
    { status: 409, error: "game-started", text: "La partie a déjà commencé" },
    { status: 503, error: "room-service-unavailable", text: "HTTP 503" },
  ];
  const requests: { path: string; body: unknown }[] = [];
  await page.route("**/api/rooms**", (route) => {
    requests.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    const response = responses[requests.length - 1];
    return response
      ? route.fulfill({
          status: response.status,
          json: { error: response.error },
        })
      : route.abort("failed");
  });
  await page.goto(`/?room=${invitedRoom}`);
  const name = page.getByLabel("Votre nom de joueur");
  const join = page.getByRole("button", { name: "Rejoindre", exact: true });
  await name.fill("Retry guest");
  for (const response of responses) {
    await join.click();
    await expect(page.getByRole("alert")).toContainText(response.text);
    await expect(page.locator(".invitation-entry")).toBeVisible();
    await expect(name).toHaveValue("Retry guest");
    await expect(name).toBeFocused();
    await expect(join).toBeEnabled();
    expect(new URL(page.url()).searchParams.get("room")).toBe(invitedRoom);
    expect(
      await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
    ).toBeNull();
  }
  await name.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Impossible de joindre le serveur de jeu",
  );
  await expect(name).toHaveValue("Retry guest");
  await expect(name).toBeFocused();
  await expect(join).toBeEnabled();
  expect(requests).toEqual(
    Array.from({ length: responses.length + 1 }, () => ({
      path: `/api/rooms/${invitedRoom}/join`,
      body: { name: "Retry guest" },
    })),
  );
});

test("Leave clears the invitation, failed error and join code and restores normal home", async ({
  page,
}) => {
  await page.route("**/api/rooms/**/join", (route) =>
    route.fulfill({ status: 409, json: { error: "room-full" } }),
  );
  await page.goto(`/?room=${invitedRoom}`);
  await page.getByLabel("Votre nom de joueur").fill("Leaving guest");
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Quitter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nouvelle partie" }),
  ).toBeVisible();
  await expect(page.locator(".invitation-entry")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Vous avez un code ?")).toHaveValue("");
  await expect(page.getByLabel("Votre nom de joueur")).toHaveValue(
    "Leaving guest",
  );
  await expect(
    page.getByRole("button", { name: "Jouer avec 3 bots" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Créer une salle entre amis" }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Nouvelle partie" }),
  ).toBeVisible();
});

test("a saved nickname and other-room credentials keep the invitation open until explicit join", async ({
  page,
}) => {
  const oldCredentials = { ...credentials, roomCode: "WXYZ89" };
  const room = await mockRoom(page);
  let joins = 0;
  await page.route("**/api/rooms**", (route) => {
    joins += 1;
    expect(new URL(route.request().url()).pathname).toBe(
      `/api/rooms/${invitedRoom}/join`,
    );
    expect(route.request().postDataJSON()).toEqual({ name: "Saved guest" });
    return route.fulfill({ status: 200, json: credentials });
  });
  await page.addInitScript((previous) => {
    localStorage.setItem("polytour-name", "Saved guest");
    sessionStorage.setItem("polytour-room-v1", JSON.stringify(previous));
  }, oldCredentials);
  await page.goto(`/?room=${invitedRoom}`);
  await expect(page.locator(".invitation-entry")).toBeVisible();
  await expect(page.getByLabel("Votre nom de joueur")).toHaveValue(
    "Saved guest",
  );
  expect(room.connections).toEqual([]);
  expect(joins).toBe(0);
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(page.locator(".waiting-host")).toBeVisible();
  expect(joins).toBe(1);
  expect(room.connections).toEqual([`/ws/room/${invitedRoom}`]);
  expect(
    JSON.parse(
      (await page.evaluate(() => sessionStorage.getItem("polytour-room-v1"))) ??
        "null",
    ),
  ).toEqual(credentials);
});

test("same-room saved credentials reconnect without a nickname prompt or duplicate join", async ({
  page,
}) => {
  const room = await mockRoom(page);
  const requests: string[] = [];
  await page.route("**/api/rooms**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript((session) => {
    sessionStorage.setItem("polytour-room-v1", JSON.stringify(session));
  }, credentials);
  await page.goto("/?room=%20abcd23%20");
  await expect(page.locator(".waiting-host")).toBeVisible();
  await expect(page.locator(".invitation-entry")).toHaveCount(0);
  await expect(page.getByLabel("Votre nom de joueur")).toHaveCount(0);
  // React StrictMode remounts effects in development. Every connection must
  // resume this saved seat; no HTTP join or connection to another room occurs.
  expect(room.connections.length).toBeGreaterThanOrEqual(1);
  expect(new Set(room.connections)).toEqual(
    new Set([`/ws/room/${invitedRoom}`]),
  );
  expect(requests).toEqual([]);
});

test("invalid invitation parameters fail upfront in both languages without joining or reconnecting", async ({
  page,
}) => {
  const room = await mockRoom(page);
  const requests: string[] = [];
  await page.route("**/api/rooms**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript((session) => {
    sessionStorage.setItem("polytour-room-v1", JSON.stringify(session));
  }, credentials);
  for (const code of ["", "   ", "ABCD", "ABCD23X", "ABCD01", "<script>"]) {
    await page.goto(`/?room=${encodeURIComponent(code)}`);
    await expect(page.locator(".invitation-entry")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText(
      "Lien d’invitation invalide. Demandez un nouveau lien à l’hôte.",
    );
    await expect(
      page.locator(".invitation-entry button[type=submit]:enabled"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Jouer avec 3 bots" }),
    ).toHaveCount(0);
    await expect(page.locator("#room-code")).toHaveCount(0);
    expect(requests).toEqual([]);
    expect(room.connections).toEqual([]);
  }
  await page.getByLabel("Langue / Language").selectOption("en");
  await expect(page.getByRole("alert")).toHaveText(
    "Invalid invitation link. Ask the host for a new link.",
  );
  await expect(page.getByRole("heading", { name: "Join room" })).toBeVisible();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New game" })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});
