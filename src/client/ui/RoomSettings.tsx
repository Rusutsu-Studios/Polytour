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
  help,
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
  help: string;
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
    <div
      className={`room-setting${wide ? " room-setting--wide" : ""}`}
      data-help-title={label}
      data-help-message={help}
      data-help-pin="false"
      tabIndex={disabled ? 0 : undefined}
    >
      <div className="room-setting-heading">
        <span className="room-setting-label">
          <label htmlFor={`${id}-range`}>{label}</label>
        </span>
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

function botDifficultyHelp(
  config: RoomConfig,
  difficulty: BotDifficulty,
  t: (fr: string, en: string) => string,
) {
  const description =
    difficulty === "easy"
      ? t(
          config.botCanBuild
            ? "Construit et rachète, mais profite moins bien de certaines occasions."
            : "Achète des terrains et rachète, mais manque certaines occasions.",
          config.botCanBuild
            ? "Builds and buys out cities, but occasionally misses opportunities."
            : "Buys land and takes buyouts, but occasionally misses opportunities.",
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
  return [
    t(
      "Niveau utilisé pour les nouveaux bots. Cliquez sur le niveau d’un bot dans sa carte pour le changer individuellement.",
      "The level used for new bots. Click a bot’s level on its card to change it individually.",
    ),
    description,
    !config.botCanBuild
      ? t(
          "Construction désactivée pour tous les niveaux.",
          "Building is disabled at every level.",
        )
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function BotDifficultySetting({
  config,
  onChange,
  disabled = false,
  compact = false,
}: RoomSettingsProps & { compact?: boolean }) {
  const { t } = useLocale();
  const id = useId();
  const difficulty = config.botDifficulty ?? "medium";
  return (
    <fieldset
      className={`room-setting-choice room-setting-bots${compact ? " room-setting-bots--compact" : ""}`}
      aria-labelledby={`${id}-label`}
    >
      <legend>
        <span className="room-setting-label">
          <span id={`${id}-label`}>
            {t("Niveau par défaut", "Default bot difficulty")}
          </span>
        </span>
      </legend>
      <div className="room-setting-pills">
        {(["easy", "medium", "hard"] as const).map((option: BotDifficulty) => (
          <div className="room-setting-bot-option" key={option}>
            <label
              className="room-setting-pill"
              data-help-title={botDifficultyName(option)}
              data-help-message={botDifficultyHelp(config, option, t)}
              data-help-pin="false"
              tabIndex={disabled ? 0 : undefined}
            >
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
          </div>
        ))}
      </div>
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
  const update = (patch: Partial<RoomConfig>) => {
    if (!disabled) onChange({ ...config, ...patch });
  };
  return (
    <div className="room-settings">
      <div className="room-settings-main">
        <NumberSetting
          label={t("Capital de départ", "Starting cash")}
          help={t(
            "Argent disponible pour chaque joueur au début de la partie, pour acheter et payer ses premières dépenses.",
            "The cash each player starts with, to buy properties and cover their first expenses.",
          )}
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
          help={t(
            "Somme reçue à chaque passage du Départ en avançant, y compris en s’y arrêtant. Reculer ou être envoyé sur l’île ne rapporte pas de salaire.",
            "Cash received for each forward pass over Start, including landing on it. Moving backward or being sent to the island pays no salary.",
          )}
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
          help={t(
            "Nombre de festivals placés au hasard au début. Chaque festival augmente le loyer de la propriété.",
            "The number of festivals randomly placed at the start. Each festival increases the property’s rent.",
          )}
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
        />
      </div>
    </div>
  );
}

function TimeSetting({
  label,
  help,
  value,
  choices,
  min,
  max,
  suffix,
  unlimitedLabel,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  value: number | null;
  choices: readonly (number | null)[];
  min: number;
  max: number;
  suffix: string;
  unlimitedLabel?: string;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const id = useId();
  const { t } = useLocale();
  const [draft, setDraft] = useState(String(value ?? ""));
  const editing = useRef(false);
  useLayoutEffect(() => {
    if (disabled) editing.current = false;
    if (!editing.current) setDraft(String(value ?? ""));
  }, [value, disabled]);
  const finiteMax = unlimitedLabel ? Math.max(max, value ?? max) : max;
  const sliderMax = finiteMax + (unlimitedLabel ? 1 : 0);
  const sliderValue = value ?? sliderMax;
  const commit = () => {
    editing.current = false;
    if (disabled) return;
    const entered = Math.round(Number(draft));
    const next =
      draft.trim() !== "" && Number.isSafeInteger(entered)
        ? Math.max(min, unlimitedLabel ? entered : Math.min(max, entered))
        : value;
    setDraft(String(next ?? ""));
    if (next !== value) onChange(next);
  };
  return (
    <fieldset
      className="room-setting-choice room-setting-choice--time"
      aria-labelledby={`${id}-label`}
      data-help-title={label}
      data-help-message={help}
      data-help-pin="false"
      tabIndex={disabled ? 0 : undefined}
    >
      <legend>
        <span className="room-setting-label">
          <span id={`${id}-label`}>{label}</span>
        </span>
      </legend>
      <div className="room-setting-time-row">
        <input
          className="room-setting-range"
          type="range"
          min={min}
          max={sliderMax}
          step={1}
          value={sliderValue}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={
            value === null ? unlimitedLabel : `${value} ${suffix}`
          }
          style={
            {
              "--setting-progress": `${((sliderValue - min) / (sliderMax - min)) * 100}%`,
            } as CSSProperties
          }
          onChange={(event) => {
            const entered = Number(event.currentTarget.value);
            if (!disabled) onChange(entered > finiteMax ? null : entered);
          }}
        />
        <div className="room-setting-time-value">
          <input
            type="number"
            min={min}
            max={unlimitedLabel ? undefined : max}
            step={1}
            value={draft}
            placeholder={value === null ? "∞" : undefined}
            disabled={disabled}
            aria-label={t(`${label} : valeur exacte`, `${label}: exact value`)}
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            onChange={(event) => {
              if (disabled) return;
              const text = event.currentTarget.value;
              setDraft(text);
              const entered = Number(text);
              if (
                text !== "" &&
                Number.isSafeInteger(entered) &&
                entered >= min &&
                (unlimitedLabel || entered <= max)
              )
                onChange(entered);
            }}
          />
          <span>{suffix}</span>
        </div>
      </div>
      <div className="room-setting-pills">
        {choices.map((option) => (
          <label className="room-setting-pill" key={option ?? "unlimited"}>
            <input
              type="radio"
              name={id}
              value={option ?? "unlimited"}
              aria-label={option === null ? unlimitedLabel : undefined}
              checked={option === value}
              disabled={disabled}
              onChange={() => {
                if (!disabled) onChange(option);
              }}
            />
            <span>
              {option === null ? (
                "∞"
              ) : (
                <>
                  {option} <span>{suffix}</span>
                </>
              )}
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
  const winsHeadingId = useId();
  const toggleHelp = {
    lineMonopoly: t(
      "Quand cette option est activée, posséder toutes les villes et plages d’un même côté du plateau fait gagner immédiatement. Les cases spéciales ne comptent pas.",
      "When enabled, owning every city and beach on one side of the board wins immediately. Special spaces do not count.",
    ),
    tripleMonopoly: t(
      "Quand cette option est activée, posséder trois collections de pays complètes fait gagner immédiatement. Une collection regroupe les villes d’un même pays.",
      "When enabled, owning three complete country sets wins immediately. A set contains all cities in one country.",
    ),
    resortMonopoly: t(
      "Quand cette option est activée, posséder les quatre plages fait gagner immédiatement, sans construction nécessaire.",
      "When enabled, owning all four beaches wins immediately, with no buildings required.",
    ),
    hotelsDirectly: t(
      "Permet d’acheter un hôtel directement, sans attendre les étapes normales de construction. Sinon, les hôtels se débloquent avec la progression du joueur et de la ville.",
      "Allows buying a hotel directly, without waiting for the normal building stages. Otherwise, hotels unlock as the player and city progress.",
    ),
    extraRollOnDouble: t(
      "Quand cette option est activée, un double permet de rejouer après avoir résolu la case, sauf si le tour est terminé. Un double pour sortir de l’île ne donne pas de lancer supplémentaire.",
      "When enabled, doubles grant another roll after resolving the tile, unless the turn ends. Island escape doubles grant no extra roll.",
    ),
    tripleDoubleToIsland: t(
      "Un troisième double consécutif dans le même tour envoie le joueur sur l’île au lieu d’avancer et termine le tour. Sans cette option, il se déplace normalement.",
      "A third consecutive double in the same turn sends the player to the island instead of moving and ends the turn. With this option off, the player moves normally.",
    ),
    botCanBuild: t(
      "Autorise les bots à construire et améliorer leurs villes, à tous les niveaux. Désactivée, ils peuvent acheter et racheter, mais ne construisent pas volontairement. Les effets des cartes restent applicables.",
      "Allows bots to build and upgrade cities at every level. When off, they can buy land and buy out cities, but do not build voluntarily. Card effects still apply.",
    ),
    giftCanBankrupt: [
      t(
        "Paiements des cartes Anniversaire, Solidarité et Mécène.",
        "Payments from the Birthday, Charity and Patron cards.",
      ),
      config.giftCanBankrupt
        ? t(
            "Le paiement complet est dû : il peut forcer une vente ou causer une faillite.",
            "The full payment is owed: it can force property sales or cause bankruptcy.",
          )
        : t(
            "Le paiement est limité à l’argent disponible, sans vente forcée ni faillite.",
            "Payment is capped at available cash, with no forced sale or bankruptcy.",
          ),
    ].join(" "),
  };
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
          help={t(
            "Argent disponible pour chaque joueur au début de la partie, pour acheter et payer ses premières dépenses.",
            "The cash each player starts with, to buy properties and cover their first expenses.",
          )}
          value={config.startingCash}
          max={10_000_000}
          step={10_000}
          disabled={disabled}
          onChange={(startingCash) => update({ startingCash })}
          monetary
        />
        <NumberSetting
          label={t("Salaire au départ", "Salary per lap")}
          help={t(
            "Somme reçue à chaque passage du Départ en avançant, y compris en s’y arrêtant. Reculer ou être envoyé sur l’île ne rapporte pas de salaire.",
            "Cash received for each forward pass over Start, including landing on it. Moving backward or being sent to the island pays no salary.",
          )}
          value={config.startSalary}
          max={1_000_000}
          step={10_000}
          disabled={disabled}
          onChange={(startSalary) => update({ startSalary })}
          monetary
        />
        <NumberSetting
          label={t("Festivals initiaux", "Starting festivals")}
          help={t(
            "Nombre de festivals placés au hasard au début. Chaque festival augmente le loyer de la propriété.",
            "The number of festivals randomly placed at the start. Each festival increases the property’s rent.",
          )}
          value={config.festivalCount}
          max={20}
          step={1}
          disabled={disabled}
          onChange={(festivalCount) => update({ festivalCount })}
          wide
        />
        <TimeSetting
          label={t("Durée de partie", "Game duration")}
          help={t(
            "Limite de temps, pauses exclues. La durée illimitée désactive les limites de temps et de tours. Sans victoire immédiate, le plus grand patrimoine gagne après règlement des effets en cours : argent disponible et valeur investie dans ses propriétés.",
            "Time limit, excluding pauses. Unlimited duration disables the time and round limits. If no instant win occurs, highest net worth wins after pending effects settle: cash plus invested property value.",
          )}
          value={config.timeLimitMinutes}
          choices={[20, 60, 120, null]}
          min={15}
          max={120}
          suffix="min"
          unlimitedLabel={t("Durée illimitée", "Unlimited duration")}
          disabled={disabled}
          onChange={(timeLimitMinutes) => update({ timeLimitMinutes })}
        />
        <TimeSetting
          label={t("Temps de décision", "Decision timer")}
          help={t(
            "Temps pour chaque choix humain, après les animations. Sans réponse, le jeu applique son choix automatique. Les bots gardent leur propre rythme.",
            "Time for each human choice after animations. Without a response, the game applies its automatic choice. Bots keep their own pace.",
          )}
          value={config.decisionSeconds}
          choices={[15, 30, 45, 60]}
          min={10}
          max={60}
          suffix="s"
          disabled={disabled}
          onChange={(decisionSeconds) => {
            if (decisionSeconds !== null) update({ decisionSeconds });
          }}
        />
        <BotDifficultySetting
          config={config}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      <fieldset className="room-settings-rules">
        <legend>{t("Règles personnalisées", "Custom rules")}</legend>
        <div className="room-settings-toggles">
          {TOGGLES.map(([key, fr, en]) => (
            <div className="room-setting-toggle-row" key={key}>
              <label
                className="room-setting-toggle"
                data-help-title={t(fr, en)}
                data-help-message={toggleHelp[key]}
                data-help-pin="false"
                tabIndex={disabled ? 0 : undefined}
              >
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
          {config.timeLimitMinutes !== null && (
            <>
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
            </>
          )}
        </ul>
        <p>
          {config.timeLimitMinutes === null
            ? t(
                "Durée illimitée : aucune limite de temps ou de tours. Seules les conditions de victoire ci-dessus terminent la partie.",
                "Unlimited duration: no time or round limit. Only the win conditions above end the game.",
              )
            : t(
                "À égalité de patrimoine : argent disponible, puis nombre de plages, puis ordre de jeu initial.",
                "Net-worth ties: most cash, then most beaches, then original turn order.",
              )}
        </p>
      </section>
    </div>
  );
}

export default RoomSettings;
