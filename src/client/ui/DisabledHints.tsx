import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../i18n.js";
import "./DisabledHints.css";

/** A top-layer popup can sit above a native dialog without being clipped. */
export default function DisabledHints() {
  const popup = useRef<HTMLDivElement>(null);
  const { t, locale } = useLocale();
  useEffect(() => {
    const element = popup.current;
    if (!element) return;
    element.lang = locale;
    let anchor: HTMLElement | null = null;
    let previousDescription: string | null = null;
    const hide = () => {
      element.hidePopover();
      if (anchor) {
        if (previousDescription === null)
          anchor.removeAttribute("aria-describedby");
        else anchor.setAttribute("aria-describedby", previousDescription);
      }
      anchor = null;
    };
    const show = (target: EventTarget | null) => {
      const control =
        target instanceof Element
          ? (target.closest<HTMLElement>("[aria-disabled='true'], :disabled") ??
            target.closest("label")?.querySelector<HTMLElement>(":disabled"))
          : null;
      const reason = control?.closest<HTMLElement>("[data-disabled-reason]")
        ?.dataset.disabledReason;
      if (!control || !reason) {
        hide();
        return;
      }
      if (
        anchor === control &&
        element.querySelector("p")?.textContent === reason
      )
        return;
      hide();
      anchor = control;
      previousDescription = anchor.getAttribute("aria-describedby");
      anchor.setAttribute(
        "aria-describedby",
        `${previousDescription ?? ""} disabled-action-hint`.trim(),
      );
      const copy = element.querySelector("p");
      if (copy) copy.textContent = reason;
      element.showPopover();
      const rect = anchor.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(window.innerWidth - bounds.width - 12, rect.left + (rect.width - bounds.width) / 2))}px`;
      element.style.top = `${Math.max(12, rect.top >= bounds.height + 20 ? rect.top - bounds.height - 10 : Math.min(window.innerHeight - bounds.height - 12, rect.bottom + 10))}px`;
    };
    const pointer = (event: PointerEvent) => show(event.target);
    const focus = (event: FocusEvent) => show(event.target);
    const leave = (event: FocusEvent | PointerEvent) => {
      if (anchor?.contains(event.relatedTarget as Node | null)) return;
      hide();
    };
    const dismissHint = (event: KeyboardEvent) => {
      if (event.key === "Escape" && element.matches(":popover-open")) {
        event.preventDefault();
        event.stopPropagation();
        hide();
      }
    };
    // Close explanations when their action changes, a dialog closes or a snapshot replaces it.
    const observer = new MutationObserver(() => {
      if (
        anchor &&
        (!anchor.isConnected ||
          !anchor.checkVisibility() ||
          !anchor.matches("[aria-disabled='true'], :disabled") ||
          anchor.closest<HTMLElement>("[data-disabled-reason]")?.dataset
            .disabledReason !== element.querySelector("p")?.textContent)
      )
        hide();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "aria-disabled",
        "disabled",
        "open",
        "data-disabled-reason",
      ],
    });
    document.addEventListener("pointerover", pointer);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", leave);
    document.addEventListener("keydown", dismissHint, true);
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      hide();
      observer.disconnect();
      document.removeEventListener("pointerover", pointer);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("keydown", dismissHint, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, [locale]);
  return createPortal(
    <div
      ref={popup}
      popover="manual"
      id="disabled-action-hint"
      role="tooltip"
      className="disabled-action-hint"
    >
      <strong>{t("Indisponible pour le moment", "Unavailable for now")}</strong>
      <p />
    </div>,
    document.body,
  );
}
