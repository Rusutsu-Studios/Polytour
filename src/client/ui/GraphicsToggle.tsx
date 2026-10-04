import { useId } from "react";
import { useLocale } from "../i18n.js";
import Icon from "./Icon.js";

export default function GraphicsToggle({
  lowGraphics,
  onChange,
  compact = false,
}: {
  lowGraphics: boolean;
  onChange: (low: boolean) => void;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const name = useId();
  if (!compact) {
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
  const label = lowGraphics
    ? t(
        "Graphismes : Faibles. Passer aux graphismes élevés.",
        "Graphics: Low. Switch to High.",
      )
    : t(
        "Graphismes : Élevés. Passer aux graphismes faibles.",
        "Graphics: High. Switch to Low.",
      );
  return (
    <button
      type="button"
      className="graphics-toggle text-button"
      data-graphics-quality={lowGraphics ? "low" : "high"}
      aria-label={label}
      title={label}
      onClick={() => onChange(!lowGraphics)}
    >
      <Icon name="graphics" size={18} />
      <span>{lowGraphics ? t("Faibles", "Low") : t("Élevés", "High")}</span>
    </button>
  );
}
