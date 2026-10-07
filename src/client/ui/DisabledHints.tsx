import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getLocale, translate, useLocale } from "../i18n.js";
import "./DisabledHints.css";

/** A top-layer popup can sit above a native dialog without being clipped. */
export default function DisabledHints() {
  const popup = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const container = document.createElement("div");
    container.style.display = "contents";
    return container;
  });
  const { locale } = useLocale();
  useEffect(() => {
    const element = popup.current;
    if (!element) return;
    element.lang = locale;
    if (element.dataset.hintKind === "disabled") {
      const title = element.querySelector("strong");
      if (title)
        title.textContent = translate(
          "Indisponible pour le moment",
          "Unavailable for now",
        );
    }
  }, [locale]);
  useEffect(() => {
    const element = popup.current;
    if (!element) return;
    document.body.appendChild(host);
    element.lang = getLocale();
    let anchor: HTMLElement | null = null;
    let previousDescription: string | null = null;
    let pinned = false;
    let dismissedHelp: HTMLElement | null = null;
    let leaveTimer: number | undefined;
    const cancelLeave = () => {
      window.clearTimeout(leaveTimer);
      leaveTimer = undefined;
    };
    // A control that acts on click explains itself on hover and focus only:
    // clicking it runs the action instead of pinning the hint open.
    const pinnable = (control: HTMLElement) =>
      control.closest<HTMLElement>("[data-help-pin]")?.dataset.helpPin !==
      "false";
    const hide = () => {
      cancelLeave();
      if (element.matches(":popover-open")) element.hidePopover();
      if (anchor) {
        if (element.dataset.hintKind === "help" && pinnable(anchor))
          anchor.setAttribute("aria-expanded", "false");
        if (previousDescription === null)
          anchor.removeAttribute("aria-describedby");
        else anchor.setAttribute("aria-describedby", previousDescription);
      }
      anchor = null;
      pinned = false;
      if (host.parentElement !== document.body) document.body.appendChild(host);
    };
    const hintFor = (target: EventTarget | null) => {
      const help =
        target instanceof Element
          ? target.closest<HTMLElement>("[data-help-title][data-help-message]")
          : null;
      if (
        help &&
        !help.matches("[aria-disabled='true'], :disabled") &&
        help.dataset.helpMessage
      ) {
        // Wrapper hints describe the actual input when it is hovered or focused.
        const input =
          target instanceof Element
            ? target.closest<HTMLElement>("input, select, textarea")
            : null;
        return {
          control: input && help.contains(input) ? input : help,
          kind: "help",
          title: help.dataset.helpTitle ?? "",
          message: help.dataset.helpMessage,
        };
      }
      const control =
        target instanceof Element
          ? (target.closest<HTMLElement>("[aria-disabled='true'], :disabled") ??
            target.closest("label")?.querySelector<HTMLElement>(":disabled"))
          : null;
      const reason = control?.closest<HTMLElement>("[data-disabled-reason]")
        ?.dataset.disabledReason;
      return control && reason
        ? {
            control,
            kind: "disabled",
            title: translate(
              "Indisponible pour le moment",
              "Unavailable for now",
            ),
            message: reason,
          }
        : null;
    };
    const show = (
      hint: NonNullable<ReturnType<typeof hintFor>>,
      keepLeaveTimer = false,
    ) => {
      if (!keepLeaveTimer) cancelLeave();
      if (anchor !== hint.control) {
        hide();
        anchor = hint.control;
        previousDescription = anchor.getAttribute("aria-describedby");
        anchor.setAttribute(
          "aria-describedby",
          `${previousDescription ?? ""} disabled-action-hint`.trim(),
        );
      }
      element.dataset.hintKind = hint.kind;
      if (hint.kind === "help" && pinnable(anchor))
        anchor.setAttribute("aria-expanded", "true");
      const title = element.querySelector("strong");
      if (title && title.textContent !== hint.title)
        title.textContent = hint.title;
      const copy = element.querySelector("p");
      if (copy && copy.textContent !== hint.message)
        copy.textContent = hint.message;
      // A popover outside a modal's DOM remains inert even when it is in the top layer.
      const container =
        hint.kind === "help"
          ? (anchor.closest("dialog[open]") ?? document.body)
          : document.body;
      if (host.parentElement !== container) container.appendChild(host);
      if (!element.matches(":popover-open")) element.showPopover();
      const rect = (anchor.closest("label") ?? anchor).getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(window.innerWidth - bounds.width - 12, rect.left + (rect.width - bounds.width) / 2))}px`;
      element.style.top = `${Math.max(12, rect.top >= bounds.height + 20 ? rect.top - bounds.height - 10 : Math.min(window.innerHeight - bounds.height - 12, rect.bottom + 10))}px`;
    };
    const pointer = (event: PointerEvent) => {
      // Closing a popup can reveal another setting without pointer movement.
      // Escape stays dismissed until the user moves away or changes focus.
      if (dismissedHelp) return;
      if (
        element.dataset.hintKind === "help" &&
        element.contains(event.target as Node)
      ) {
        cancelLeave();
        return;
      }
      if (pinned) return;
      const hint = hintFor(event.target);
      if (hint) show(hint);
      else if (element.dataset.hintKind === "help") {
        if (!anchor?.contains(document.activeElement)) {
          cancelLeave();
          leaveTimer = window.setTimeout(hide, 160);
        }
      } else hide();
    };
    const move = (event: PointerEvent) => {
      if (
        dismissedHelp &&
        event.target instanceof Node &&
        !dismissedHelp.contains(event.target)
      ) {
        dismissedHelp = null;
        pointer(event);
      }
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && dismissedHelp?.contains(event.target))
        return;
      dismissedHelp = null;
      const hint = hintFor(event.target);
      if (hint) show(hint);
      else hide();
    };
    const leave = (event: FocusEvent | PointerEvent) => {
      if (anchor?.contains(event.relatedTarget as Node | null)) return;
      if (element.dataset.hintKind === "help") {
        if (
          pinned ||
          element.contains(event.relatedTarget as Node | null) ||
          (event.type === "pointerout" &&
            anchor?.contains(document.activeElement))
        )
          return;
        if (event.type === "pointerout") {
          cancelLeave();
          leaveTimer = window.setTimeout(hide, 160);
          return;
        }
      }
      hide();
    };
    const outside = (event: PointerEvent) => {
      if (
        hintFor(event.target)?.kind === "help" ||
        (element.dataset.hintKind === "help" &&
          element.contains(event.target as Node))
      )
        return;
      hide();
    };
    const toggleHelp = (event: MouseEvent) => {
      const hint = hintFor(event.target);
      if (hint?.kind !== "help") return;
      dismissedHelp = null;
      if (!pinnable(hint.control)) hide();
      else if (anchor === hint.control && pinned) hide();
      else {
        show(hint);
        pinned = true;
      }
    };
    const scroll = () => {
      if (
        anchor &&
        element.dataset.hintKind === "help" &&
        (pinned || anchor.contains(document.activeElement))
      ) {
        const positionAnchor = anchor.closest("label") ?? anchor;
        const rect = positionAnchor.getBoundingClientRect();
        const visible = positionAnchor.contains(
          document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          ),
        );
        const hint = hintFor(anchor);
        // Focusing an off-screen setting scrolls it into view before its scroll event arrives.
        if (visible && hint?.kind === "help") {
          show(hint, true);
          return;
        }
      }
      hide();
    };
    const dismissHint = (event: KeyboardEvent) => {
      if (event.key === "Escape" && element.matches(":popover-open")) {
        event.preventDefault();
        event.stopPropagation();
        dismissedHelp =
          anchor?.closest<HTMLElement>(
            "[data-help-title][data-help-message]",
          ) ?? null;
        hide();
      }
    };
    // Help follows configuration and language changes; unavailable actions keep their existing dismissal.
    const observer = new MutationObserver(() => {
      if (!anchor) return;
      const hint = hintFor(anchor);
      if (!anchor.isConnected || !anchor.checkVisibility() || !hint) hide();
      else if (element.dataset.hintKind === "help") show(hint, true);
      else if (
        hint.kind !== "disabled" ||
        hint.message !== element.querySelector("p")?.textContent
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
        "data-help-title",
        "data-help-message",
      ],
    });
    document.addEventListener("pointerover", pointer);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", leave);
    document.addEventListener("keydown", dismissHint, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("click", toggleHelp, true);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", scroll, true);
    return () => {
      hide();
      observer.disconnect();
      document.removeEventListener("pointerover", pointer);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("keydown", dismissHint, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("click", toggleHelp, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", scroll, true);
      host.remove();
    };
  }, [host]);
  return createPortal(
    <div
      ref={popup}
      popover="manual"
      id="disabled-action-hint"
      role="tooltip"
      className="disabled-action-hint"
    >
      <strong />
      <p />
    </div>,
    host,
  );
}
