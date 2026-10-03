import { useLocale } from "../i18n.js";
import "./DiceExplanation.css";

/** One dice explanation in the help shared by the welcome screen and matches. */
export default function DiceExplanation() {
  const { t } = useLocale();
  return (
    <>
      <p>
        {t(
          "À chaque lancer, le serveur tire de nouveaux octets aléatoires avec l’API Web Crypto de Cloudflare. Les valeurs qui favoriseraient certaines faces sont écartées : chaque face a une chance sur six.",
          "On every roll, the server draws fresh random bytes with Cloudflare’s Web Crypto API. Values that would favor some faces are discarded, giving each face a 1 in 6 chance.",
        )}
      </p>
      <p>
        <a
          className="dice-explanation-link"
          href="https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#methods"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t(
            "Documentation Web Crypto de Cloudflare (nouvel onglet)",
            "Cloudflare Web Crypto documentation (opens in a new tab)",
          )}
        >
          {t(
            "Documentation Web Crypto de Cloudflare",
            "Cloudflare Web Crypto documentation",
          )}
          <span aria-hidden="true"> ↗</span>
        </a>
      </p>
    </>
  );
}
