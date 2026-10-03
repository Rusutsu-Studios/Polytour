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
    <div className="graphics-setting">
      {!compact && <span>{t("Graphismes", "Graphics")}</span>}
      <button
        type="button"
        className="graphics-toggle"
        data-graphics-quality={lowGraphics ? "low" : "high"}
        aria-label={label}
        title={label}
        onClick={() => onChange(!lowGraphics)}
      >
        <Icon name="graphics" size={18} />
        {lowGraphics ? t("Faibles", "Low") : t("Élevés", "High")}
      </button>
    </div>
  );
}
