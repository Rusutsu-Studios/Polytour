import { useId } from "react";
import { useLocale } from "../i18n.js";
import { updateSettings, useSettings } from "../settings/store.js";

export default function GraphicsToggle() {
  const { t } = useLocale();
  const { graphics, reducedMotion } = useSettings();
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
        {(["potato", "low", "high"] as const).map((quality) => (
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
              onChange={() =>
                updateSettings({
                  graphics: quality,
                  reducedMotion:
                    quality === "potato"
                      ? "on"
                      : quality === "high"
                        ? "off"
                        : reducedMotion,
                })
              }
            />
            <span>{labels[quality]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
