import type { CSSProperties } from "react";
import { useState } from "react";
import type { Seat } from "../../shared/engine/index.js";
import { PLAYER_COLORS } from "./board-display.js";
import "./PlayerAvatar.css";

/** Cosmetic appearance is independent of the player's seat and room role. */
export type AvatarAppearance =
  | { kind: "pawn" }
  | { kind: "portrait"; src: string };

export default function PlayerAvatar({
  seat,
  appearance,
}: {
  seat: Seat;
  /** Future avatar selections can supply a portrait to this shared renderer. */
  appearance?: AvatarAppearance;
}) {
  const [failedPortrait, setFailedPortrait] = useState<string | null>(null);
  const portrait = appearance?.kind === "portrait" ? appearance.src : null;
  const showPortrait = Boolean(portrait && portrait !== failedPortrait);
  return (
    <div
      className="player-avatar"
      data-avatar-kind={showPortrait ? "portrait" : "pawn"}
      aria-hidden="true"
      style={{ "--player-color": PLAYER_COLORS[seat] } as CSSProperties}
    >
      {showPortrait && portrait ? (
        <img
          className="avatar-portrait"
          src={portrait}
          alt=""
          onError={() => setFailedPortrait(portrait)}
        />
      ) : (
        <>
          <i className="avatar-head">
            <i className="avatar-cap" />
            <i className="avatar-eyes" />
          </i>
          <i className="avatar-body" />
        </>
      )}
    </div>
  );
}
