import type { ComponentProps } from "react";
import { useLocale } from "../i18n.js";

/** Unavailable actions stay focusable so their explanation works by keyboard. */
export default function ActionButton({
  disabled,
  disabledReason,
  onClick,
  ...props
}: ComponentProps<"button"> & { disabledReason?: string }) {
  const { t } = useLocale();
  return (
    <button
      {...props}
      aria-disabled={disabled || undefined}
      data-disabled-reason={
        disabled
          ? (disabledReason ??
            t("En attente du serveur…", "Waiting for the server…"))
          : undefined
      }
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    />
  );
}
