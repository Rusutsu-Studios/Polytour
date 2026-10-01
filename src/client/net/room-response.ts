import { z } from "zod";
import type { RoomCredentials } from "../../shared/protocol/index.js";
import { RoomCodeSchema } from "../../shared/protocol/index.js";
import { translate } from "../i18n.js";

export const RoomCredentialsSchema = z.object({
  roomCode: RoomCodeSchema,
  seat: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  token: z.string().min(1),
});

const roomError = z.object({
  error: z.string().optional(),
  message: z.string().trim().min(1).max(300).optional(),
});
const ERROR_MESSAGES: Record<string, readonly [string, string]> = {
  "room-not-found": [
    "Cette salle n’existe pas. Vérifiez les six caractères du code.",
    "This room does not exist. Check the six-character code.",
  ],
  "room-full": [
    "Cette salle est complète. Créez une nouvelle partie.",
    "This room is full. Create a new game.",
  ],
  "game-started": [
    "La partie a déjà commencé. Rejoignez un autre salon.",
    "This game has already started. Join another room.",
  ],
  "invalid-room": [
    "Le nom ou les réglages de la salle sont invalides. Vérifiez-les puis réessayez.",
    "The room name or settings are invalid. Check them and try again.",
  ],
  "origin-rejected": [
    "Cette page ne peut pas ouvrir de salle. Revenez à l’adresse du jeu.",
    "This page cannot open a room. Return to the game’s address.",
  ],
  "room-service-unavailable": [
    "Le serveur de jeu est temporairement indisponible (HTTP 503). Patientez un instant puis réessayez.",
    "The game server is temporarily unavailable (HTTP 503). Wait a moment and try again.",
  ],
  "room-storage-limit": [
    "Le quota quotidien d’écriture des salles Cloudflare est atteint (HTTP 503). Réessayez après sa réinitialisation.",
    "The daily Cloudflare room write quota has been reached (HTTP 503). Try again after it resets.",
  ],
};

export class RoomRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RoomRequestError";
    this.status = status;
  }
}

function unavailableMessage(status: number): string {
  if (status === 429)
    return translate(
      "Le service reçoit trop de demandes (HTTP 429). Attendez un moment puis réessayez.",
      "The service is receiving too many requests (HTTP 429). Wait a moment and try again.",
    );
  if (status >= 500)
    return translate(
      `Le serveur de jeu est temporairement indisponible (HTTP ${status}). Patientez un instant puis réessayez.`,
      `The game server is temporarily unavailable (HTTP ${status}). Wait a moment and try again.`,
    );
  return translate(
    `Impossible d’ouvrir la salle (HTTP ${status}). Réessayez.`,
    `Unable to open the room (HTTP ${status}). Try again.`,
  );
}

export async function parseRoomResponse(
  response: Response,
): Promise<RoomCredentials> {
  // A Cloudflare platform failure may be plain text or HTML, even for /api.
  // Read it once and validate it before using or persisting any credentials.
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const parsed = roomError.safeParse(body);
    const error = parsed.success ? parsed.data : null;
    const knownMessage = ERROR_MESSAGES[error?.error ?? ""];
    throw new RoomRequestError(
      knownMessage
        ? translate(...knownMessage)
        : (error?.message ?? unavailableMessage(response.status)),
      response.status,
    );
  }
  const credentials = RoomCredentialsSchema.safeParse(body);
  if (!credentials.success)
    throw new RoomRequestError(
      translate(
        "Le serveur a envoyé une réponse de salle incompatible. Actualisez la page puis réessayez.",
        "The server sent an incompatible room response. Refresh the page and try again.",
      ),
      response.status,
    );
  return credentials.data;
}
