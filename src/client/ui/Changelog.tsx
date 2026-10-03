import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { APP_VERSION } from "../../shared/version.js";
import { useLocale } from "../i18n.js";
import Icon from "./Icon.js";
import "./Changelog.css";

// The release notebook extends the game's ivory sheets and coral controls.
// Read: newest release first, generous text measure, one protected scroll area.
function releases(source: string) {
  return [
    ...source.matchAll(
      /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\r?\n([\s\S]*?)(?=^## \[|$(?![\s\S]))/gm,
    ),
  ]
    .filter((match) => match[3].trim())
    .map((match) => ({ version: match[1], date: match[2], body: match[3] }));
}

function inlineNote(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: Static source tokens never reorder independently.
      <code key={index}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

export default function Changelog() {
  const { t, locale } = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus();
    let cancelled = false;
    setFailed(false);
    import("../../../CHANGELOG.md?raw").then(
      (module) => {
        if (!cancelled) setSource(module.default);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      element?.close();
      trigger.current?.focus();
    };
  }, [open]);

  const category = (label: string) => {
    if (label === "Added") return t("Ajouts", "Added");
    if (label === "Changed") return t("Modifications", "Changed");
    if (label === "Fixed") return t("Corrections", "Fixed");
    return label;
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="version-trigger"
        aria-label={t(
          `Version ${APP_VERSION} : voir les nouveautés`,
          `Version ${APP_VERSION}: view changelog`,
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
      >
        v{APP_VERSION}
        <Icon name="journal" size={13} />
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            id={id}
            className="changelog-dialog"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-note`}
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
            }}
            onClose={() => setOpen(false)}
          >
            <header className="changelog-header">
              <div>
                <h2 ref={heading} tabIndex={-1} id={`${id}-title`}>
                  {t("Nouveautés", "What's new")}
                </h2>
                <p id={`${id}-note`}>
                  {t(
                    "Le journal des versions de Polytour",
                    "Polytour release history",
                  )}
                </p>
              </div>
              <button
                type="button"
                className="changelog-close"
                aria-label={t("Fermer les nouveautés", "Close changelog")}
                onClick={() => setOpen(false)}
              >
                <Icon name="close" size={22} />
              </button>
            </header>
            <section
              className="changelog-scroll"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the release history independently of the fixed header.
              tabIndex={0}
              aria-label={t("Historique des versions", "Release history")}
            >
              <p className="changelog-language">
                {t(
                  "Les notes de version sont conservées en anglais, dans leur texte original.",
                  "Release notes are shown in their original English.",
                )}
              </p>
              {failed ? (
                <p role="alert">
                  {t(
                    "Impossible de charger les notes. Fermez puis rouvrez cette fenêtre pour réessayer.",
                    "Could not load release notes. Close and reopen this window to try again.",
                  )}
                </p>
              ) : source === null ? (
                <p role="status">
                  {t("Chargement des notes…", "Loading release notes…")}
                </p>
              ) : (
                releases(source).map((release) => (
                  <section key={release.version} className="changelog-release">
                    <div className="changelog-release-heading">
                      <h3>
                        {release.date
                          ? `v${release.version}`
                          : t("À venir", "Upcoming")}
                      </h3>
                      {release.version === APP_VERSION && (
                        <span className="changelog-current">
                          {t("Version actuelle", "Current version")}
                        </span>
                      )}
                      {release.date && (
                        <time dateTime={release.date}>
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "long",
                            timeZone: "UTC",
                          }).format(new Date(`${release.date}T00:00:00Z`))}
                        </time>
                      )}
                    </div>
                    <div lang="en">
                      {release.body
                        .trim()
                        .split(/\r?\n\s*\r?\n/)
                        .map((block) => {
                          if (block.startsWith("### "))
                            return (
                              <h4 key={block} lang={locale}>
                                {category(block.slice(4).trim())}
                              </h4>
                            );
                          if (block.startsWith("- "))
                            return (
                              <ul key={block}>
                                {block.split(/\r?\n(?=- )/).map((item) => (
                                  <li key={item}>
                                    {inlineNote(
                                      item.slice(2).replace(/\r?\n\s*/g, " "),
                                    )}
                                  </li>
                                ))}
                              </ul>
                            );
                          return (
                            <p key={block}>
                              {inlineNote(block.replace(/\r?\n/g, " "))}
                            </p>
                          );
                        })}
                    </div>
                  </section>
                ))
              )}
            </section>
            <footer className="changelog-footer">
              <span>
                {t("Notes issues de CHANGELOG.md", "Notes from CHANGELOG.md")}
              </span>
              <a
                href="https://github.com/Rusutsu-Studios/Polytour/blob/main/CHANGELOG.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Voir sur GitHub ↗", "View on GitHub ↗")}
              </a>
            </footer>
          </dialog>,
          document.body,
        )}
    </>
  );
}
