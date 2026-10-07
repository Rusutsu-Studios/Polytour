import { useLocale } from "../i18n.js";
import Icon from "./Icon.js";
import "./SettingHelp.css";

/** The shared top-layer hint explains settings without changing their value. */
export default function SettingHelp({
  label,
  message,
  className,
}: {
  label: string;
  message: string;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className={`setting-help${className ? ` ${className}` : ""}`}
      aria-label={t(`À propos de ${label}`, `About ${label}`)}
      aria-controls="disabled-action-hint"
      aria-expanded="false"
      data-help-title={label}
      data-help-message={message}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Icon name="help" size={17} />
    </button>
  );
}
