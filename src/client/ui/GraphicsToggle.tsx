import { useId } from "react";
import { useLocale } from "../i18n.js";
import { updateSettings, useSettings } from "../settings/store.js";

export default function GraphicsToggle() {
  const { t } = useLocale();
  const { graphics } = useSettings();
  const labels = {
    high: t("Élevé", "High"),
    low: t("Faible", "Low"),
    potato: "Potato PC",
  };
  const name = useId();
  return (
    <fieldset className="graphics-quality">
      <legend>{t("Graphismes", "Graphics")}</legend>
      <div className="graphics-quality-options">
        {(["high", "low", "potato"] as const).map((quality) => (
          <label
            key={quality}
            className="graphics-quality-option"
            data-quality={quality}
            data-selected={graphics === quality}
          >
            <input
              type="radio"
              name={name}
              value={quality}
              checked={graphics === quality}
              onChange={() => updateSettings({ graphics: quality })}
            />
            <span>{labels[quality]}</span>
          </label>
        ))}
      </div>
      <p className="settings-description">
        {t(
          "Potato PC : plateau 3D allégé, sans décor central, pour les ordinateurs peu puissants.",
          "Potato PC: a lighter 3D board without central scenery for slower computers.",
        )}
      </p>
    </fieldset>
  );
}
