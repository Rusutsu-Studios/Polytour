import type { ComponentProps } from "react";

/** Unavailable actions stay focusable so their explanation works by keyboard. */
export default function ActionButton({
  disabled,
  disabledReason,
  onClick,
  ...props
}: ComponentProps<"button"> & { disabledReason?: string }) {
  return (
    <button
      {...props}
      aria-disabled={disabled || undefined}
      data-disabled-reason={disabled ? disabledReason : undefined}
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
