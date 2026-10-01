import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDirector } from "../director/director.js";
import Icon from "./Icon.js";
import RoomSettingsFields, { type RoomSettingsProps } from "./RoomSettings.js";
import "./SettingsDialog.css";

// THESIS: Tune a game on one protected sheet, then return to the board.
// OWN-WORLD: Ivory paper, a blue game ribbon and a gold lower edge.
// STORY: Read the values, move the sliders, save the host's draft when required.
// FIRST VIEWPORT: Two clear columns of controls with a persistent close action.
// FORM: The requested central game popup extends the existing toy-board world.
export default function SettingsDialog(props: RoomSettingsProps) {
  const { disabled = false, save } = props;
  const [open, setOpen] = useState(false);
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { reducedMotion, speed } = useDirector();
  const dismiss = () => setOpen(false);

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
        onClick={() => setOpen(true)}
      >
        <Icon name="settings" size={21} />
        <span className="settings-trigger-title">Réglages de la partie</span>
        <span className="settings-trigger-hint">Personnaliser</span>
        <Icon name="arrow" size={17} />
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialogRef}
            id={`${id}-dialog`}
            className="settings-dialog"
            aria-labelledby={`${id}-heading`}
            aria-describedby={`${id}-description`}
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
                duration: reducedMotion ? 0 : 0.24 / speed,
                ease: "easeOut",
              }}
            >
              <header className="settings-dialog-ribbon">
                <Icon name="settings" size={28} />
                <h2 ref={headingRef} id={`${id}-heading`} tabIndex={-1}>
                  Réglages de la partie
                </h2>
                <button
                  type="button"
                  className="settings-dialog-close"
                  aria-label="Fermer les réglages"
                  onClick={dismiss}
                >
                  <Icon name="close" size={25} />
                </button>
              </header>
              <div className="settings-dialog-body">
                <p id={`${id}-description`} className="settings-dialog-note">
                  {disabled
                    ? "Consultez les règles de cette salle."
                    : save
                      ? "Enregistrez vos changements pour la salle."
                      : "Choisissez les règles de votre prochain voyage."}
                </p>
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
                    ? "Revenir au plateau"
                    : save
                      ? "Fermer les réglages"
                      : "Appliquer les réglages"}
                </button>
              </footer>
            </motion.div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
