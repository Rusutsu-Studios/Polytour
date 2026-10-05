import { useSyncExternalStore } from "react";
import { applyLocaleMetadata } from "./seo.js";

export type Locale = "fr" | "en";
const STORAGE_KEY = "polytour.locale";
const listeners = new Set<() => void>();

function initialLocale(): Locale {
  if (typeof window === "undefined") return "fr";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    // Browser language still applies when preference storage is unavailable.
  }
  for (const language of [...navigator.languages, navigator.language]) {
    const supported = language.toLowerCase().split("-")[0];
    if (supported === "fr" || supported === "en") return supported;
  }
  return "fr";
}

let locale = initialLocale();

function applyLocale(next: Locale) {
  applyLocaleMetadata(next);
  if (locale === next) return;
  locale = next;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  applyLocaleMetadata(locale);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null)
      applyLocale(initialLocale());
  });
}

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The language choice still works when browser storage is unavailable.
  }
  applyLocale(next);
}

export function translate(fr: string, en: string): string {
  return locale === "en" ? en : fr;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Language is a local display preference; it never enters the room protocol. */
export function useLocale() {
  const current = useSyncExternalStore(
    subscribe,
    getLocale,
    () => "fr" as Locale,
  );
  return { locale: current, setLocale, t: translate };
}
