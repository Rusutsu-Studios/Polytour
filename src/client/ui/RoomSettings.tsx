import type { CSSProperties } from "react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { BotDifficulty } from "../../shared/engine/index.js";
import type { RoomConfig } from "../../shared/protocol/index.js";
import { useLocale } from "../i18n.js";
import { money } from "./board-display.js";
import { botDifficultyName } from "./bot-display.js";
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
  [
    "resortMonopoly",
    "Victoire par les quatre plages",
    "Win with all four beaches",
  ],
  ["hotelsDirectly", "Hôtels directement achetables", "Buy hotels directly"],
  ["extraRollOnDouble", "Rejouer après un double", "Roll again on doubles"],
  [
    "tripleDoubleToIsland",
    "Troisième double : direction l'île",
    "Third double goes to the island",
  ],
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

function BotDifficultyDescription({
  config,
  id,
}: {
  config: RoomConfig;
  id: string;
}) {
  const { t } = useLocale();
  const difficulty = config.botDifficulty ?? "medium";
  const description =
    difficulty === "easy"
      ? t(
          "Achète des terrains nus, sans construire ni racheter vos villes.",
          "Buys bare land, without building or buying out your cities.",
        )
      : difficulty === "hard"
        ? t(
            "Vise les collections, bloque vos victoires et garde une réserve pour les loyers.",
            "Targets collections, blocks your wins and keeps cash for rent.",
          )
        : t(
            config.botCanBuild
              ? "Construit et rachète en gardant une petite réserve d’argent."
              : "Achète des terrains nus et rachète les villes abordables.",
            config.botCanBuild
              ? "Builds and buys out while keeping a small cash reserve."
              : "Buys bare land and affordable cities.",
          );
  return (
    <>
      <p id={`${id}-description`} className="room-setting-bot-description">
        {description}
      </p>
      <p id={`${id}-rules`} className="room-setting-bot-rules">
        {t(
          "Même niveau pour tous les bots. Mêmes dés et règles que vous.",
          "One level for all bots. The same dice and rules as you.",
        )}
        {!config.botCanBuild && (
          <>
            {" "}
            {t(
              "Construction désactivée pour tous les niveaux.",
              "Building is disabled at every level.",
            )}
          </>
        )}
      </p>
    </>
  );
}

function BotDifficultySetting({
  config,
  onChange,
  disabled = false,
  compact = false,
  descriptionId,
}: RoomSettingsProps & { compact?: boolean; descriptionId?: string }) {
  const { t } = useLocale();
  const id = useId();
  const copyId = descriptionId ?? id;
  const difficulty = config.botDifficulty ?? "medium";
  return (
    <fieldset
      className={`room-setting-choice room-setting-bots${compact ? " room-setting-bots--compact" : ""}`}
      disabled={disabled}
      aria-describedby={`${copyId}-description ${copyId}-rules`}
    >
      <legend>{t("Difficulté des bots", "Bot difficulty")}</legend>
      <div className="room-setting-pills">
        {(["easy", "medium", "hard"] as const).map((option: BotDifficulty) => (
          <label className="room-setting-pill" key={option}>
            <input
              type="radio"
              name={id}
              value={option}
              checked={option === difficulty}
              disabled={disabled}
              onChange={() => {
                if (!disabled) onChange({ ...config, botDifficulty: option });
              }}
            />
            <span>{botDifficultyName(option)}</span>
          </label>
        ))}
      </div>
      {!compact && <BotDifficultyDescription config={config} id={copyId} />}
    </fieldset>
  );
}

/** Quick economy and bot choices before opening a room. */
export function QuickSettings({
  config,
  onChange,
  disabled = false,
}: RoomSettingsProps) {
  const { t } = useLocale();
  const descriptionId = useId();
  const update = (patch: Partial<RoomConfig>) => {
    if (!disabled) onChange({ ...config, ...patch });
  };
  return (
    <div className="room-settings">
      <div className="room-settings-main">
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
        <BotDifficultySetting
          config={config}
          onChange={onChange}
          disabled={disabled}
          compact
          descriptionId={descriptionId}
        />
      </div>
      <BotDifficultyDescription config={config} id={descriptionId} />
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
}: RoomSettingsProps) {
  const { t } = useLocale();
  const giftDescriptionId = useId();
  const winsHeadingId = useId();
  const update = (patch: Partial<RoomConfig>) => {
    if (!disabled) onChange({ ...config, ...patch });
  };
  return (
    <div
      className="room-settings"
      data-readonly={disabled}
      data-disabled-reason={
        disabled
          ? t(
              "Seul le chef de salle peut modifier les réglages avant la partie, une fois connecté.",
              "Only the room leader can change settings before the game, while connected.",
            )
          : undefined
      }
    >
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
        <BotDifficultySetting
          config={config}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      <fieldset className="room-settings-rules" disabled={disabled}>
        <legend>{t("Règles personnalisées", "Custom rules")}</legend>
        <div className="room-settings-toggles">
          {TOGGLES.map(([key, fr, en]) => (
            <div key={key}>
              <label className="room-setting-toggle">
                <input
                  type="checkbox"
                  aria-describedby={
                    key === "giftCanBankrupt" ? giftDescriptionId : undefined
                  }
                  disabled={disabled}
                  checked={config[key]}
                  onChange={(event) =>
                    update({ [key]: event.currentTarget.checked })
                  }
                />
                <span>{t(fr, en)}</span>
              </label>
              {key === "giftCanBankrupt" && (
                <p className="room-setting-help" id={giftDescriptionId}>
                  {t(
                    "Cartes Anniversaire et Charité.",
                    "Birthday and Charity cards.",
                  )}{" "}
                  {config.giftCanBankrupt
                    ? t(
                        "Le paiement complet est dû : il peut forcer une vente ou causer une faillite.",
                        "The full payment is owed: it can force property sales or cause bankruptcy.",
                      )
                    : t(
                        "Le paiement est limité à l’argent disponible, sans vente forcée ni faillite.",
                        "Payment is capped at available cash, with no forced sale or bankruptcy.",
                      )}
                </p>
              )}
            </div>
          ))}
        </div>
      </fieldset>
      {config.randomnessMode === "drand" && (
        <details className="room-settings-fairness">
          <summary>{t("Source des dés", "Dice source")}</summary>
          <p>
            {t(
              "Cette ancienne salle conserve ses dés drand : chaque lancer attend un signal public et sa signature vérifiée.",
              "This older room keeps its drand dice: each roll waits for a public beacon and a verified signature.",
            )}
          </p>
        </details>
      )}
      <section
        className="room-settings-wins"
        aria-labelledby={winsHeadingId}
        aria-live="polite"
      >
        <h3 id={winsHeadingId}>
          {t(
            "Comment gagner avec ces réglages",
            "How to win with these settings",
          )}
        </h3>
        <ul>
          <li>
            {t(
              "Rester le dernier joueur en jeu après la faillite de tous les autres. Zéro en espèces ne suffit pas : les propriétés peuvent couvrir une dette.",
              "Be the last player left after everyone else goes bankrupt. Zero cash alone is not bankruptcy: properties can cover a debt.",
            )}
          </li>
          {config.resortMonopoly !== false && (
            <li>{t("Posséder les quatre plages.", "Own all four beaches.")}</li>
          )}
          {config.lineMonopoly && (
            <li>
              {t(
                "Posséder toutes les villes et plages d’un même côté du plateau.",
                "Own every city and beach on one side of the board.",
              )}
            </li>
          )}
          {config.tripleMonopoly && (
            <li>
              {t(
                "Posséder trois collections de pays complètes.",
                "Own three complete country sets.",
              )}
            </li>
          )}
          <li>
            {t(
              `Avoir le patrimoine le plus élevé après ${config.timeLimitMinutes} min : argent + valeur investie dans les propriétés.`,
              `Have the highest net worth after ${config.timeLimitMinutes} min: cash + invested property value.`,
            )}
          </li>
          <li>
            {t(
              `Si la limite de ${config.roundLimit} tours de table est atteinte avant, le patrimoine le plus élevé gagne.`,
              `If the ${config.roundLimit}-round limit is reached first, highest net worth wins.`,
            )}
          </li>
        </ul>
        <p>
          {t(
            "À égalité de patrimoine : argent disponible, puis nombre de plages, puis ordre de jeu initial.",
            "Net-worth ties: most cash, then most beaches, then original turn order.",
          )}
        </p>
      </section>
    </div>
  );
}

export default RoomSettings;
