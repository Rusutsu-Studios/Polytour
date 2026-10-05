import { useId } from "react";
import { useLocale } from "../i18n.js";

export default function GraphicsToggle({
  lowGraphics,
  onChange,
}: {
  lowGraphics: boolean;
  onChange: (low: boolean) => void;
}) {
  const { t } = useLocale();
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
              onChange={() => onChange(low)}
            />
            <span>{low ? t("Faible", "Low") : t("Élevé", "High")}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
