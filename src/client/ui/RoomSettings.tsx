import type { CSSProperties } from "react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { RoomConfig } from "../../shared/protocol/index.js";
import { useLocale } from "../i18n.js";
import { money } from "./board-display.js";
import DiceExplanation from "./DiceExplanation.js";
import "./RoomSettings.css";

export type RoomSettingsProps = {
  config: RoomConfig;
  onChange: (config: RoomConfig) => void;
  disabled?: boolean;
  save?: { dirty: boolean; onSave: () => void };
};

const TOGGLES = [
  ["lineMonopoly", "Victoire par ligne complète", "Win with a full side"],
  [
    "tripleMonopoly",
    "Victoire par trois collections",
    "Win with three complete sets",
  ],
  ["hotelsDirectly", "Hôtels directement achetables", "Buy hotels directly"],
  ["extraRollOnDouble", "Rejouer après un double", "Roll again on doubles"],
  ["botCanBuild", "Les bots peuvent construire", "Bots can build"],
  [
    "giftCanBankrupt",
    "Les cadeaux peuvent causer une faillite",
    "Gifts can cause bankruptcy",
  ],
] as const;

function NumberSetting({
  label,
  value,
  max,
  step,
  disabled,
  onChange,
  monetary = false,
  wide = false,
  compact = false,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
  monetary?: boolean;
  wide?: boolean;
  compact?: boolean;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  useLayoutEffect(() => {
    if (disabled) editing.current = false;
    // Sync before the next input event; focused text belongs to the player.
    if (!editing.current) setDraft(String(value));
  }, [value, disabled]);
  const commit = (text: string) => {
    editing.current = false;
    if (disabled) return;
    const entered = Number(text);
    const next =
      text.trim() !== "" && Number.isFinite(entered)
        ? Math.max(0, Math.min(max, Math.round(entered)))
        : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <div className={`room-setting${wide ? " room-setting--wide" : ""}`}>
      <div className="room-setting-heading">
        <label htmlFor={`${id}-range`}>{label}</label>
        <output htmlFor={`${id}-range`}>
          {monetary ? money(value) : value}
        </output>
      </div>
      <input
        className="room-setting-range"
        id={`${id}-range`}
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={compact ? undefined : `${id}-bounds`}
        aria-valuetext={new Intl.NumberFormat(
          locale === "fr" ? "fr-CH" : "en-GB",
        ).format(value)}
        style={
          { "--setting-progress": `${(value / max) * 100}%` } as CSSProperties
        }
        onChange={(event) => {
          if (!disabled) onChange(Number(event.currentTarget.value));
        }}
      />
      {!compact && (
        <div className="room-setting-bounds" id={`${id}-bounds`}>
          <span>0</span>
          <span>{monetary ? money(max) : max}</span>
        </div>
      )}
      {!compact && (
        <label className="room-setting-precise" htmlFor={`${id}-number`}>
          {t("Valeur exacte", "Exact value")}
          <input
            id={`${id}-number`}
            type="number"
            min={0}
            max={max}
            step={1}
            inputMode="numeric"
            value={draft}
            disabled={disabled}
            aria-label={t(`${label} : valeur exacte`, `${label}: exact value`)}
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            onChange={(event) => {
              if (disabled) return;
              const nextDraft = event.currentTarget.value;
              setDraft(nextDraft);
              const next = Number(nextDraft);
              if (
                nextDraft !== "" &&
                Number.isInteger(next) &&
                next >= 0 &&
                next <= max
              )
                onChange(next);
            }}
          />
        </label>
      )}
    </div>
  );
}

/** The welcome screen exposes the three values most often adjusted before play. */
export function QuickSettings({
  config,
  onChange,
  disabled = false,
}: RoomSettingsProps) {
  const { t } = useLocale();
  const update = (patch: Partial<RoomConfig>) => {
    if (!disabled) onChange({ ...config, ...patch });
  };
  return (
    <div className="room-settings room-settings-main">
      <NumberSetting
        label={t("Capital de départ", "Starting cash")}
        value={config.startingCash}
        max={10_000_000}
        step={10_000}
        disabled={disabled}
        onChange={(startingCash) => update({ startingCash })}
        monetary
        compact
      />
      <NumberSetting
        label={t("Salaire au départ", "Salary per lap")}
        value={config.startSalary}
        max={1_000_000}
        step={10_000}
        disabled={disabled}
        onChange={(startSalary) => update({ startSalary })}
        monetary
        compact
      />
      <NumberSetting
        label={t("Festivals initiaux", "Starting festivals")}
        value={config.festivalCount}
        max={20}
        step={1}
        disabled={disabled}
        onChange={(festivalCount) => update({ festivalCount })}
        compact
      />
    </div>
  );
}

function ChoiceSetting({
  label,
  value,
  choices,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  choices: readonly number[];
  suffix: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  // Keep valid settings from existing saved rooms visible, even outside the presets.
  const options = choices.includes(value)
    ? choices
    : [...choices, value].sort((a, b) => a - b);
  return (
    <fieldset className="room-setting-choice" disabled={disabled}>
      <legend>{label}</legend>
      <input
        className="room-setting-range"
        type="range"
        min={0}
        max={options.length - 1}
        step={1}
        value={options.indexOf(value)}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={`${value} ${suffix}`}
        style={
          {
            "--setting-progress": `${(options.indexOf(value) / (options.length - 1)) * 100}%`,
          } as CSSProperties
        }
        onChange={(event) => {
          const choice = options[Number(event.currentTarget.value)];
          if (!disabled && choice !== undefined) onChange(choice);
        }}
      />
      <div className="room-setting-pills">
        {options.map((option) => (
          <label className="room-setting-pill" key={option}>
            <input
              type="radio"
              name={id}
              value={option}
              checked={option === value}
              disabled={disabled}
              onChange={() => {
                if (!disabled) onChange(option);
              }}
            />
            <span>
              {option} <span>{suffix}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The caller owns the settings popup and the host's draft/save lifecycle. */
export function RoomSettings({
  config,
  onChange,
  disabled = false,
  save,
}: RoomSettingsProps) {
  const { t } = useLocale();
  const update = (patch: Partial<RoomConfig>) => {
    if (!disabled) onChange({ ...config, ...patch });
  };
  return (
    <div className="room-settings" data-readonly={disabled}>
      <div className="room-settings-main">
        <NumberSetting
          label={t("Capital de départ", "Starting cash")}
          value={config.startingCash}
          max={10_000_000}
          step={10_000}
          disabled={disabled}
          onChange={(startingCash) => update({ startingCash })}
          monetary
        />
        <NumberSetting
          label={t("Salaire au départ", "Salary per lap")}
          value={config.startSalary}
          max={1_000_000}
          step={10_000}
          disabled={disabled}
          onChange={(startSalary) => update({ startSalary })}
          monetary
        />
        <NumberSetting
          label={t("Festivals initiaux", "Starting festivals")}
          value={config.festivalCount}
          max={20}
          step={1}
          disabled={disabled}
          onChange={(festivalCount) => update({ festivalCount })}
          wide
        />
        <ChoiceSetting
          label={t("Durée de partie", "Game duration")}
          value={config.timeLimitMinutes}
          choices={[20, 60, 120]}
          suffix="min"
          disabled={disabled}
          onChange={(timeLimitMinutes) =>
            update({ timeLimitMinutes: timeLimitMinutes as 20 | 60 | 120 })
          }
        />
        <ChoiceSetting
          label={t("Temps de décision", "Decision timer")}
          value={config.decisionSeconds}
          choices={[15, 30, 45, 60]}
          suffix="s"
          disabled={disabled}
          onChange={(decisionSeconds) => update({ decisionSeconds })}
        />
      </div>
      <fieldset className="room-settings-rules" disabled={disabled}>
        <legend>{t("Règles personnalisées", "Custom rules")}</legend>
        <div className="room-settings-toggles">
          {TOGGLES.map(([key, fr, en]) => (
            <label className="room-setting-toggle" key={key}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={config[key]}
                onChange={(event) =>
                  update({ [key]: event.currentTarget.checked })
                }
              />
              <span>{t(fr, en)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <details className="room-settings-fairness">
        <summary>{t("Dés et économie", "Dice and economy")}</summary>
        {config.randomnessMode === "drand" ? (
          <p>
            {t(
              "Cette ancienne salle conserve ses dés drand : chaque lancer attend un signal public et sa signature vérifiée.",
              "This older room keeps its drand dice: each roll waits for a public beacon and a verified signature.",
            )}{" "}
            {t(
              "Les loyers et effets sont encore en cours d’équilibrage.",
              "Rents and card effects are still being balanced.",
            )}
          </p>
        ) : (
          <DiceExplanation />
        )}
      </details>
      {save && (
        <button
          type="button"
          className="room-settings-save"
          disabled={disabled || !save.dirty}
          onClick={() => {
            if (!disabled && save.dirty) save.onSave();
          }}
        >
          {save.dirty
            ? t("Enregistrer les réglages", "Save settings")
            : t("Réglages enregistrés", "Settings saved")}
        </button>
      )}
    </div>
  );
}

export default RoomSettings;
