import { useId } from "react";
import { useLocale } from "../i18n.js";
import { updateSettings, useSettings } from "../settings/store.js";

export default function GraphicsToggle() {
  const { t } = useLocale();
  const { graphics } = useSettings();
  const lowGraphics = graphics === "low";
  const name = useId();
  return (
    <fieldset className="graphics-quality">
      <legend>{t("Graphismes", "Graphics")}</legend>
      <div className="graphics-quality-options">
        {([false, true] as const).map((low) => (
          <label
            key={low ? "low" : "high"}
            className="graphics-quality-option"
            data-selected={lowGraphics === low}
          >
            <input
              type="radio"
              name={name}
              value={low ? "low" : "high"}
              checked={lowGraphics === low}
              onChange={() =>
                updateSettings({ graphics: low ? "low" : "high" })
              }
            />
            <span>{low ? t("Faible", "Low") : t("Élevé", "High")}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
