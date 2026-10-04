import { useEffect, useRef } from "react";
import { translate as t } from "../i18n.js";
import ActionButton from "./ActionButton.js";
import Icon from "./Icon.js";

export default function InvitationEntry({
  name,
  onName,
  onJoin,
  loading,
  error,
  invalid,
}: {
  name: string;
  onName: (name: string) => void;
  onJoin: () => void;
  loading: boolean;
  error: string | null;
  invalid: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!loading) input.current?.focus();
  }, [loading]);

  return (
    <div className="welcome-copy">
      <span className="travel-stamp">
        <Icon name="people" size={17} />
        {t("Invitation", "Invitation")}
      </span>
      <h1>{t("Rejoindre la salle", "Join room")}</h1>
      {invalid ? (
        <p className="error-message" role="alert">
          {t(
            "Lien d’invitation invalide. Demandez un nouveau lien à l’hôte.",
            "Invalid invitation link. Ask the host for a new link.",
          )}
        </p>
      ) : (
        <>
          <p className="welcome-intro">
            {t(
              "Choisissez votre pseudo pour rejoindre vos amis.",
              "Choose a nickname to join your friends.",
            )}
          </p>
          <form
            className="welcome-form invitation-form"
            aria-busy={loading}
            onSubmit={(event) => {
              event.preventDefault();
              onJoin();
            }}
          >
            <label htmlFor="player-name">
              {t("Votre nom de joueur", "Player name")}
            </label>
            <input
              ref={input}
              id="player-name"
              value={name}
              maxLength={24}
              autoComplete="nickname"
              placeholder={t("Votre pseudo", "Your nickname")}
              disabled={loading}
              aria-describedby={error ? "invitation-error" : undefined}
              onChange={(event) => onName(event.target.value)}
            />
            <ActionButton
              type="submit"
              className="button primary welcome-play"
              disabled={loading}
            >
              {loading ? <span className="spinner" /> : <Icon name="people" />}
              {loading
                ? t("Connexion à la salle…", "Joining room…")
                : t("Rejoindre", "Join")}
              <Icon name="arrow" />
            </ActionButton>
            {error && (
              <p id="invitation-error" className="error-message" role="alert">
                {error}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  );
}
