import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "../i18n.js";
import Icon from "./Icon.js";
import "./LanguagePicker.css";

export default function LanguagePicker() {
  const { locale, setLocale } = useLocale();
  const id = useId();
  const menu = useRef<HTMLFieldSetElement>(null);
  const [expanded, setExpanded] = useState(false);
  const hoverClose = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(hoverClose.current), []);
  const trigger = useRef<HTMLButtonElement>(null);
  const show = () => {
    const popup = menu.current;
    const button = trigger.current;
    if (!popup || !button) return;
    popup.showPopover();
    const rect = button.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const zoom = bounds.width / popup.offsetWidth;
    popup.style.left = `${Math.max(12, Math.min(window.innerWidth - bounds.width - 12, rect.right - bounds.width)) / zoom}px`;
    popup.style.top = `${(rect.bottom + 8) / zoom}px`;
  };
  return (
    <div
      className="language-picker"
      onPointerEnter={(event) => {
        clearTimeout(hoverClose.current);
        if (event.pointerType === "mouse") show();
      }}
      onPointerLeave={(event) => {
        const picker = event.currentTarget;
        // Bridge the small gap between the label and the menu on hover.
        hoverClose.current = setTimeout(() => {
          if (!picker.contains(document.activeElement))
            menu.current?.hidePopover();
        }, 150);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="language-trigger"
        aria-label="Langue / Language"
        aria-haspopup="true"
        aria-controls={id}
        aria-expanded={expanded}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            show();
            menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
          }
        }}
      >
        {locale.toUpperCase()} <span aria-hidden="true">⌄</span>
      </button>
      <fieldset
        ref={menu}
        id={id}
        popover="auto"
        className="language-menu"
        onToggle={(event) => setExpanded(event.newState === "open")}
        aria-label="Langues / Languages"
      >
        {(["fr", "en"] as const).map((language) => (
          <button
            key={language}
            type="button"
            aria-pressed={locale === language}
            onClick={() => {
              setLocale(language);
              menu.current?.hidePopover();
              trigger.current?.focus();
            }}
          >
            <span>{language === "fr" ? "Français" : "English"}</span>
            {locale === language && <Icon name="check" size={16} />}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
