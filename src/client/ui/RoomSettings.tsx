import type { CSSProperties } from "react";
import { useEffect, useId, useState } from "react";
import type { RoomConfig } from "../../shared/protocol/index.js";
import { money } from "./board-display.js";
import "./RoomSettings.css";

export type RoomSettingsProps = {
  config: RoomConfig;
  onChange: (config: RoomConfig) => void;
  disabled?: boolean;
  save?: { dirty: boolean; onSave: () => void };
};

const TOGGLES = [
  ["lineMonopoly", "Victoire par ligne complète"],
  ["tripleMonopoly", "Victoire par trois collections"],
  ["hotelsDirectly", "Hôtels directement achetables"],
  ["extraRollOnDouble", "Rejouer après un double"],
  ["botCanBuild", "Les bots peuvent construire"],
  ["giftCanBankrupt", "Les cadeaux peuvent causer une faillite"],
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
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
  monetary?: boolean;
  wide?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing || disabled) setDraft(String(value));
  }, [value, editing, disabled]);
  const commit = () => {
    if (disabled) return;
    const entered = Number(draft);
    const next =
      draft.trim() !== "" && Number.isFinite(entered)
        ? Math.max(0, Math.min(max, Math.round(entered)))
        : value;
    setDraft(String(next));
    setEditing(false);
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
        aria-describedby={`${id}-bounds`}
        aria-valuetext={new Intl.NumberFormat("fr-CH").format(value)}
        style={
          { "--setting-progress": `${(value / max) * 100}%` } as CSSProperties
        }
        onChange={(event) => {
          if (!disabled) onChange(Number(event.currentTarget.value));
        }}
      />
      <div className="room-setting-bounds" id={`${id}-bounds`}>
        <span>0</span>
        <span>{monetary ? money(max) : max}</span>
      </div>
      <label className="room-setting-precise" htmlFor={`${id}-number`}>
        Valeur exacte
        <input
          id={`${id}-number`}
          type="number"
          min={0}
          max={max}
          step={1}
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          aria-label={`${label} : valeur exacte`}
          onFocus={() => setEditing(true)}
          onBlur={commit}
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
  const update = (patch: Partial<RoomConfig>) => {
    if (!disabled) onChange({ ...config, ...patch });
  };
  return (
    <div className="room-settings" data-readonly={disabled}>
      <div className="room-settings-main">
        <NumberSetting
          label="Capital de départ"
          value={config.startingCash}
          max={10_000_000}
          step={10_000}
          disabled={disabled}
          onChange={(startingCash) => update({ startingCash })}
          monetary
        />
        <NumberSetting
          label="Salaire au départ"
          value={config.startSalary}
          max={1_000_000}
          step={10_000}
          disabled={disabled}
          onChange={(startSalary) => update({ startSalary })}
          monetary
        />
        <NumberSetting
          label="Festivals initiaux"
          value={config.festivalCount}
          max={20}
          step={1}
          disabled={disabled}
          onChange={(festivalCount) => update({ festivalCount })}
          wide
        />
        <ChoiceSetting
          label="Durée de partie"
          value={config.timeLimitMinutes}
          choices={[20, 60, 120]}
          suffix="min"
          disabled={disabled}
          onChange={(timeLimitMinutes) =>
            update({ timeLimitMinutes: timeLimitMinutes as 20 | 60 | 120 })
          }
        />
        <ChoiceSetting
          label="Temps de décision"
          value={config.decisionSeconds}
          choices={[15, 30, 45, 60]}
          suffix="s"
          disabled={disabled}
          onChange={(decisionSeconds) => update({ decisionSeconds })}
        />
      </div>
      <fieldset className="room-settings-rules" disabled={disabled}>
        <legend>Règles personnalisées</legend>
        <div className="room-settings-toggles">
          {TOGGLES.map(([key, label]) => (
            <label className="room-setting-toggle" key={key}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={config[key]}
                onChange={(event) =>
                  update({ [key]: event.currentTarget.checked })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <details className="room-settings-fairness">
        <summary>Des règles identiques pour tous</summary>
        <p>
          {config.randomnessMode === "drand"
            ? "Cette ancienne salle conserve ses dés drand : chaque lancer attend un signal public et sa signature vérifiée."
            : "Les dés utilisent un aléa cryptographique généré directement sur Cloudflare, sans attendre de signal externe. Les mêmes chances pour tous, sans avantage payant."}{" "}
          Les loyers et effets restent une première économie à ajuster.
        </p>
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
          {save.dirty ? "Enregistrer les réglages" : "Réglages enregistrés"}
        </button>
      )}
    </div>
  );
}

export default RoomSettings;
