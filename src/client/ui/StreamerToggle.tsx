import { useLocale } from "../i18n.js";
import Icon from "./Icon.js";

export default function StreamerToggle({
  enabled,
  onChange,
  compact = false,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const label = t("Mode streamer", "Streamer mode");
  return (
    <button
      type="button"
      className={`streamer-toggle ${compact ? "game-tool-button" : "text-button"}`}
      aria-label={label}
      aria-pressed={enabled}
      data-help-title={label}
      data-help-message={t(
        "Masque le code de salle et de connexion.",
        "Hides the room code and masks it when joining.",
      )}
      data-help-pin="false"
      onClick={() => onChange(!enabled)}
    >
      <Icon name="shield" size={18} />
      {!compact && <span>{label}</span>}
    </button>
  );
}
