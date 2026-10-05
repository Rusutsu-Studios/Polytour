import { useEffect } from "react";
import { useLocale } from "../i18n.js";
import LanguagePicker from "./LanguagePicker.js";
import "./NotFound.css";

// THESIS: A wrong turn ends at a toy roundabout, with one clear road home.
// OWN-WORLD: Polytour's sky, grassy center, ivory road markings and coral car.
// STORY: Recognize a missing page and return to the game's home screen.
// FIRST VIEWPORT: Centered roundabout above the error heading and home link.
// FORM: An extension of the existing toy-board world, with a gently idling car.
export default function NotFound() {
  const { t } = useLocale();
  const heading = t(
    "Vous avez pris un mauvais tournant",
    "You've taken a wrong turn",
  );
  useEffect(() => {
    document.title = `404 · ${heading} · Polytour`;
  }, [heading]);
  return (
    <main className="not-found">
      <nav aria-label={t("Langue", "Language")}>
        <LanguagePicker />
      </nav>
      <svg
        className="not-found-roundabout"
        viewBox="0 0 420 300"
        aria-hidden="true"
      >
        <path d="M0 142h420v60H0z" fill="#fffaf0" />
        <ellipse cx="210" cy="164" rx="132" ry="91" fill="#47666c" />
        <ellipse cx="210" cy="155" rx="132" ry="91" fill="#fffaf0" />
        <ellipse cx="210" cy="155" rx="107" ry="68" fill="#47666c" />
        <ellipse cx="210" cy="155" rx="82" ry="45" fill="#a5c957" />
        <ellipse
          cx="210"
          cy="155"
          rx="107"
          ry="68"
          fill="none"
          stroke="#fffaf0"
          strokeWidth="3"
          strokeDasharray="15 13"
        />
        <path
          d="M205 141v-40h42l-12 12 12 12h-42"
          fill="#ffcb55"
          stroke="#173b45"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path
          d="M176 162v-22m-11 0 11-16 11 16zM250 174v-17m-10 0 10-14 10 14z"
          fill="#26764c"
          stroke="#26764c"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <g className="not-found-car">
          <ellipse
            cx="316"
            cy="159"
            rx="24"
            ry="9"
            fill="#173b45"
            opacity="0.2"
          />
          <rect x="292" y="139" width="47" height="20" rx="7" fill="#c74024" />
          <path d="m301 140 6-13h17l8 13z" fill="#c74024" />
          <path d="m310 131-4 9h19l-5-9z" fill="#b7edfa" />
          <circle cx="302" cy="158" r="6" fill="#173b45" />
          <circle cx="330" cy="158" r="6" fill="#173b45" />
          <path d="M295 145h5m33 0h5" stroke="#ffcb55" strokeWidth="3" />
        </g>
      </svg>
      <p className="not-found-code">404</p>
      <h1>{heading}</h1>
      <p>
        {t(
          "Cette page n’existe pas. Le plateau vous attend à l’accueil.",
          "This page doesn't exist. The board is waiting for you at home.",
        )}
      </p>
      <a className="not-found-home" href="/">
        {t("Retour à l’accueil", "Back home")} <span aria-hidden="true">→</span>
      </a>
    </main>
  );
}
