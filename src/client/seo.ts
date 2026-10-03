const LOCALE_METADATA = {
  fr: {
    title: "Polytour — Jeu de plateau multijoueur en ligne",
    description:
      "Jouez à Polytour, un jeu de plateau immobilier pour 2 à 4 joueurs. Achetez des villes, construisez et jouez entre amis ou contre des bots dans votre navigateur.",
    imageAlt: "Plateau de jeu Polytour avec ses villes et ses pions",
    socialLocale: "fr_FR",
    alternateLocale: "en_GB",
  },
  en: {
    title: "Polytour — Online Multiplayer Board Game",
    description:
      "Play Polytour, a property-trading board game for 2–4 players. Buy cities, build and play with friends or bots in your browser.",
    imageAlt: "Polytour game board with cities and player tokens",
    socialLocale: "en_GB",
    alternateLocale: "fr_FR",
  },
} as const;

function setMeta(attribute: "name" | "property", key: string, value: string) {
  document
    .querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
    ?.setAttribute("content", value);
}

/** Language is a display preference on the same canonical URL. */
export function applyLocaleMetadata(locale: keyof typeof LOCALE_METADATA) {
  if (typeof document === "undefined") return;
  const metadata = LOCALE_METADATA[locale];
  document.documentElement.lang = locale;
  document.title = metadata.title;
  setMeta("name", "description", metadata.description);
  setMeta("property", "og:title", metadata.title);
  setMeta("property", "og:description", metadata.description);
  setMeta("property", "og:image:alt", metadata.imageAlt);
  setMeta("property", "og:locale", metadata.socialLocale);
  setMeta("property", "og:locale:alternate", metadata.alternateLocale);
  setMeta("name", "twitter:title", metadata.title);
  setMeta("name", "twitter:description", metadata.description);
  setMeta("name", "twitter:image:alt", metadata.imageAlt);
}
