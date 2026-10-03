import { useLocale } from "../i18n.js";
import Icon from "./Icon.js";

export default function LanguagePicker() {
  const { locale, setLocale, t } = useLocale();
  return (
    <button
      type="button"
      className="text-button language-trigger"
      aria-label={t("FR · Passer en anglais", "EN · Switch to French")}
      onClick={() => setLocale(locale === "fr" ? "en" : "fr")}
    >
      <Icon name="globe" size={18} />
      <span>{locale.toUpperCase()}</span>
    </button>
  );
}
