import type { CSSProperties, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { BotDifficulty, Seat } from "../../shared/engine/index.js";
import type { LobbyState } from "../../shared/protocol/index.js";
import { useLocale } from "../i18n.js";
import ActionButton from "./ActionButton.js";
import { PLAYER_COLORS } from "./board-display.js";
import { botDifficultyName, nextBotDifficulty } from "./bot-display.js";
import Icon from "./Icon.js";
import PlayerAvatar from "./PlayerAvatar.js";
import "./RoomPeople.css";

const SEATS = [0, 1, 2, 3] as const;

export { PlayerAvatar };

/** The same avatar renderer is used in the lobby, HUD and leader choices. */
export function RoomLeaderPicker({
  lobby,
  leader,
  disabled,
  onTransferHost,
}: {
  lobby: LobbyState;
  leader: boolean;
  disabled: boolean;
  onTransferHost: (seat: Seat) => void;
}) {
  const { t } = useLocale();
  return (
    <section className="room-leader-picker" aria-labelledby="room-leader-title">
      <h3 id="room-leader-title">
        {leader
          ? t("Changer le chef de salle", "Change room leader")
          : t("Joueurs", "Players")}
      </h3>
      <ul>
        {lobby.seats
          .filter((entry) => entry.control !== null)
          .map((entry) => {
            const current = entry.seat === lobby.hostSeat;
            const eligible =
              leader &&
              !current &&
              entry.control === "human" &&
              entry.controller === null;
            const status = current
              ? t("Chef de salle", "Room leader")
              : entry.control === "bot"
                ? t("Bot", "Bot")
                : entry.controller !== null
                  ? t("Joueur local", "Local player")
                  : !entry.online
                    ? t("Absent", "Away")
                    : t("Joueur", "Player");
            return (
              <li key={entry.seat}>
                <ActionButton
                  type="button"
                  className="room-leader-choice"
                  data-seat={entry.seat}
                  data-leader={current}
                  disabled={disabled || !eligible}
                  disabledReason={
                    disabled
                      ? t(
                          "En attente de la connexion au serveur.",
                          "Waiting for the server connection.",
                        )
                      : !leader
                        ? t(
                            "Seul le chef de salle peut transmettre ce rôle.",
                            "Only the room leader can pass on this role.",
                          )
                        : current
                          ? t(
                              "Ce joueur est déjà chef de salle.",
                              "This player is already the room leader.",
                            )
                          : t(
                              "Choisissez un joueur humain qui dispose de sa propre connexion.",
                              "Choose a human player with their own connection.",
                            )
                  }
                  aria-pressed={current}
                  aria-label={
                    eligible
                      ? t(
                          `Nommer ${entry.name} chef de salle`,
                          `Make ${entry.name} the room leader`,
                        )
                      : entry.name
                  }
                  onClick={() => onTransferHost(entry.seat)}
                >
                  <PlayerAvatar seat={entry.seat} />
                  <strong className="room-leader-name" title={entry.name}>
                    {entry.name}
                  </strong>
                  <small className="room-leader-status">
                    {current && <Icon name="crown" size={12} />}
                    {status}
                  </small>
                </ActionButton>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

/** The seats this screen plays: its own, then the local players sharing it. */
export function deviceSeats(lobby: LobbyState | null, seat: Seat | null) {
  if (seat === null) return [];
  return [
    seat,
    ...(lobby?.seats ?? [])
      .filter((entry) => entry.controller === seat && entry.control !== null)
      .map((entry) => entry.seat),
  ];
}

// Four table places, like the cards of a tabletop lobby. The leader seats a
// bot in an open place or sends it away; any player can seat a friend who
// shares their screen, and every card shows who leads the room.
export function LobbySeats({
  lobby,
  you,
  leader,
  disabled,
  pending,
  onAddBot,
  onRemoveBot,
  onBotDifficulty,
  onAddLocal,
  onRemoveLocal,
  onTransferHost,
}: {
  lobby: LobbyState | null;
  you: Seat | null;
  leader: boolean;
  disabled: boolean;
  pending: boolean;
  onAddBot: (seat: Seat) => void;
  onRemoveBot: (seat: Seat) => void;
  onBotDifficulty: (seat: Seat, difficulty: BotDifficulty) => void;
  onAddLocal: (seat: Seat, name: string) => void;
  onRemoveLocal: (seat: Seat) => void;
  onTransferHost: (seat: Seat) => void;
}) {
  const { t } = useLocale();
  const [naming, setNaming] = useState<Seat | null>(null);
  const [localName, setLocalName] = useState("");
  const firstOpen = SEATS.find(
    (seat) => !lobby?.seats.find((entry) => entry.seat === seat)?.control,
  );
  const orderReason = t(
    "Remplissez d’abord la première place libre.",
    "Fill the first open seat first.",
  );
  function addLocal(event: FormEvent, seat: Seat) {
    event.preventDefault();
    const name = localName.trim();
    if (!name || disabled || seat !== firstOpen) return;
    onAddLocal(seat, name);
    setNaming(null);
    setLocalName("");
  }
  return (
    <ul className="lobby-seats">
      {SEATS.map((seat) => {
        const player = lobby?.seats.find((item) => item.seat === seat);
        const style = {
          "--player-color": PLAYER_COLORS[seat],
        } as CSSProperties;
        if (
          !player?.control &&
          naming === seat &&
          seat === firstOpen &&
          you !== null
        )
          return (
            <li key={seat} className="lobby-seat empty" style={style}>
              <form
                className="seat-local-form"
                onSubmit={(event) => addLocal(event, seat)}
              >
                <label htmlFor={`local-player-${seat}`}>
                  {t("Joueur sur ce PC", "Player on this PC")}
                </label>
                <input
                  id={`local-player-${seat}`}
                  value={localName}
                  maxLength={24}
                  // biome-ignore lint/a11y/noAutofocus: the field is the only control of the form the player just opened.
                  autoFocus
                  autoComplete="off"
                  placeholder={t("Son pseudo", "Their nickname")}
                  onChange={(event) => setLocalName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setNaming(null);
                  }}
                />
                <div>
                  <ActionButton
                    type="submit"
                    className="button primary"
                    disabled={disabled || !localName.trim()}
                    disabledReason={
                      disabled
                        ? t(
                            "En attente de la connexion au serveur.",
                            "Waiting for the server connection.",
                          )
                        : t(
                            "Saisissez le nom du joueur.",
                            "Enter the player’s name.",
                          )
                    }
                  >
                    {t("Ajouter", "Add")}
                  </ActionButton>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setNaming(null)}
                  >
                    {t("Annuler", "Cancel")}
                  </button>
                </div>
              </form>
            </li>
          );
        if (!player?.control)
          return (
            <li key={seat} className="lobby-seat empty" style={style}>
              <div className="seat-open">
                {you === null ? (
                  <span className="seat-plus seat-color" aria-hidden="true" />
                ) : (
                  <span className="seat-plus" aria-hidden="true">
                    +
                  </span>
                )}
                <strong>{t("Place libre", "Open seat")}</strong>
                {you === null ? (
                  <span>
                    {t("En attente d’un joueur", "Waiting for a player")}
                  </span>
                ) : (
                  <div className="seat-choices">
                    {leader && (
                      <ActionButton
                        type="button"
                        className="seat-choice"
                        disabled={disabled || seat !== firstOpen}
                        disabledReason={
                          seat !== firstOpen ? orderReason : undefined
                        }
                        aria-label={t(
                          `Ajouter un bot à la place ${seat + 1}`,
                          `Add a bot to seat ${seat + 1}`,
                        )}
                        onClick={() => onAddBot(seat)}
                      >
                        <Icon name="bot" size={16} />
                        Bot
                      </ActionButton>
                    )}
                    <ActionButton
                      type="button"
                      className="seat-choice"
                      disabled={disabled || seat !== firstOpen}
                      disabledReason={
                        seat !== firstOpen ? orderReason : undefined
                      }
                      aria-label={t(
                        `Ajouter un joueur sur ce PC à la place ${seat + 1}`,
                        `Add a player on this PC to seat ${seat + 1}`,
                      )}
                      onClick={() => {
                        setLocalName("");
                        setNaming(seat);
                      }}
                    >
                      <Icon name="screen" size={16} />
                      {t("Sur ce PC", "On this PC")}
                    </ActionButton>
                  </div>
                )}
              </div>
            </li>
          );
        const local = player.controller !== null;
        const controllerName = lobby?.seats.find(
          (entry) => entry.seat === player.controller,
        )?.name;
        const removable =
          (leader && player.control === "bot") ||
          (local && (leader || player.controller === you));
        const difficulty =
          player.botDifficulty ?? lobby?.config.botDifficulty ?? "medium";
        const nextDifficulty = nextBotDifficulty(difficulty);
        const currentLevel = botDifficultyName(difficulty);
        const nextLevel = botDifficultyName(nextDifficulty);
        return (
          <li
            key={seat}
            className={`lobby-seat filled ${player.control}`}
            data-local={local || undefined}
            data-seat={seat}
            style={style}
          >
            <PlayerAvatar seat={seat} />
            <strong>{player.name}</strong>
            {player.control === "bot" ? (
              <ActionButton
                type="button"
                className="seat-status seat-bot-difficulty"
                aria-label={t(
                  `${player.name} : Bot · ${currentLevel}. Passer à ${nextLevel}`,
                  `${player.name}: Bot · ${currentLevel}. Switch to ${nextLevel}`,
                )}
                disabled={disabled || pending || !leader}
                disabledReason={
                  !leader
                    ? t(
                        "Seul le chef de salle peut changer le niveau de ce bot.",
                        "Only the room leader can change this bot's level.",
                      )
                    : pending
                      ? t(
                          "En attente de confirmation.",
                          "Waiting for confirmation.",
                        )
                      : t(
                          "Reconnectez-vous pour changer le niveau de ce bot.",
                          "Reconnect to change this bot's level.",
                        )
                }
                onClick={() => onBotDifficulty(seat, nextDifficulty)}
              >
                {`Bot · ${currentLevel}`}
                <Icon name="arrow" size={13} />
              </ActionButton>
            ) : (
              <span className="seat-status">
                {local
                  ? player.controller === you
                    ? t("Sur votre PC", "On your PC")
                    : t(
                        `Sur le PC de ${controllerName}`,
                        `On ${controllerName}’s PC`,
                      )
                  : !player.online
                    ? t("Connexion…", "Connecting…")
                    : seat === you
                      ? t("Vous", "You")
                      : t("En ligne", "Online")}
              </span>
            )}
            {seat === lobby?.hostSeat && (
              <span className="host-label">
                <Icon name="crown" size={13} />
                {t("Chef", "Leader")}
              </span>
            )}
            {removable && (
              <ActionButton
                type="button"
                className="seat-remove"
                disabled={disabled}
                aria-label={
                  player.control === "bot"
                    ? t(
                        `Retirer le bot ${player.name}`,
                        `Remove bot ${player.name}`,
                      )
                    : t(`Retirer ${player.name}`, `Remove ${player.name}`)
                }
                onClick={() =>
                  player.control === "bot"
                    ? onRemoveBot(seat)
                    : onRemoveLocal(seat)
                }
              >
                <Icon name="close" size={15} />
              </ActionButton>
            )}
            {leader && player.control === "human" && !local && seat !== you && (
              <ActionButton
                type="button"
                className="seat-promote"
                disabled={disabled}
                aria-label={t(
                  `Nommer ${player.name} chef de salle`,
                  `Make ${player.name} the room leader`,
                )}
                onClick={() => onTransferHost(seat)}
              >
                <Icon name="crown" size={13} />
                {t("Nommer chef", "Make leader")}
              </ActionButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * People without a place: they asked to enter a locked room, joined during a
 * match or found every place taken. The leader admits or turns them away,
 * and during a match can hand one of them a bot's place.
 */
export function WaitingRoom({
  lobby,
  bots = [],
  leader,
  disabled,
  onAdmit,
  onDeny,
  onReplaceBot,
}: {
  lobby: LobbyState | null;
  /** Server bots still playing the match, whose place someone can take. */
  bots?: readonly { seat: Seat; name: string }[];
  leader: boolean;
  disabled: boolean;
  onAdmit: (member: string) => void;
  onDeny: (member: string) => void;
  onReplaceBot: (member: string, seat: Seat) => void;
}) {
  const { t } = useLocale();
  if (!lobby?.waiting.length) return null;
  return (
    <section className="waiting-room" aria-labelledby="waiting-room-heading">
      <h2 id="waiting-room-heading">{t("Salle d’attente", "Waiting room")}</h2>
      <ul>
        {lobby.waiting.map((member) => (
          <li key={member.id} data-approved={member.approved}>
            <span className="waiting-name">
              <strong>{member.name}</strong>
              <small>
                {!member.approved
                  ? t("Demande à entrer", "Asks to join")
                  : lobby.status === "lobby"
                    ? t("Attend une place libre", "Waiting for an open seat")
                    : t(
                        "Attend la prochaine partie",
                        "Waiting for the next game",
                      )}
                {!member.online && t(" · absent", " · away")}
              </small>
            </span>
            {leader && (
              <span className="waiting-actions">
                {!member.approved ? (
                  <>
                    <ActionButton
                      type="button"
                      className="button primary"
                      disabled={disabled}
                      aria-label={t(
                        `Accepter ${member.name}`,
                        `Accept ${member.name}`,
                      )}
                      onClick={() => onAdmit(member.id)}
                    >
                      {t("Accepter", "Accept")}
                    </ActionButton>
                    <ActionButton
                      type="button"
                      className="button secondary"
                      disabled={disabled}
                      aria-label={t(
                        `Refuser ${member.name}`,
                        `Decline ${member.name}`,
                      )}
                      onClick={() => onDeny(member.id)}
                    >
                      {t("Refuser", "Decline")}
                    </ActionButton>
                  </>
                ) : (
                  <>
                    {bots.map((bot) => (
                      <ActionButton
                        type="button"
                        key={bot.seat}
                        className="button secondary"
                        disabled={disabled}
                        aria-label={t(
                          `Donner la place de ${bot.name} à ${member.name}`,
                          `Give ${bot.name}’s seat to ${member.name}`,
                        )}
                        onClick={() => onReplaceBot(member.id, bot.seat)}
                      >
                        <Icon name="bot" size={15} />
                        {t(`Place de ${bot.name}`, `${bot.name}’s seat`)}
                      </ActionButton>
                    ))}
                    <ActionButton
                      type="button"
                      className="icon-button"
                      disabled={disabled}
                      aria-label={t(
                        `Retirer ${member.name} de la salle d’attente`,
                        `Remove ${member.name} from the waiting room`,
                      )}
                      onClick={() => onDeny(member.id)}
                    >
                      <Icon name="close" size={15} />
                    </ActionButton>
                  </>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RoomLock({
  locked,
  pending,
  disabled,
  onChange,
}: {
  locked: boolean;
  /** A room command awaits its answer. */
  pending: boolean;
  disabled: boolean;
  onChange: (locked: boolean) => void;
}) {
  const { t } = useLocale();
  // The box follows the click at once. The room sends its new lobby before
  // its answer, so once answered the draft gives way to that value, or to the
  // old one if the request was refused.
  const [draft, setDraft] = useState<boolean | null>(null);
  useEffect(() => {
    if (!pending) setDraft(null);
  }, [pending]);
  return (
    <label
      className="checkbox-label room-lock"
      data-disabled-reason={t(
        "En attente de la connexion au serveur.",
        "Waiting for the server connection.",
      )}
    >
      <input
        type="checkbox"
        checked={draft ?? locked}
        disabled={disabled}
        onChange={(event) => {
          setDraft(event.target.checked);
          onChange(event.target.checked);
        }}
      />
      <span>
        <strong>
          <Icon name="lock" size={14} />
          {t("Verrouiller la salle", "Lock the room")}
        </strong>
        <small>
          {t(
            "Vous acceptez ou refusez chaque nouvel arrivant.",
            "You accept or decline each newcomer.",
          )}
        </small>
      </span>
    </label>
  );
}

/** What someone sees while they wait for a place instead of playing. */
export function WaitingNotice({
  lobby,
  member,
}: {
  lobby: LobbyState | null;
  member: string | null;
}) {
  const { t } = useLocale();
  const entry = lobby?.waiting.find((candidate) => candidate.id === member);
  const leaderName = lobby?.seats.find(
    (seat) => seat.seat === lobby.hostSeat,
  )?.name;
  return (
    <p className="waiting-notice" role="status">
      <span className="spinner" />
      {!entry?.approved
        ? t(
            `${leaderName ?? "Le chef de salle"} doit accepter votre entrée.`,
            `${leaderName ?? "The room leader"} needs to let you in.`,
          )
        : lobby?.status === "lobby"
          ? t(
              "Toutes les places sont prises. Vous prendrez la prochaine qui se libère.",
              "Every seat is taken. You will get the next one that opens.",
            )
          : t(
              "Vous regardez la partie. Le chef de salle peut vous donner la place d’un bot, sinon vous jouerez à la suivante.",
              "You are watching this game. The room leader can give you a bot’s seat; otherwise you play in the next one.",
            )}
    </p>
  );
}

/**
 * Ending a match for everyone takes two clicks; leaving finished results
 * takes one.
 */
export function ReturnToLobby({
  finished,
  disabled,
  onConfirm,
}: {
  finished: boolean;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // The question opens below the fold of the room drawer: bring its answer
  // into view and under the keyboard.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  if (finished)
    return (
      <ActionButton
        type="button"
        className="button primary"
        disabled={disabled}
        onClick={onConfirm}
      >
        {t("Retour au salon", "Back to the lobby")}
        <Icon name="arrow" />
      </ActionButton>
    );
  if (!confirming)
    return (
      <ActionButton
        type="button"
        className="button secondary"
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        {t("Ramener tout le monde au salon", "Bring everyone to the lobby")}
      </ActionButton>
    );
  return (
    <div className="return-confirm">
      <p>
        {t(
          "La partie en cours s’arrête pour tout le monde. Les places et les réglages restent.",
          "The current game ends for everyone. Seats and settings stay.",
        )}
      </p>
      <ActionButton
        ref={confirmRef}
        type="button"
        className="button primary"
        disabled={disabled}
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        {t("Terminer et revenir au salon", "End and return to the lobby")}
      </ActionButton>
      <button
        type="button"
        className="text-button"
        onClick={() => setConfirming(false)}
      >
        {t("Continuer la partie", "Keep playing")}
      </button>
    </div>
  );
}
