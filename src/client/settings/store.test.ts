import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "polytour.settings.v1";

async function setup({
  values = {},
  languages = ["en-GB"],
  reducedMotion = false,
  unavailable = false,
}: {
  values?: Record<string, string>;
  languages?: string[];
  reducedMotion?: boolean;
  unavailable?: boolean;
} = {}) {
  vi.resetModules();
  const saved = new Map(Object.entries(values));
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  };
  const media = Object.assign(new EventTarget(), { matches: reducedMotion });
  const window = Object.assign(new EventTarget(), {
    localStorage: storage,
    matchMedia: () => media,
  });
  const document = Object.assign(new EventTarget(), {
    documentElement: { dataset: {} as Record<string, string>, lang: "" },
    querySelector: () => null,
    title: "",
    hidden: false,
  });
  if (unavailable)
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage is blocked");
      },
    });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", { languages, language: languages[0] });
  const store = await import("./store.js");
  return {
    ...store,
    saved,
    document,
    storageEvent(key: string | null = KEY) {
      window.dispatchEvent(Object.assign(new Event("storage"), { key }));
    },
    systemMotion(matches: boolean) {
      media.matches = matches;
      media.dispatchEvent(Object.assign(new Event("change"), { matches }));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("local settings", () => {
  it("persists Potato PC and restores it without changing other preferences", async () => {
    const store = await setup();
    store.updateSettings({ graphics: "potato", boardZoom: 1.2 });
    const saved = store.saved.get(KEY);
    expect(JSON.parse(saved ?? "null")).toMatchObject({ graphics: "potato" });
    const restored = await setup({ values: { [KEY]: saved ?? "" } });
    expect(restored.getSettings()).toEqual(store.getSettings());
    restored.updateSettings({ graphics: "low" });
    expect(restored.getSettings()).toMatchObject({
      graphics: "low",
      boardZoom: 1.2,
      reducedMotion: "system",
      locale: "en",
    });
  });

  it("keeps the French fallback outside a browser even when navigator exists", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", { languages: ["en-GB"], language: "en-GB" });
    const store = await import("./store.js");
    expect(store.getSettings().locale).toBe("fr");
  });

  it("migrates the existing choices and leaves their keys in place", async () => {
    const legacy = {
      "polytour.lowGraphics": "true",
      "polytour.reducedMotion": "false",
      "polytour.locale": "fr",
    };
    const store = await setup({ values: legacy, reducedMotion: true });
    expect(store.getSettings()).toEqual({
      version: 1,
      graphics: "low",
      boardZoom: 1,
      reducedMotion: "off",
      locale: "fr",
    });
    expect(JSON.parse(store.saved.get(KEY) ?? "null")).toEqual(
      store.getSettings(),
    );
    for (const [key, value] of Object.entries(legacy))
      expect(store.saved.get(key)).toBe(value);
    expect(store.getReducedMotion()).toBe(false);
  });

  it("keeps the browser's first supported language and system motion by default", async () => {
    const store = await setup({
      languages: ["de-CH", "fr-CH", "en-GB"],
      reducedMotion: true,
    });
    expect(store.getSettings()).toMatchObject({
      graphics: "high",
      boardZoom: 1,
      reducedMotion: "system",
      locale: "fr",
    });
    expect(store.getReducedMotion()).toBe(true);
    expect(store.document.documentElement.dataset.reducedMotion).toBe("true");
  });

  it("uses safe defaults for malformed and future versions without replacing the saved record", async () => {
    for (const value of [
      "{broken",
      "null",
      "[]",
      JSON.stringify({ version: 2, graphics: "low" }),
    ]) {
      const store = await setup({ values: { [KEY]: value } });
      expect(store.getSettings()).toEqual({
        version: 1,
        graphics: "high",
        boardZoom: 1,
        reducedMotion: "system",
        locale: "en",
      });
      expect(store.saved.get(KEY)).toBe(value);
    }
  });

  it("validates each stored field and clamps valid zoom numbers to the existing limits", async () => {
    const store = await setup({
      values: {
        [KEY]: JSON.stringify({
          version: 1,
          graphics: "ultra",
          boardZoom: "1.2",
          reducedMotion: true,
          locale: "de",
        }),
      },
    });
    expect(store.getSettings()).toMatchObject({
      graphics: "high",
      boardZoom: 1,
      reducedMotion: "system",
      locale: "en",
    });
    store.updateSettings({ boardZoom: 99 });
    expect(store.getSettings().boardZoom).toBe(1.3);
    store.updateSettings({ boardZoom: -99 });
    expect(store.getSettings().boardZoom).toBe(0.8);
    store.updateSettings({ boardZoom: Number.NaN });
    expect(store.getSettings().boardZoom).toBe(0.8);
    store.updateSettings({ boardZoom: Number.POSITIVE_INFINITY });
    expect(store.getSettings().boardZoom).toBe(0.8);
  });

  it("applies preferences in memory even when storage is unavailable", async () => {
    const store = await setup({ unavailable: true });
    const listener = vi.fn();
    store.subscribeSettings(listener);
    expect(() =>
      store.updateSettings({
        locale: "fr",
        graphics: "low",
        reducedMotion: "on",
        boardZoom: 1.2,
      }),
    ).not.toThrow();
    expect(store.getSettings()).toMatchObject({
      locale: "fr",
      graphics: "low",
      reducedMotion: "on",
      boardZoom: 1.2,
    });
    expect(store.getReducedMotion()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("saves all preferences and notifies subscribers only when the snapshot changes", async () => {
    const store = await setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribeSettings(listener);
    const initial = store.getSettings();
    store.updateSettings({ graphics: "high" });
    expect(store.getSettings()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    store.updateSettings({ graphics: "low", boardZoom: 1.1 });
    expect(listener).toHaveBeenCalledOnce();
    expect(JSON.parse(store.saved.get(KEY) ?? "null")).toEqual(
      store.getSettings(),
    );
    unsubscribe();
    store.updateSettings({ locale: "fr" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("applies changes from another tab and handles a storage clear", async () => {
    const store = await setup();
    const listener = vi.fn();
    store.subscribeSettings(listener);
    store.saved.set(
      KEY,
      JSON.stringify({
        ...store.getSettings(),
        graphics: "low",
        locale: "fr",
        reducedMotion: "on",
        boardZoom: 1.2,
      }),
    );
    store.storageEvent("unrelated");
    expect(listener).not.toHaveBeenCalled();
    store.storageEvent();
    expect(store.getSettings()).toMatchObject({
      graphics: "low",
      locale: "fr",
      reducedMotion: "on",
      boardZoom: 1.2,
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(store.document.documentElement.dataset.reducedMotion).toBe("true");
    store.saved.clear();
    store.storageEvent(null);
    expect(store.getSettings()).toMatchObject({
      graphics: "high",
      locale: "en",
      reducedMotion: "system",
      boardZoom: 1,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("follows system changes, honors overrides, and resumes following after selecting System", async () => {
    const store = await setup();
    const listener = vi.fn();
    store.subscribeReducedMotion(listener);
    store.systemMotion(true);
    expect(store.getReducedMotion()).toBe(true);
    store.updateSettings({ reducedMotion: "on" });
    store.systemMotion(false);
    expect(store.getReducedMotion()).toBe(true);
    store.updateSettings({ reducedMotion: "off" });
    expect(store.getReducedMotion()).toBe(false);
    store.systemMotion(true);
    expect(store.getReducedMotion()).toBe(false);
    store.updateSettings({ reducedMotion: "system" });
    expect(store.getReducedMotion()).toBe(true);
    store.systemMotion(false);
    expect(store.getReducedMotion()).toBe(false);
    expect(store.document.documentElement.dataset.reducedMotion).toBe("false");
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("preserves a page's title when unrelated preferences change", async () => {
    const store = await setup();
    await import("../i18n.js");
    expect(store.document.title).toBe(
      "Polytour - Online Multiplayer Board Game",
    );
    const pageTitle = "404 · You've taken a wrong turn · Polytour";
    store.document.title = pageTitle;
    store.updateSettings({
      graphics: "low",
      boardZoom: 1.2,
      reducedMotion: "on",
    });
    expect(store.document.title).toBe(pageTitle);
    store.saved.set(
      KEY,
      JSON.stringify({
        ...store.getSettings(),
        graphics: "high",
        boardZoom: 1.1,
        reducedMotion: "off",
      }),
    );
    store.storageEvent();
    expect(store.document.title).toBe(pageTitle);
    store.updateSettings({ locale: "fr" });
    expect(store.document.title).toBe(
      "Polytour - Jeu de plateau multijoueur en ligne",
    );
    expect(store.document.documentElement.lang).toBe("fr");
  });

  it("keeps language metadata and Director motion on the same preference store", async () => {
    const store = await setup();
    const { getLocale, setLocale, translate } = await import("../i18n.js");
    const { director } = await import("../director/director.js");
    setLocale("fr");
    expect(getLocale()).toBe("fr");
    expect(store.getSettings().locale).toBe("fr");
    expect(translate("Bonjour", "Hello")).toBe("Bonjour");
    expect(store.document.documentElement.lang).toBe("fr");
    director.setReducedMotion(true);
    expect(store.getSettings().reducedMotion).toBe("on");
    expect(director.getSnapshot().reducedMotion).toBe(true);
    store.updateSettings({ reducedMotion: "system" });
    expect(director.getSnapshot().reducedMotion).toBe(false);
    store.systemMotion(true);
    expect(director.getSnapshot().reducedMotion).toBe(true);
    store.saved.set(
      KEY,
      JSON.stringify({
        ...store.getSettings(),
        locale: "en",
        reducedMotion: "off",
      }),
    );
    store.storageEvent();
    expect(getLocale()).toBe("en");
    expect(store.document.documentElement.lang).toBe("en");
    expect(director.getSnapshot().reducedMotion).toBe(false);
  });
});
