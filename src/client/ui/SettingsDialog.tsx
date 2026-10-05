import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDirector } from "../director/director.js";
import { useLocale } from "../i18n.js";
import Icon from "./Icon.js";
import RoomSettingsFields, { type RoomSettingsProps } from "./RoomSettings.js";
import "./SettingsDialog.css";

// THESIS: Tune a game on one protected sheet, then return to the board.
// OWN-WORLD: Ivory paper, a blue game ribbon and a gold lower edge.
// STORY: Read the values, move the sliders, save the host's draft when required.
// FIRST VIEWPORT: Two clear columns of controls with a persistent close action.
// FORM: The requested central game popup extends the existing toy-board world.
export default function SettingsDialog(props: RoomSettingsProps) {
  const { t } = useLocale();
  const { disabled = false, save } = props;
  const [open, setOpen] = useState(false);
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { reducedMotion } = useDirector();
  const saved = useRef(false);
  // Leaders' changes are sent once, whichever way the dialog closes.
  const dismiss = () => {
    if (!saved.current && !disabled && save?.dirty) save.onSave();
    saved.current = true;
    setOpen(false);
  };

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    dialog.showModal();
    headingRef.current?.focus();
    return () => {
      dialog.close();
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="settings-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-dialog`}
        onClick={() => {
          saved.current = false;
          setOpen(true);
        }}
      >
        <Icon name="settings" size={21} />
        <span className="settings-trigger-title">
          {t("Réglages de la partie", "Game settings")}
        </span>
        <span className="settings-trigger-hint">
          {t("Personnaliser", "Customize")}
        </span>
        <Icon name="arrow" size={17} />
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialogRef}
            id={`${id}-dialog`}
            className="settings-dialog"
            aria-labelledby={`${id}-heading`}
            aria-describedby={
              disabled || !save ? `${id}-description` : undefined
            }
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dismiss();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              dismiss();
            }}
            onClose={dismiss}
          >
            <motion.div
              className="settings-dialog-frame"
              initial={reducedMotion ? false : { opacity: 0.8, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reducedMotion ? 0 : 0.24,
                ease: "easeOut",
              }}
            >
              <header className="settings-dialog-ribbon">
                <Icon name="settings" size={28} />
                <h2 ref={headingRef} id={`${id}-heading`} tabIndex={-1}>
                  {t("Réglages de la partie", "Game settings")}
                </h2>
                <button
                  type="button"
                  className="settings-dialog-close"
                  aria-label={t("Fermer les réglages", "Close settings")}
                  onClick={dismiss}
                >
                  <Icon name="close" size={25} />
                </button>
              </header>
              <div className="settings-dialog-body">
                {(disabled || !save) && (
                  <p id={`${id}-description`} className="settings-dialog-note">
                    {disabled
                      ? t(
                          "Consultez les règles de cette salle.",
                          "View this room’s rules.",
                        )
                      : t(
                          "Choisissez les règles de votre prochaine partie.",
                          "Choose the rules for your next game.",
                        )}
                  </p>
                )}
                <RoomSettingsFields {...props} />
              </div>
              <footer className="settings-dialog-footer">
                <button
                  type="button"
                  className="settings-dialog-done"
                  onClick={dismiss}
                >
                  {!save && !disabled && <Icon name="check" size={19} />}
                  {disabled
                    ? t("Revenir au plateau", "Back to the board")
                    : save
                      ? t("Fermer les réglages", "Close settings")
                      : t("Appliquer les réglages", "Apply settings")}
                </button>
              </footer>
            </motion.div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
