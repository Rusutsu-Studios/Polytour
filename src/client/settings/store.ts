import { useSyncExternalStore } from "react";

export type ClientSettings = {
  version: 1;
  graphics: "high" | "low";
  boardZoom: number;
  reducedMotion: "system" | "on" | "off";
  locale: "fr" | "en";
};

export const SETTINGS_KEY = "polytour.settings.v1";
const listeners = new Set<() => void>();
const motionListeners = new Set<() => void>();

function browserLocale(): ClientSettings["locale"] {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return "fr";
  for (const language of [...(navigator.languages ?? []), navigator.language]) {
    const supported = language?.toLowerCase().split("-")[0];
    if (supported === "fr" || supported === "en") return supported;
  }
  return "fr";
}

function defaults(): ClientSettings {
  return {
    version: 1,
    graphics: "high",
    boardZoom: 1,
    reducedMotion: "system",
    locale: browserLocale(),
  };
}

function validate(value: unknown, fallback: ClientSettings): ClientSettings {
  if (!value || typeof value !== "object" || !("version" in value))
    return fallback;
  if (value.version !== 1) return fallback;
  const record = value as Record<string, unknown>;
  return {
    version: 1,
    graphics:
      record.graphics === "high" || record.graphics === "low"
        ? record.graphics
        : fallback.graphics,
    boardZoom:
      typeof record.boardZoom === "number" && Number.isFinite(record.boardZoom)
        ? Math.max(0.8, Math.min(1.3, record.boardZoom))
        : fallback.boardZoom,
    reducedMotion:
      record.reducedMotion === "system" ||
      record.reducedMotion === "on" ||
      record.reducedMotion === "off"
        ? record.reducedMotion
        : fallback.reducedMotion,
    locale:
      record.locale === "fr" || record.locale === "en"
        ? record.locale
        : fallback.locale,
  };
}

function save(settings: ClientSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Preferences still apply to this page when browser storage is unavailable.
  }
}

function read(): ClientSettings {
  const fallback = defaults();
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY);
    if (saved !== null) return validate(JSON.parse(saved) as unknown, fallback);
    const graphics = window.localStorage.getItem("polytour.lowGraphics");
    const motion = window.localStorage.getItem("polytour.reducedMotion");
    const locale = window.localStorage.getItem("polytour.locale");
    const migrated: ClientSettings = {
      ...fallback,
      graphics: graphics === "true" ? "low" : "high",
      reducedMotion:
        motion === "true" ? "on" : motion === "false" ? "off" : "system",
      locale: locale === "fr" || locale === "en" ? locale : fallback.locale,
    };
    save(migrated);
    return migrated;
  } catch {
    return fallback;
  }
}

let settings = read();
const systemMotion =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
let systemReducedMotion = systemMotion?.matches ?? false;

export function getSettings(): ClientSettings {
  return settings;
}

export function getReducedMotion(): boolean {
  return (
    settings.reducedMotion === "on" ||
    (settings.reducedMotion === "system" && systemReducedMotion)
  );
}

function notifyMotion(previous: boolean) {
  const reducedMotion = getReducedMotion();
  if (typeof document !== "undefined")
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  if (previous === reducedMotion) return;
  for (const listener of motionListeners) listener();
}

function apply(next: ClientSettings) {
  if (
    next.graphics === settings.graphics &&
    next.boardZoom === settings.boardZoom &&
    next.reducedMotion === settings.reducedMotion &&
    next.locale === settings.locale
  )
    return;
  const previousMotion = getReducedMotion();
  settings = next;
  notifyMotion(previousMotion);
  for (const listener of listeners) listener();
}

export function updateSettings(
  patch: Partial<Omit<ClientSettings, "version">>,
) {
  const next = validate({ ...settings, ...patch, version: 1 }, settings);
  save(next);
  apply(next);
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeReducedMotion(listener: () => void) {
  motionListeners.add(listener);
  return () => motionListeners.delete(listener);
}

export function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

export function useResolvedReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => false,
  );
}

notifyMotion(getReducedMotion());
systemMotion?.addEventListener("change", (event) => {
  const previous = getReducedMotion();
  systemReducedMotion = event.matches;
  notifyMotion(previous);
});

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === SETTINGS_KEY || event.key === null) apply(read());
  });
}
